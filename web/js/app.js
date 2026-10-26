// Forge Chess — web UI. GPL-3.0-or-later.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Chess } from '../vendor/chess.js';
import { CLASSES, getLevel, Opponent, Stockfish } from './engines.js';
import { analyseGame, CLASS_INFO, winPct, fmtEval, lineCp } from './analysis.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ROMAN = ['I', 'II', 'III'];
const TIME_CONTROLS = [
  { id: 'none', label: 'Untimed' }, { id: '180+2', label: '3 + 2' }, { id: '300+3', label: '5 + 3' },
  { id: '600+5', label: '10 + 5' }, { id: '900+10', label: '15 + 10' }, { id: '1800+0', label: '30 + 0' },
];
const TAG_ADVICE = {
  'hung-piece': ['Hung pieces', 'Before every move ask: "after this, what can they capture, and is it defended?"'],
  'allowed-tactic': ['Allowed tactics', 'Check your opponent\'s forcing replies (checks, captures, threats) before committing.'],
  'missed-tactic': ['Missed tactics', 'Scan for your own checks, captures and threats every move — do 10 puzzles a day.'],
  'missed-mate': ['Missed mates', 'When their king is exposed, calculate every check to the end.'],
  'allowed-mate': ['Allowed mates', 'Watch your back rank and the squares around your king; make luft in time.'],
  'missed-punish': ['Unpunished errors', 'When they just moved, ask "what did that change, what did it leave undefended?"'],
  'king-safety': ['King safety', 'Castle early; do not walk the king before the queens are traded.'],
  'early-queen': ['Early queen', 'Develop knights and bishops before the queen.'],
  'development': ['Slow development', 'In the opening, move each piece once, castle, then connect the rooks.'],
  'endgame-technique': ['Endgame technique', 'Activate the king, push passed pawns, trade pieces when ahead. Study basic endings.'],
  'positional': ['Positional', 'Compare plans with the engine line: piece activity, pawn structure, weak squares.'],
};

// ---------------- API ----------------
const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); },
  async post(p, body) { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; },
};

// ---------------- shared engines ----------------
let opponent = null;
let analyser = null;
const getAnalyser = () => (analyser ||= new Stockfish());

// ---------------- helpers ----------------
function destsOf(chess) {
  const d = new Map();
  for (const m of chess.moves({ verbose: true })) { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); }
  return d;
}
const colorName = (c) => (c === 'w' ? 'white' : 'black');
function replay(startFen, moves) {
  const c = new Chess(startFen || undefined);
  for (const u of moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c;
}
function fmtClock(ms) {
  if (ms == null) return '';
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return ms < 10000 ? `${m}:${String(s % 60).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="modal-card">${html}</div>`; m.classList.remove('hidden'); return m; }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
function pickPromotion(color) {
  return new Promise((res) => {
    const g = color === 'w' ? ['♕', '♖', '♗', '♘'] : ['♛', '♜', '♝', '♞'];
    const m = modal(`<h3>Promote to</h3><div class="promo">${['q', 'r', 'b', 'n'].map((p, i) => `<button data-p="${p}">${g[i]}</button>`).join('')}</div>`);
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { closeModal(); res(b.dataset.p); });
  });
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }

function svgLine(series, { w = 640, h = 180, yMin, yMax, color = '#e07a3f', label = '', fmt = (v) => v, onClick } = {}) {
  if (!series.length) return `<div class="empty">No data yet.</div>`;
  const vals = series.map(p => p.v);
  const lo = yMin ?? Math.min(...vals), hi = yMax ?? Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i) => series.length === 1 ? w / 2 : 24 + (i * (w - 40)) / (series.length - 1);
  const y = (v) => h - 20 - ((v - lo) / span) * (h - 36);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const grid = [lo, lo + span / 2, hi].map(v => `<line x1="20" x2="${w - 10}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="2" y="${y(v) + 4}" class="axis">${fmt(Math.round(v))}</text>`).join('');
  const dots = series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3.5" fill="${color}" data-i="${i}"><title>${esc(p.t || '')} ${fmt(p.v)}</title></circle>`).join('');
  const id = 'c' + Math.random().toString(36).slice(2);
  setTimeout(() => { const el = document.getElementById(id); if (el && onClick) el.querySelectorAll('circle').forEach(c => c.onclick = () => onClick(+c.dataset.i)); });
  return `<svg id="${id}" class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${grid}<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}<text x="${w - 10}" y="14" text-anchor="end" class="axis">${esc(label)}</text></svg>`;
}

// ---------------- router ----------------
let teardown = null;
function route() {
  if (teardown) { try { teardown(); } catch { /* ignore */ } teardown = null; }
  closeModal();
  const h = location.hash.replace(/^#\/?/, '') || 'play';
  const [view, arg] = h.split('/');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view || (view === 'review' && a.dataset.nav === 'games')));
  const views = { play: viewPlay, review: viewReview, games: viewGames, growth: viewGrowth, engines: viewEngines };
  (views[view] || viewPlay)(arg).catch(e => { main.innerHTML = `<div class="panel error">Error: ${esc(e.message)}</div>`; console.error(e); });
}
window.addEventListener('hashchange', route);

// =====================================================================
// PLAY
// =====================================================================
const LS_GAME = 'forge.current', LS_PREFS = 'forge.prefs';
const prefs = () => ({ classId: 1, level: 1, color: 'w', tc: '600+5', rated: true, ...JSON.parse(localStorage.getItem(LS_PREFS) || '{}') });

async function viewPlay() {
  const saved = JSON.parse(localStorage.getItem(LS_GAME) || 'null');
  if (saved && !saved.result) return playGame(saved);
  renderSetup();
}

function renderSetup() {
  const p = prefs();
  main.innerHTML = `
  <section class="setup">
    <h1>New game</h1>
    <p class="muted">Pick an opponent from the ladder. Rated games move your ladder rating; practice games allow hints and takebacks.</p>
    <div class="classes">${CLASSES.map(c => `
      <button class="class-card ${c.id === p.classId ? 'sel' : ''}" data-class="${c.id}">
        <span class="glyph">${c.glyph}</span>
        <span class="cname">Class ${['I', 'II', 'III', 'IV', 'V'][c.id - 1]} · ${c.name}</span>
        <span class="celo">~${c.levels[0].elo}–${c.levels[2].elo}</span>
        <span class="cengine">${c.engine === 'forge' ? 'Forge (ours)' : 'Stockfish 19'}</span>
      </button>`).join('')}</div>
    <p class="blurb" id="blurb"></p>
    <div class="row"><label>Level</label><div class="seg" id="lvl">${[1, 2, 3].map(l => `<button data-l="${l}" class="${l === p.level ? 'sel' : ''}">${ROMAN[l - 1]}</button>`).join('')}</div><span id="lvlElo" class="muted"></span></div>
    <div class="row"><label>Colour</label><div class="seg" id="col">${[['w', 'White'], ['b', 'Black'], ['r', 'Random']].map(([k, n]) => `<button data-c="${k}" class="${k === p.color ? 'sel' : ''}">${n}</button>`).join('')}</div></div>
    <div class="row"><label>Time</label><div class="seg" id="tc">${TIME_CONTROLS.map(t => `<button data-t="${t.id}" class="${t.id === p.tc ? 'sel' : ''}">${t.label}</button>`).join('')}</div></div>
    <div class="row"><label>Mode</label><div class="seg" id="mode"><button data-m="1" class="${p.rated ? 'sel' : ''}">Rated</button><button data-m="0" class="${!p.rated ? 'sel' : ''}">Practice</button></div></div>
    <button class="primary big" id="start">Start game</button>
  </section>`;
  const st = { ...p };
  const sync = () => {
    localStorage.setItem(LS_PREFS, JSON.stringify(st));
    document.querySelectorAll('.class-card').forEach(b => b.classList.toggle('sel', +b.dataset.class === st.classId));
    document.querySelectorAll('#lvl button').forEach(b => b.classList.toggle('sel', +b.dataset.l === st.level));
    document.querySelectorAll('#col button').forEach(b => b.classList.toggle('sel', b.dataset.c === st.color));
    document.querySelectorAll('#tc button').forEach(b => b.classList.toggle('sel', b.dataset.t === st.tc));
    document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('sel', !!+b.dataset.m === st.rated));
    const L = getLevel(st.classId, st.level);
    $('#blurb').textContent = L.cls.blurb;
    $('#lvlElo').textContent = `${L.label} · ~${L.elo} (rough)`;
  };
  document.querySelectorAll('.class-card').forEach(b => b.onclick = () => { st.classId = +b.dataset.class; sync(); });
  document.querySelectorAll('#lvl button').forEach(b => b.onclick = () => { st.level = +b.dataset.l; sync(); });
  document.querySelectorAll('#col button').forEach(b => b.onclick = () => { st.color = b.dataset.c; sync(); });
  document.querySelectorAll('#tc button').forEach(b => b.onclick = () => { st.tc = b.dataset.t; sync(); });
  document.querySelectorAll('#mode button').forEach(b => b.onclick = () => { st.rated = !!+b.dataset.m; sync(); });
  sync();
  $('#start').onclick = () => {
    const userColor = st.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : st.color;
    const L = getLevel(st.classId, st.level);
    const [base, inc] = st.tc === 'none' ? [null, 0] : st.tc.split('+').map(Number);
    const g = {
      source: 'forge', created: new Date().toISOString(), userColor, rated: st.rated,
      engineClass: st.classId, engineLevel: st.level, engineElo: L.elo, opponent: L.label,
      timeControl: st.tc, clock: base ? { w: base * 1000, b: base * 1000, inc: inc * 1000 } : null,
      moves: [], startFen: null, takebacks: 0, hints: 0, result: null,
    };
    localStorage.setItem(LS_GAME, JSON.stringify(g));
    opponent?.reset();
    playGame(g);
  };
}

function playGame(g) {
  opponent ||= new Opponent();
  const L = getLevel(g.engineClass, g.engineLevel);
  const chess = replay(g.startFen, g.moves);
  let thinking = false, lastEngineCp = null, timer = null, turnStarted = performance.now(), showEval = false, dead = false;

  main.innerHTML = `
  <section class="play">
    <div class="board-col">
      <div class="player top-player"><span class="pname" id="topName"></span><span class="clock" id="topClock"></span></div>
      <div class="board-wrap"><div class="evalbar hidden" id="evalbar"><div class="fill"></div></div><div id="board" class="board"></div></div>
      <div class="player bottom-player"><span class="pname" id="botName"></span><span class="clock" id="botClock"></span></div>
    </div>
    <aside class="side">
      <div class="panel">
        <div class="gtitle">${esc(L.label)} <span class="muted">~${L.elo} · ${g.rated ? 'Rated' : 'Practice'} · ${esc((TIME_CONTROLS.find(t => t.id === g.timeControl) || {}).label || '')}</span></div>
        <div id="status" class="status"></div>
        <div id="movelist" class="movelist"></div>
        <div class="btns">
          <button id="flip">Flip</button>
          ${g.rated ? '' : '<button id="hint">Hint</button><button id="undo">Takeback</button><button id="evalT">Eval</button>'}
          <button id="draw">Offer draw</button>
          <button id="resign" class="danger">Resign</button>
        </div>
      </div>
    </aside>
  </section>`;

  const cg = Chessground($('#board'), {
    fen: chess.fen(), orientation: colorName(g.userColor), turnColor: colorName(chess.turn()),
    movable: { free: false, color: colorName(g.userColor), dests: destsOf(chess), showDests: true, events: { after: onUserMove } },
    premovable: { enabled: true }, highlight: { lastMove: true, check: true }, animation: { duration: 220 },
    lastMove: g.moves.length ? [g.moves.at(-1).slice(0, 2), g.moves.at(-1).slice(2, 4)] : undefined,
    check: chess.inCheck(),
  });
  $('#topName').textContent = g.userColor === 'w' ? `${L.cls.glyph} ${L.label}` : 'You';
  $('#botName').textContent = g.userColor === 'w' ? 'You' : `${L.cls.glyph} ${L.label}`;

  const persist = () => localStorage.setItem(LS_GAME, JSON.stringify(g));
  function renderMoves() {
    const h = chess.history();
    let html = '';
    for (let i = 0; i < h.length; i += 2) html += `<span class="mn">${i / 2 + 1}.</span><span class="mv">${esc(h[i])}</span><span class="mv">${esc(h[i + 1] || '')}</span>`;
    const ml = $('#movelist'); ml.innerHTML = html; ml.scrollTop = ml.scrollHeight;
  }
  function renderClocks() {
    if (!g.clock) { $('#topClock').textContent = ''; $('#botClock').textContent = ''; return; }
    const live = { ...g.clock };
    if (!g.result && g.moves.length >= 2) live[chess.turn()] -= performance.now() - turnStarted;
    const top = g.userColor === 'w' ? 'b' : 'w', bot = g.userColor;
    $('#topClock').textContent = fmtClock(live[top]); $('#botClock').textContent = fmtClock(live[bot]);
    $('#topClock').classList.toggle('run', chess.turn() === top && !g.result);
    $('#botClock').classList.toggle('run', chess.turn() === bot && !g.result);
    $('#botClock').classList.toggle('low', live[bot] < 20000);
    if (!g.result && live[chess.turn()] <= 0) finish(chess.turn() === 'w' ? '0-1' : '1-0', 'timeout');
  }
  function setStatus(t) { $('#status').textContent = t; }
  function sync() {
    cg.set({
      fen: chess.fen(), turnColor: colorName(chess.turn()), check: chess.inCheck(),
      movable: { color: g.result ? undefined : colorName(g.userColor), dests: g.result || thinking ? new Map() : destsOf(chess) },
      lastMove: g.moves.length ? [g.moves.at(-1).slice(0, 2), g.moves.at(-1).slice(2, 4)] : undefined,
    });
    renderMoves(); renderClocks();
    if (!g.result) setStatus(chess.turn() === g.userColor ? 'Your move' : `${L.label} is thinking…`);
  }
  function chargeClock() {
    if (!g.clock || g.moves.length < 2) { turnStarted = performance.now(); return; }
    const mover = chess.turn() === 'w' ? 'b' : 'w'; // already moved
    g.clock[mover] -= performance.now() - turnStarted;
    g.clock[mover] += g.clock.inc;
    turnStarted = performance.now();
  }
  function checkEnd() {
    if (chess.isCheckmate()) return finish(chess.turn() === 'w' ? '0-1' : '1-0', 'checkmate');
    if (chess.isStalemate()) return finish('1/2-1/2', 'stalemate');
    if (chess.isInsufficientMaterial()) return finish('1/2-1/2', 'insufficient material');
    if (chess.isThreefoldRepetition()) return finish('1/2-1/2', 'threefold repetition');
    if (chess.isDraw()) return finish('1/2-1/2', '50-move rule');
    return false;
  }
  async function finish(result, termination) {
    if (g.result) return true;
    g.result = result; g.termination = termination; g.ended = new Date().toISOString();
    clearInterval(timer);
    const c2 = replay(g.startFen, g.moves);
    c2.setHeader('Event', `Forge Chess ${g.rated ? 'rated' : 'practice'}`);
    c2.setHeader('White', g.userColor === 'w' ? 'Ryan' : L.label);
    c2.setHeader('Black', g.userColor === 'b' ? 'Ryan' : L.label);
    c2.setHeader('Result', result); c2.setHeader('Date', g.created.slice(0, 10).replace(/-/g, '.'));
    g.pgn = c2.pgn();
    sync();
    const you = (result === '1-0' && g.userColor === 'w') || (result === '0-1' && g.userColor === 'b');
    const msg = result === '1/2-1/2' ? `Draw — ${termination}` : you ? `You won — ${termination}` : `You lost — ${termination}`;
    setStatus(msg);
    try {
      const { id } = await api.post('/api/games', g);
      localStorage.removeItem(LS_GAME);
      const m = modal(`<h3>${esc(msg)}</h3><p>${g.moves.length} plies · ${esc(L.label)}</p><div class="btns"><button class="primary" id="rv">Review this game</button><button id="again">New game</button></div>`);
      m.querySelector('#rv').onclick = () => { closeModal(); location.hash = `#/review/${id}`; };
      m.querySelector('#again').onclick = () => { closeModal(); renderSetup(); };
    } catch (e) {
      toast('Could not save to server: ' + e.message + ' (kept locally)');
      g.unsaved = true; persist();
    }
    return true;
  }
  async function engineTurn() {
    if (g.result || chess.turn() === g.userColor || dead) return;
    thinking = true; sync();
    try {
      const clockMs = g.clock ? g.clock[chess.turn()] : null;
      const t0 = performance.now();
      const r = await opponent.move({ classId: g.engineClass, level: g.engineLevel, startFen: g.startFen, moves: g.moves, clockMs });
      if (dead || g.result) return;
      // small floor so instant moves still feel like a move
      const wait = Math.max(0, 250 - (performance.now() - t0)); if (wait) await new Promise(r2 => setTimeout(r2, wait));
      lastEngineCp = r.cp;
      chess.move({ from: r.uci.slice(0, 2), to: r.uci.slice(2, 4), promotion: r.uci[4] });
      g.moves.push(r.uci);
      chargeClock(); persist();
    } finally { thinking = false; }
    sync();
    if (!checkEnd()) { cg.playPremove(); if (showEval) updateEval(); }
  }
  async function onUserMove(orig, dest) {
    if (g.result || thinking) return;
    const piece = chess.get(orig);
    let promotion;
    if (piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) promotion = await pickPromotion(piece.color);
    try { chess.move({ from: orig, to: dest, promotion }); } catch { sync(); return; }
    g.moves.push(orig + dest + (promotion || ''));
    chargeClock(); persist();
    cg.setAutoShapes([]);
    sync();
    if (!checkEnd()) engineTurn();
  }
  async function updateEval() {
    const bar = $('#evalbar'); bar.classList.remove('hidden');
    const r = await getAnalyser().go({ fen: chess.fen(), depth: 12 });
    const cp = lineCp(r.lines[0]); const white = chess.turn() === 'w' ? cp : -cp;
    bar.querySelector('.fill').style.height = winPct(white) + '%';
    bar.title = fmtEval(white);
  }

  $('#flip').onclick = () => cg.toggleOrientation();
  $('#resign').onclick = () => { if (confirm('Resign this game?')) finish(g.userColor === 'w' ? '0-1' : '1-0', 'resignation'); };
  $('#draw').onclick = () => {
    if (g.moves.length < 30) return toast('Draw declined: too early.');
    if (lastEngineCp != null && lastEngineCp <= 25) finish('1/2-1/2', 'agreement'); else toast(`${L.label} declines the draw.`);
  };
  if (!g.rated) {
    $('#hint').onclick = async () => {
      if (chess.turn() !== g.userColor || g.result) return;
      g.hints++; persist(); setStatus('Thinking about a hint…');
      const r = await getAnalyser().go({ fen: chess.fen(), depth: 14 });
      cg.setAutoShapes([{ orig: r.bestmove.slice(0, 2), dest: r.bestmove.slice(2, 4), brush: 'green' }]);
      setStatus('Hint shown (green arrow)');
    };
    $('#undo').onclick = () => {
      if (thinking || g.result || g.moves.length < 1) return;
      const n = chess.turn() === g.userColor ? 2 : 1;
      for (let i = 0; i < n && g.moves.length; i++) { chess.undo(); g.moves.pop(); }
      g.takebacks++; persist(); cg.setAutoShapes([]); sync();
    };
    $('#evalT').onclick = () => { showEval = !showEval; if (showEval) updateEval(); else $('#evalbar').classList.add('hidden'); };
  }
  timer = setInterval(renderClocks, 200);
  teardown = () => { dead = true; clearInterval(timer); cg.destroy(); };
  sync();
  if (g.unsaved && g.result) { finish(g.result, g.termination); }
  else engineTurn();
}

// =====================================================================
// REVIEW
// =====================================================================
async function viewReview(id) {
  const g = await api.get(`/api/games/${id}`);
  const userColor = g.userColor || 'w';
  main.innerHTML = `
  <section class="review">
    <div class="board-col">
      <div class="board-wrap"><div class="evalbar" id="evalbar"><div class="fill"></div><span class="evtxt" id="evtxt"></span></div><div id="board" class="board"></div></div>
      <div class="nav-btns"><button data-n="first">⏮</button><button data-n="prev">◀</button><button data-n="next">▶</button><button data-n="last">⏭</button><button id="flip">Flip</button></div>
      <div id="graph" class="graph"></div>
    </div>
    <aside class="side">
      <div class="panel"><div class="gtitle">${esc(g.opponent || 'Game')} <span class="muted">${esc((g.created || '').slice(0, 10))} · ${esc(g.result || '')} ${esc(g.termination || '')}</span></div>
        <div id="summary"></div></div>
      <div class="panel" id="moveinfo"></div>
      <div class="panel"><div id="rmoves" class="rmoves"></div></div>
      <div class="panel"><label class="muted" for="notes">What I was thinking / lesson from this game</label>
        <textarea id="notes" rows="3" placeholder="e.g. I rushed move 18 because I was low on time.">${esc(g.notes || '')}</textarea>
        <div class="btns"><button id="saveNotes">Save notes</button><button id="reanalyse">Re-analyse (deep)</button><button id="pgn">Copy PGN</button><button id="archive" class="danger">Archive</button></div></div>
    </aside>
  </section>`;

  const cg = Chessground($('#board'), {
    fen: g.startFen || undefined, orientation: colorName(userColor), viewOnly: false,
    movable: { free: false, showDests: true, events: { after: onExplore } }, highlight: { lastMove: true, check: true },
    drawable: { enabled: true },
  });
  let cur = g.moves.length; // ply index shown (position after `cur` moves)
  let explore = null; // {base, moves:[]}
  let exploreToken = 0;
  let A = g.analysis;

  async function runAnalysis(depth) {
    $('#moveinfo').innerHTML = `<div class="progress"><div class="bar" id="pbar"></div></div><p class="muted" id="ptxt">Analysing with Stockfish 19 (depth ${depth})… this runs on your device.</p>`;
    const t0 = performance.now();
    A = await analyseGame({ engine: getAnalyser(), moves: g.moves, startFen: g.startFen, depth, userColor,
      onProgress: (i, n) => { const b = $('#pbar'); if (b) { b.style.width = (100 * i / n) + '%'; $('#ptxt').textContent = `Analysing position ${i}/${n} (depth ${depth})…`; } } });
    delete A.fens;
    A.ms = Math.round(performance.now() - t0); A.when = new Date().toISOString();
    g.analysis = A;
    try { await api.post('/api/games', g); } catch (e) { toast('Analysis not saved: ' + e.message); }
  }
  if (!A && g.moves.length) await runAnalysis(14);

  const fens = (() => { const c = new Chess(g.startFen || undefined); const f = [c.fen()]; for (const u of g.moves) { c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); f.push(c.fen()); } return f; })();

  function renderSummary() {
    if (!A) { $('#summary').innerHTML = '<p class="muted">No moves to analyse.</p>'; return; }
    const s = A.summary;
    const sideHtml = (c) => { const x = s[c]; return `<div class="sumside ${c === userColor ? 'me' : ''}"><div class="who">${c === 'w' ? 'White' : 'Black'}${c === userColor ? ' (you)' : ''}</div><div class="acc">${x.accuracy}%</div><div class="muted">accuracy · ACPL ${x.acpl}</div>
      <div class="counts">${['best', 'great', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'].map(k => `<span style="color:${CLASS_INFO[k].color}" title="${CLASS_INFO[k].label}">${CLASS_INFO[k].sym} ${x.counts[k]}</span>`).join('')}</div></div>`; };
    const me = s[userColor];
    const phases = Object.entries(me.phases).filter(([, v]) => v != null).map(([k, v]) => `<span class="chip">${k} ${v}%</span>`).join('');
    const crit = (s.critical || []).map(p => { const m = A.moves[p]; return `<button class="chip crit" data-ply="${p}">${Math.floor(p / 2) + 1}${m.mover === 'w' ? '.' : '…'} ${esc(m.san)} ${CLASS_INFO[m.cls].sym}</button>`; }).join('');
    $('#summary').innerHTML = `<div class="sumgrid">${sideHtml('w')}${sideHtml('b')}</div>
      <div class="muted small">Your accuracy by phase</div><div class="chips">${phases || '—'}</div>
      <div class="muted small">Critical moments — click to study</div><div class="chips">${crit || '<span class="muted">No mistakes worth flagging. Clean game.</span>'}</div>
      <div class="muted small">${esc(A.engine)} · depth ${A.depth}${A.ms ? ` · ${(A.ms / 1000).toFixed(0)}s` : ''}</div>`;
    $('#summary').querySelectorAll('[data-ply]').forEach(b => b.onclick = () => go(+b.dataset.ply + 1));
  }
  function renderMoves() {
    let html = '';
    for (let i = 0; i < g.moves.length; i++) {
      const m = A ? A.moves[i] : null;
      const sanText = m ? m.san : '';
      if (i % 2 === 0) html += `<span class="mn">${i / 2 + 1}.</span>`;
      const ci = m ? CLASS_INFO[m.cls] : null;
      html += `<span class="mv ${cur === i + 1 && !explore ? 'cur' : ''}" data-ply="${i + 1}">${esc(sanText)}${ci && ['inaccuracy', 'mistake', 'blunder', 'great'].includes(m.cls) ? `<b style="color:${ci.color}">${ci.sym}</b>` : ''}</span>`;
    }
    const el = $('#rmoves'); el.innerHTML = html;
    el.querySelectorAll('[data-ply]').forEach(s => s.onclick = () => go(+s.dataset.ply));
    const c = el.querySelector('.cur'); if (c) c.scrollIntoView({ block: 'nearest' });
  }
  function renderGraph() {
    if (!A) return;
    const w = 600, h = 110;
    const vals = [0, ...A.moves.map(m => m.mateWhite != null ? (m.mateWhite > 0 ? 100 : 0) : winPct(m.evalWhite))].map((v, i) => i === 0 ? 50 : v);
    const x = (i) => (i * w) / Math.max(1, vals.length - 1), y = (v) => h - (v / 100) * h;
    const area = `M0,${h} ` + vals.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L${w},${h} Z`;
    const marks = A.moves.map((m, i) => ['mistake', 'blunder'].includes(m.cls) ? `<circle cx="${x(i + 1)}" cy="${y(vals[i + 1])}" r="3.5" fill="${CLASS_INFO[m.cls].color}"/>` : '').join('');
    $('#graph').innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="evgraph"><rect width="${w}" height="${h}" fill="#2b2622"/><path d="${area}" fill="#ece6dc"/><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#e07a3f" stroke-dasharray="4 4" stroke-width="1"/>${marks}<line id="gcur" x1="0" x2="0" y1="0" y2="${h}" stroke="#e07a3f" stroke-width="2"/></svg>`;
    const svg = $('#graph svg');
    svg.onclick = (e) => { const r = svg.getBoundingClientRect(); go(Math.round(((e.clientX - r.left) / r.width) * (vals.length - 1))); };
    svg._x = x;
  }
  function renderInfo() {
    const box = $('#moveinfo');
    if (explore) {
      box.innerHTML = `<div class="gtitle">Exploring <span class="muted">from move ${Math.floor(explore.base / 2) + 1}</span></div><div id="exline" class="muted">${esc(explore.san.join(' '))}</div><div id="exeval" class="exeval">…</div><div class="btns"><button id="back">Back to game</button></div>`;
      $('#back').onclick = () => { explore = null; go(cur); };
      return;
    }
    if (!A || cur === 0) { box.innerHTML = `<p class="muted">Start position. Use ◀ ▶ or the arrow keys. Drag pieces to explore alternatives.</p>`; return; }
    const m = A.moves[cur - 1];
    const ci = CLASS_INFO[m.cls];
    const mine = m.mover === userColor;
    box.innerHTML = `<div class="minfo"><span class="badge" style="background:${ci.color}">${ci.sym}</span>
      <div><div class="mtitle">${Math.floor(m.ply / 2) + 1}${m.mover === 'w' ? '.' : '…'} ${esc(m.san)} — ${ci.label}${mine ? '' : ' <span class="muted">(opponent)</span>'}</div>
      <div class="muted">Eval ${fmtEval(m.evalWhite, m.mateWhite)} · win chance ${m.wpBefore}% → ${m.wpAfter}% · accuracy ${m.accuracy}%</div></div></div>
      ${m.text.length ? `<ul class="why">${m.text.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${m.bestUci && m.bestUci !== m.uci ? `<div class="btns"><button id="showBest">Show best move</button><button id="tryBest">Play the best line</button></div>` : ''}`;
    const sb = $('#showBest');
    if (sb) {
      sb.onclick = () => cg.setAutoShapes([{ orig: m.bestUci.slice(0, 2), dest: m.bestUci.slice(2, 4), brush: 'green' }, { orig: m.uci.slice(0, 2), dest: m.uci.slice(2, 4), brush: 'red' }]);
      $('#tryBest').onclick = () => { go(cur - 1); setTimeout(() => onExplore(m.bestUci.slice(0, 2), m.bestUci.slice(2, 4), m.bestUci[4]), 50); };
    }
  }
  function setEvalBar(white, mate) {
    $('#evalbar .fill').style.height = (mate != null ? (mate > 0 ? 100 : 0) : winPct(white)) + '%';
    $('#evtxt').textContent = fmtEval(white, mate);
  }
  function go(ply) {
    explore = null;
    cur = Math.max(0, Math.min(g.moves.length, ply));
    const c = new Chess(fens[cur]);
    const last = cur ? g.moves[cur - 1] : null;
    cg.set({ fen: fens[cur], turnColor: colorName(c.turn()), check: c.inCheck(), lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined, movable: { color: colorName(c.turn()), dests: destsOf(c) } });
    const m = A && cur ? A.moves[cur - 1] : null;
    const shapes = [];
    if (m && m.bestUci && m.bestUci !== m.uci && ['inaccuracy', 'mistake', 'blunder'].includes(m.cls)) shapes.push({ orig: m.bestUci.slice(0, 2), dest: m.bestUci.slice(2, 4), brush: 'green' });
    cg.setAutoShapes(shapes);
    if (m) setEvalBar(m.evalWhite, m.mateWhite); else setEvalBar(0, null);
    const gl = $('#gcur'); if (gl && $('#graph svg')._x) { const xx = $('#graph svg')._x(cur); gl.setAttribute('x1', xx); gl.setAttribute('x2', xx); }
    renderMoves(); renderInfo();
  }
  async function onExplore(orig, dest, promo) {
    const base = explore ? explore : { base: cur, moves: [], san: [] };
    const c = new Chess(fens[base.base]);
    for (const u of base.moves) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    const piece = c.get(orig);
    let promotion = promo;
    if (!promotion && piece && piece.type === 'p' && (dest[1] === '8' || dest[1] === '1')) promotion = await pickPromotion(piece.color);
    let mv; try { mv = c.move({ from: orig, to: dest, promotion }); } catch { go(cur); return; }
    // Playing the game move from the game position just steps forward.
    if (!explore && g.moves[cur] === orig + dest + (promotion || '')) { go(cur + 1); return; }
    base.moves.push(orig + dest + (promotion || '')); base.san.push(mv.san);
    explore = base;
    cg.set({ fen: c.fen(), turnColor: colorName(c.turn()), check: c.inCheck(), lastMove: [orig, dest], movable: { color: colorName(c.turn()), dests: destsOf(c) } });
    cg.setAutoShapes([]);
    renderMoves(); renderInfo();
    const tok = ++exploreToken;
    if (c.isGameOver()) { $('#exeval').textContent = c.isCheckmate() ? 'Checkmate' : 'Draw'; return; }
    const r = await getAnalyser().go({ fen: c.fen(), depth: 16, multipv: 3 });
    if (tok !== exploreToken || !explore) return;
    const turn = c.turn();
    const rows = r.lines.map(l => { const cp = lineCp(l); const wcp = turn === 'w' ? cp : -cp; const wm = l.mate != null ? (turn === 'w' ? l.mate : -l.mate) : null;
      const cc = new Chess(c.fen()); const sans = []; for (const u of l.pv.slice(0, 6)) { try { sans.push(cc.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; } }
      return `<div><b>${fmtEval(wcp, wm)}</b> ${esc(sans.join(' '))}</div>`; });
    $('#exeval').innerHTML = rows.join('');
    const top = r.lines[0]; if (top) { const cp = lineCp(top); setEvalBar(turn === 'w' ? cp : -cp, top.mate != null ? (turn === 'w' ? top.mate : -top.mate) : null); cg.setAutoShapes([{ orig: r.bestmove.slice(0, 2), dest: r.bestmove.slice(2, 4), brush: 'blue' }]); }
  }

  document.querySelectorAll('[data-n]').forEach(b => b.onclick = () => ({ first: () => go(0), prev: () => go(cur - 1), next: () => go(cur + 1), last: () => go(g.moves.length) })[b.dataset.n]());
  $('#flip').onclick = () => cg.toggleOrientation();
  const onKey = (e) => { if (e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowLeft') go(cur - 1); if (e.key === 'ArrowRight') go(cur + 1); if (e.key === 'Home') go(0); if (e.key === 'End') go(g.moves.length); };
  window.addEventListener('keydown', onKey);
  $('#saveNotes').onclick = async () => { g.notes = $('#notes').value; await api.post('/api/games', g); toast('Notes saved'); };
  $('#reanalyse').onclick = async () => { await runAnalysis(18); renderSummary(); renderGraph(); go(cur); };
  $('#pgn').onclick = async () => { const c = replay(g.startFen, g.moves); const text = g.pgn || c.pgn(); try { await navigator.clipboard.writeText(text); toast('PGN copied'); } catch { modal(`<h3>PGN</h3><textarea rows="10" style="width:100%">${esc(text)}</textarea><div class="btns"><button onclick="document.getElementById('modal').classList.add('hidden')">Close</button></div>`); } };
  $('#archive').onclick = async () => { if (!confirm('Archive this game? It leaves your stats but stays in the database.')) return; await api.post(`/api/games/${id}/archive`, {}); location.hash = '#/games'; };
  teardown = () => { window.removeEventListener('keydown', onKey); cg.destroy(); exploreToken++; };

  renderSummary(); renderGraph();
  const crit = A && A.summary.critical && A.summary.critical[0];
  go(crit != null ? crit + 1 : g.moves.length);
}

// =====================================================================
// GAMES
// =====================================================================
async function viewGames() {
  const games = await api.get('/api/games');
  const resFor = (g) => { const sc = g.result === '1/2-1/2' ? 'd' : ((g.result === '1-0') === (g.user_color === 'w')) ? 'w' : 'l'; return `<span class="res res-${sc}">${sc === 'w' ? 'Win' : sc === 'd' ? 'Draw' : 'Loss'}</span>`; };
  main.innerHTML = `
  <section class="games">
    <div class="head"><h1>Games</h1><div class="btns"><button id="imp" class="primary">Import PGN</button><a class="btn" href="/api/export">Export all (JSON)</a></div></div>
    ${games.length ? `<table class="gtable"><thead><tr><th>Date</th><th>Opponent</th><th>Colour</th><th>Result</th><th>Accuracy</th><th>??/?/?!</th><th>Plies</th><th></th></tr></thead><tbody>
    ${games.map(g => `<tr data-id="${g.id}"><td>${esc((g.created || '').slice(0, 10))}</td><td>${esc(g.opponent)}${g.rated ? '' : ' <span class="muted">(practice)</span>'}${g.source === 'import' ? ' <span class="muted">(import)</span>' : ''}</td>
      <td>${g.user_color === 'w' ? '○ White' : '● Black'}</td><td>${resFor(g)} <span class="muted">${esc(g.termination || '')}</span></td>
      <td>${g.user_accuracy != null ? g.user_accuracy + '%' : '<span class="muted">—</span>'}</td>
      <td>${g.blunders ?? '–'}/${g.mistakes ?? '–'}/${g.inaccuracies ?? '–'}</td><td>${g.plies}</td><td><a href="#/review/${g.id}">Review →</a></td></tr>`).join('')}
    </tbody></table>` : '<div class="panel empty">No games yet. <a href="#/play">Play your first one.</a></div>'}
  </section>`;
  document.querySelectorAll('tr[data-id]').forEach(tr => tr.ondblclick = () => location.hash = `#/review/${tr.dataset.id}`);
  $('#imp').onclick = () => {
    const m = modal(`<h3>Import a game</h3><p class="muted">Paste a PGN from chess.com, lichess or over-the-board. It will be reviewed like any Forge game (not rated).</p>
      <textarea id="pgnIn" rows="10" style="width:100%" placeholder="[Event &quot;...&quot;]&#10;1. e4 e5 2. Nf3 ..."></textarea>
      <div class="row"><label>I played</label><div class="seg" id="ic"><button data-c="w" class="sel">White</button><button data-c="b">Black</button></div></div>
      <div class="btns"><button class="primary" id="doImp">Import & review</button><button id="cancel">Cancel</button></div>`);
    let color = 'w';
    m.querySelectorAll('#ic button').forEach(b => b.onclick = () => { color = b.dataset.c; m.querySelectorAll('#ic button').forEach(x => x.classList.toggle('sel', x === b)); });
    m.querySelector('#cancel').onclick = closeModal;
    m.querySelector('#doImp').onclick = async () => {
      const text = m.querySelector('#pgnIn').value.trim();
      const c = new Chess();
      try { c.loadPgn(text); } catch (e) { return toast('Could not read PGN: ' + e.message); }
      const h = c.getHeaders ? c.getHeaders() : c.header();
      const hist = c.history({ verbose: true });
      const startFen = h.FEN || null;
      const result = ['1-0', '0-1', '1/2-1/2'].includes(h.Result) ? h.Result : (c.isCheckmate() ? (c.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2');
      const opp = color === 'w' ? h.Black : h.White;
      const g = { source: 'import', created: new Date().toISOString(), userColor: color, rated: false, opponent: opp || 'Imported game',
        result, termination: h.Termination || 'imported', timeControl: h.TimeControl || null, moves: hist.map(x => x.lan), startFen, pgn: text, headers: h };
      const { id } = await api.post('/api/games', g);
      closeModal(); location.hash = `#/review/${id}`;
    };
  };
}

// =====================================================================
// GROWTH
// =====================================================================
async function viewGrowth() {
  const s = await api.get('/api/stats');
  const names = Object.fromEntries(CLASSES.map(c => [c.id, c.name]));
  // next challenge: first level on the ladder where score < 50% (or never played)
  const rec = Object.fromEntries(s.perClass.map(p => [`${p.class}-${p.level}`, p]));
  let next = null;
  outer: for (const c of CLASSES) for (let l = 1; l <= 3; l++) { const r = rec[`${c.id}-${l}`]; const n = r ? r.w + r.d + r.l : 0; const score = n ? (r.w + r.d / 2) / n : 0; if (n < 3 || score < 0.5) { next = { c, l, n, score }; break outer; } }
  const tags = Object.entries(s.tagsRecent);
  const tagMax = Math.max(1, ...tags.map(([, n]) => n));
  main.innerHTML = `
  <section class="growth">
    <h1>Growth</h1>
    <div class="cards">
      <div class="stat"><div class="big">${s.rating}</div><div class="muted">ladder rating · ${s.totals.rated} rated games</div></div>
      <div class="stat"><div class="big">${s.avgAccuracy20 ?? '—'}${s.avgAccuracy20 != null ? '%' : ''}</div><div class="muted">avg accuracy (last 20)</div></div>
      <div class="stat"><div class="big">${s.avgBlunders20 ?? '—'}</div><div class="muted">blunders / game (last 20)</div></div>
      <div class="stat"><div class="big">${s.totals.wins}/${s.totals.draws}/${s.totals.losses}</div><div class="muted">W / D / L · ${s.totals.games} games</div></div>
    </div>
    ${next ? `<div class="panel next"><b>Next challenge:</b> ${esc(next.c.name)} ${ROMAN[next.l - 1]} (~${next.c.levels[next.l - 1].elo}). ${next.n ? `You score ${Math.round(next.score * 100)}% over ${next.n} games — beat it to 50%+ over 3 games to climb.` : 'Not played yet — play 3 games here.'} <a href="#/play" id="goNext">Play it →</a></div>` : '<div class="panel next">You have cleared the whole ladder. Hephaestus bows.</div>'}
    <div class="panel"><h3>Ladder rating</h3>${svgLine(s.ratingHistory.map(p => ({ v: p.rating, t: p.t.slice(0, 10) })), { label: 'Elo vs ladder', onClick: (i) => location.hash = `#/review/${s.ratingHistory[i].id}` })}</div>
    <div class="panel"><h3>Accuracy per game</h3>${svgLine(s.accuracy.map(p => ({ v: p.acc, t: p.t.slice(0, 10) })), { yMin: 0, yMax: 100, color: '#5bc0be', label: 'accuracy %', onClick: (i) => location.hash = `#/review/${s.accuracy[i].id}` })}</div>
    <div class="two">
      <div class="panel"><h3>Accuracy by phase <span class="muted small">last 20 reviewed</span></h3>
        ${['opening', 'middlegame', 'endgame'].map(ph => { const v = s.phaseAccuracy[ph]; return `<div class="hbar"><span>${ph}</span><div class="track"><div class="fillb" style="width:${v || 0}%"></div></div><b>${v ?? '—'}${v != null ? '%' : ''}</b></div>`; }).join('')}
      </div>
      <div class="panel"><h3>Recurring mistakes <span class="muted small">last 30 reviewed</span></h3>
        ${tags.length ? tags.map(([t, n]) => `<div class="hbar"><span>${esc((TAG_ADVICE[t] || [t])[0])}</span><div class="track"><div class="fillb red" style="width:${(100 * n) / tagMax}%"></div></div><b>${n}</b></div><div class="advice">${esc((TAG_ADVICE[t] || ['', ''])[1])}</div>`).join('') : '<div class="empty">Review some games to see patterns.</div>'}
      </div>
    </div>
    <div class="panel"><h3>Record by engine class</h3>
      <div class="ladder">${CLASSES.map(c => `<div class="lrow"><span class="lname">${c.glyph} ${esc(c.name)}</span>${[1, 2, 3].map(l => { const r = rec[`${c.id}-${l}`]; const n = r ? r.w + r.d + r.l : 0; const sc = n ? Math.round(100 * (r.w + r.d / 2) / n) : null; return `<span class="lcell ${sc == null ? '' : sc >= 50 ? 'good' : 'bad'}" title="${n} games">${ROMAN[l - 1]} · ${r ? `${r.w}-${r.d}-${r.l}` : '—'}</span>`; }).join('')}</div>`).join('')}</div>
    </div>
    <p class="muted small">Ladder rating is Elo computed only from rated games against the engine ladder, starting at 800, using the classes' rough Elo targets. It measures progress on this ladder, not a FIDE/lichess rating.</p>
  </section>`;
  const gn = $('#goNext'); if (gn && next) gn.onclick = () => { const p = prefs(); localStorage.setItem(LS_PREFS, JSON.stringify({ ...p, classId: next.c.id, level: next.l })); };
  void names;
}

// =====================================================================
// ENGINES
// =====================================================================
async function viewEngines() {
  main.innerHTML = `
  <section class="engines">
    <h1>The ladder</h1>
    <p class="muted">Five classes, three levels each. Classes I–III are <b>Forge</b>, our own engine (js/forge-engine.js) — ours to read, tune and improve. Classes IV–V are <b>Stockfish 19</b>. Everything runs in your browser; the server only stores games.</p>
    ${CLASSES.map(c => `<div class="panel eng"><div class="eglyph">${c.glyph}</div><div><h3>Class ${['I', 'II', 'III', 'IV', 'V'][c.id - 1]} · ${esc(c.name)}</h3><p>${esc(c.blurb)}</p>
      <table class="etable"><tr><th>Level</th><th>~Elo</th><th>Settings</th></tr>${c.levels.map((l, i) => `<tr><td>${ROMAN[i]}</td><td>${l.elo}</td><td><code>${esc(JSON.stringify(l.cfg))}</code></td></tr>`).join('')}</table></div></div>`).join('')}
    <div class="panel"><h3>How review works</h3>
      <p>Every position of a finished game is searched by Stockfish 19 (depth 14 by default, 18 for "deep") with two candidate lines. Each move gets a win-chance before/after (lichess model), an accuracy score, and a class: Best, Only move, Excellent, Good, Inaccuracy (−5% win chance), Mistake (−10%), Blunder (−15%). For errors Forge explains <i>why</i>: hung pieces, tactics allowed or missed, missed mates, unpunished errors, and simple opening/endgame heuristics. Those tags feed the Growth page.</p>
      <p class="muted">Elo targets are rough and uncalibrated. Calibrate them with <code>node tools/match.mjs</code> (engine vs engine) as the ladder evolves.</p></div>
  </section>`;
}

route();
