// Engine ladder: five classes, three levels each. GPL-3.0-or-later.
// Classes I–III are Forge (our own engine, js/forge-engine.js).
// Classes IV–V are Stockfish 19 (lite, single-threaded WASM) in the browser.
// Elo figures are rough targets, not calibrated measurements (see tools/match.mjs).

export const CLASSES = [
  {
    id: 1, name: 'Apprentice', engine: 'forge', glyph: '♙',
    blurb: 'Looks one move ahead, misjudges often, sometimes plays a random move. Punish hanging pieces.',
    levels: [
      { elo: 500, cfg: { depth: 1, timeMs: 300, noise: 260, randomProb: 0.25, qsearch: false } },
      { elo: 700, cfg: { depth: 1, timeMs: 300, noise: 180, randomProb: 0.15, qsearch: false } },
      { elo: 900, cfg: { depth: 2, timeMs: 400, noise: 130, randomProb: 0.08, qsearch: false } },
    ],
  },
  {
    id: 2, name: 'Journeyman', engine: 'forge', glyph: '♘',
    blurb: 'Two to three moves deep with capture search. Rarely hangs pieces; loses the thread positionally.',
    levels: [
      { elo: 1000, cfg: { depth: 2, timeMs: 500, noise: 90, randomProb: 0.05 } },
      { elo: 1150, cfg: { depth: 3, timeMs: 700, noise: 60, randomProb: 0.03 } },
      { elo: 1300, cfg: { depth: 3, timeMs: 900, noise: 35, randomProb: 0.015 } },
    ],
  },
  {
    id: 3, name: 'Smith', engine: 'forge', glyph: '♗',
    blurb: 'Forge at full strength: iterative deepening, null-move, LMR, quiescence. Tactically sharp, strategically naive.',
    levels: [
      { elo: 1450, cfg: { depth: 4, timeMs: 800 } },
      { elo: 1650, cfg: { depth: 6, timeMs: 1200 } },
      { elo: 1850, cfg: { depth: 64, timeMs: 2500 } },
    ],
  },
  {
    id: 4, name: 'Master', engine: 'stockfish', glyph: '♖',
    blurb: 'Stockfish with UCI_LimitStrength: human-like master errors at a set Elo.',
    levels: [
      { elo: 1900, cfg: { elo: 1900, movetime: 800 } },
      { elo: 2200, cfg: { elo: 2200, movetime: 1000 } },
      { elo: 2500, cfg: { elo: 2500, movetime: 1200 } },
    ],
  },
  {
    id: 5, name: 'Hephaestus', engine: 'stockfish', glyph: '♕',
    blurb: 'Unrestricted Stockfish 19. The wall you measure yourself against.',
    levels: [
      { elo: 2900, cfg: { movetime: 700 } },
      { elo: 3100, cfg: { movetime: 1500 } },
      { elo: 3300, cfg: { movetime: 3000 } },
    ],
  },
];

export function getLevel(classId, level) {
  const c = CLASSES.find(x => x.id === +classId);
  const l = c.levels[Math.max(0, Math.min(2, (+level || 1) - 1))];
  return { cls: c, lvl: l, label: `${c.name} ${['I', 'II', 'III'][(+level || 1) - 1]}`, elo: l.elo };
}

// ---------------- Forge worker client ----------------
export class ForgeClient {
  constructor() {
    this.w = new Worker(new URL('./forge-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map(); this.seq = 0;
    this.w.onmessage = (e) => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); } };
  }
  go({ startFen, moves, cfg }) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.w.postMessage({ id, startFen, moves, cfg }); });
  }
  stop() { this.w.terminate(); }
}

// ---------------- Stockfish (UCI over postMessage) ----------------
export class Stockfish {
  constructor(path = new URL('../vendor/stockfish/stockfish-19-lite-single.js', import.meta.url)) {
    this.w = new Worker(path);
    this.listeners = new Set();
    this.w.onmessage = (e) => { const line = typeof e.data === 'string' ? e.data : String(e.data); for (const l of [...this.listeners]) l(line); };
    this.queue = Promise.resolve();
    this.ready = this._init();
  }
  send(cmd) { this.w.postMessage(cmd); }
  waitFor(pred) { return new Promise(res => { const l = (line) => { if (pred(line)) { this.listeners.delete(l); res(line); } }; this.listeners.add(l); }); }
  async _init() {
    const ok = this.waitFor(l => l === 'uciok'); this.send('uci'); await ok;
    this.send('setoption name Hash value 32');
    await this.isready();
  }
  async isready() { const r = this.waitFor(l => l === 'readyok'); this.send('isready'); await r; }
  newGame() { return this.run(async () => { this.send('ucinewgame'); await this.isready(); }); }
  run(fn) { const p = this.queue.then(() => this.ready).then(fn); this.queue = p.catch(() => {}); return p; }

  /** go({fen, moves, movetime, depth, multipv, elo}) -> {bestmove, lines:[{multipv, depth, cp, mate, pv:[uci]}]} (scores: side to move) */
  go({ fen, moves = [], movetime, depth, multipv = 1, elo = null, onInfo }) {
    return this.run(async () => {
      if (elo) { this.send('setoption name UCI_LimitStrength value true'); this.send(`setoption name UCI_Elo value ${elo}`); }
      else this.send('setoption name UCI_LimitStrength value false');
      this.send(`setoption name MultiPV value ${multipv}`);
      await this.isready();
      const lines = [];
      const info = (l) => {
        if (!l.startsWith('info') || !l.includes(' pv ')) return;
        const g = (k) => { const m = l.match(new RegExp(' ' + k + ' (-?\\d+)')); return m ? +m[1] : null; };
        const mp = g('multipv') || 1;
        const pv = l.split(' pv ')[1].trim().split(/\s+/);
        lines[mp - 1] = { multipv: mp, depth: g('depth'), cp: l.includes('score cp') ? g('cp') : null, mate: l.includes('score mate') ? g('mate') : null, pv };
        if (onInfo) onInfo(lines);
      };
      this.listeners.add(info);
      const done = this.waitFor(l => l.startsWith('bestmove'));
      this.send(`position ${fen ? 'fen ' + fen : 'startpos'}${moves.length ? ' moves ' + moves.join(' ') : ''}`);
      this.send(depth ? `go depth ${depth}` : `go movetime ${movetime || 1000}`);
      const bm = await done;
      this.listeners.delete(info);
      return { bestmove: bm.split(' ')[1], lines: lines.filter(Boolean) };
    });
  }
  stopSearch() { this.send('stop'); }
  terminate() { this.w.terminate(); }
}

/** Unified "opponent" that picks a move for a class/level. */
export class Opponent {
  constructor() { this.forge = null; this.sf = null; }
  async move({ classId, level, startFen, moves, clockMs }) {
    const { cls, lvl } = getLevel(classId, level);
    const budget = clockMs ? Math.max(150, Math.min(clockMs / 30, 4000)) : Infinity;
    if (cls.engine === 'forge') {
      this.forge ||= new ForgeClient();
      const cfg = { ...lvl.cfg, timeMs: Math.min(lvl.cfg.timeMs, budget) };
      const r = await this.forge.go({ startFen, moves, cfg });
      return { uci: r.bestmove, cp: r.score, depth: r.depth, nodes: r.nodes };
    }
    this.sf ||= new Stockfish();
    const r = await this.sf.go({ fen: startFen, moves, movetime: Math.min(lvl.cfg.movetime, budget), elo: lvl.cfg.elo || null });
    const top = r.lines[0] || {};
    return { uci: r.bestmove, cp: top.mate != null ? Math.sign(top.mate) * 10000 : top.cp, depth: top.depth };
  }
  reset() { if (this.sf) this.sf.newGame(); }
}
