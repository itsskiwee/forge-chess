// Game review: per-move evaluation, classification, accuracy and plain-language
// explanations of what went wrong. GPL-3.0-or-later.
import { Chess } from '../vendor/chess.js';

const PV = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Lichess win-probability model. cp from mover's view -> 0..100
export function winPct(cp) { return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); }
export function moveAccuracy(drop) { return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669)); }

// Convert an engine line to a single centipawn number (side-to-move view).
export function lineCp(line) {
  if (!line) return 0;
  if (line.mate != null) return line.mate > 0 ? 10000 - line.mate * 10 : -10000 - line.mate * 10;
  return line.cp;
}
export function fmtEval(cpWhite, mateWhite) {
  if (mateWhite != null) return (mateWhite > 0 ? '#' : '#-') + Math.abs(mateWhite);
  const v = cpWhite / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

export const CLASS_INFO = {
  best:       { label: 'Best',       sym: '★', color: '#5bc0be' },
  great:      { label: 'Only move',  sym: '!',  color: '#3fa7ff' },
  excellent:  { label: 'Excellent',  sym: '✓', color: '#7bc96f' },
  good:       { label: 'Good',       sym: '·',  color: '#9aa5b1' },
  book:       { label: 'Book',       sym: '📖', color: '#a88b5e' },
  inaccuracy: { label: 'Inaccuracy', sym: '?!', color: '#f2c94c' },
  mistake:    { label: 'Mistake',    sym: '?',  color: '#f2994a' },
  blunder:    { label: 'Blunder',    sym: '??', color: '#eb5757' },
  forced:     { label: 'Forced',     sym: '□',  color: '#9aa5b1' },
};

function material(chess, color) {
  let m = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) m += (sq.color === color ? 1 : -1) * PV[sq.type];
  return m;
}
function nonPawnMaterial(chess) {
  let m = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'p' && sq.type !== 'k') m += PV[sq.type];
  return m;
}
function isCapture(chess, uci) { const p = chess.get(uci.slice(2, 4)); return !!p || (chess.get(uci.slice(0, 2)) || {}).type === 'p' && uci[0] !== uci[2]; }
export function phaseOf(chess, ply) {
  const npm = nonPawnMaterial(chess);
  if (npm <= 26) return 'endgame';
  if (ply < 20 && npm >= 54) return 'opening';
  return 'middlegame';
}

// Play a UCI line on a copy, return SAN list and material trajectory for `color`.
function playLine(fen, uciLine, maxPlies, color) {
  const c = new Chess(fen);
  const san = [], mats = [material(c, color)], caps = [];
  for (const u of uciLine.slice(0, maxPlies)) {
    let mv;
    try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    san.push(mv.san); mats.push(material(c, color));
    caps.push(mv.captured ? { by: mv.color, piece: mv.captured, sq: mv.to, san: mv.san } : null);
  }
  return { san, mats, caps, chess: c };
}
// Index into r.mats of the last position (within the line) reached by a non-capture move,
// i.e. after the exchanges have finished. Falls back to the end of the line.
function settled(r) {
  for (let i = r.caps.length; i >= 1; i--) if (!r.caps[i - 1]) return i;
  return r.caps.length;
}
function lineSan(fen, uciLine, n = 6) {
  const c = new Chess(fen); const parts = [];
  for (const u of uciLine.slice(0, n)) {
    const turn = c.turn(), num = c.moveNumber();
    let mv; try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    if (turn === 'w') parts.push(`${num}. ${mv.san}`); else parts.push(parts.length ? mv.san : `${num}… ${mv.san}`);
  }
  return parts.join(' ');
}

/**
 * Explain one move. Returns {tags:[], text:[]} — tags feed the growth stats.
 */
function explain(ctx) {
  const { fenBefore, fenAfter, mover, played, bestLine, replyLine, bestCp, playedCp, cls, phase, prevCls, ply, secondCp } = ctx;
  const tags = [], text = [];
  const opp = mover === 'w' ? 'b' : 'w';
  const bestSan = bestLine.pv.length ? lineSan(fenBefore, bestLine.pv, 1).replace(/^\d+\.(…)?\s*/, '') : null;

  // Mates
  if (bestLine.mate != null && bestLine.mate > 0 && !(playedCp > 9000)) {
    tags.push('missed-mate');
    text.push(`You had a forced mate in ${bestLine.mate}: ${lineSan(fenBefore, bestLine.pv, bestLine.mate * 2 - 1)}.`);
  }
  if (replyLine && replyLine.mate != null && replyLine.mate > 0 && !(bestCp < -9000)) {
    tags.push('allowed-mate');
    text.push(`This allows mate in ${replyLine.mate}: ${lineSan(fenAfter, replyLine.pv, replyLine.mate * 2 - 1)}.`);
  }

  // Material: what does the opponent win after your move? (measured at the last quiet point of their line)
  if (replyLine && replyLine.pv.length && !tags.includes('allowed-mate')) {
    const r = playLine(fenAfter, replyLine.pv, 10, mover);
    const before = material(new Chess(fenBefore), mover);
    const loss = before - r.mats[settled(r)];
    if (loss >= 2) {
      const playedMove = new Chess(fenBefore).move(played);
      const firstCap = r.caps.find(c => c && c.by === opp);
      const lost = r.caps.slice(0, settled(r)).filter(c => c && c.by === opp).map(c => `${PNAME[c.piece]} ${c.sq}`);
      const ours = r.caps.slice(0, settled(r)).filter(c => c && c.by === mover).map(c => `${PNAME[c.piece]} ${c.sq}`);
      const movedPieceHung = firstCap && firstCap.sq === playedMove.to && r.caps[0] && r.caps[0].by === opp && !ours.length;
      tags.push(movedPieceHung ? 'hung-piece' : 'allowed-tactic');
      const line = lineSan(fenAfter, replyLine.pv, Math.max(2, settled(r)));
      text.push(movedPieceHung
        ? `${playedMove.san} leaves the ${PNAME[playedMove.piece]} on ${playedMove.to} en prise: ${line} — you end up ${loss} down.`
        : `This allows a tactic: ${line}. They take ${lost.join(', ') || 'nothing yet'}${ours.length ? `; you take ${ours.join(', ')}` : ''} — net, you end up ${loss} down.`);
    }
  }

  // Material: what did the best move win that you passed up?
  if (bestLine.pv.length && !tags.includes('missed-mate')) {
    const r = playLine(fenBefore, bestLine.pv, 10, mover);
    const gain = r.mats[settled(r)] - r.mats[0];
    const pr = playLine(fenAfter, (replyLine && replyLine.pv) || [], 10, mover);
    const playedGain = pr.mats[settled(pr)] - r.mats[0];
    if (gain >= 2 && gain - playedGain >= 2) {
      tags.push('missed-tactic');
      text.push(`You missed ${bestSan}, which wins material (+${gain}): ${lineSan(fenBefore, bestLine.pv, Math.max(3, settled(r)))}.`);
    }
  }

  // Missed punishment of the opponent's error
  if ((prevCls === 'mistake' || prevCls === 'blunder') && (cls === 'mistake' || cls === 'blunder' || cls === 'inaccuracy')) {
    tags.push('missed-punish');
    text.push(`Your opponent had just erred. ${bestSan} would have punished it.`);
  }

  // Lightweight positional heuristics (only when nothing tactical explains it)
  if (!tags.length) {
    const c = new Chess(fenBefore);
    const mv = c.move(played);
    if (mv.piece === 'k' && !mv.san.startsWith('O-O') && phase !== 'endgame') { tags.push('king-safety'); text.push('King walk before the endgame: this gives up castling and exposes the king.'); }
    else if (mv.piece === 'q' && ply < 16) { tags.push('early-queen'); text.push('Early queen move: it can be chased while your minor pieces are still undeveloped.'); }
    else if (ply < 20 && !mv.captured && mv.piece !== 'p' && mv.piece !== 'k' && ctx.movedBefore) { tags.push('development'); text.push('Moving the same piece twice in the opening loses time; develop a new piece instead.'); }
    else if (phase === 'endgame') { tags.push('endgame-technique'); text.push('Endgame technique: in endings, king activity and passed pawns decide. Compare with the engine line.'); }
    else { tags.push('positional'); text.push('No direct tactic: the engine judges the resulting position worse (piece activity, structure or king safety).'); }
  }

  if (bestSan && bestLine.pv[0] !== ctx.uci) text.push(`Best was ${bestSan} (${lineSan(fenBefore, bestLine.pv, 6)}).`);
  if (cls === 'great' && secondCp != null) text.push('Only move: every alternative was much worse.');
  return { tags, text };
}

/**
 * Analyse a whole game.
 * engine: a Stockfish instance (engines.js). moves: list of UCI. startFen optional.
 * onProgress(i, n).
 */
export async function analyseGame({ engine, moves, startFen, depth = 14, userColor = null, onProgress }) {
  const chess = new Chess(startFen || undefined);
  const fens = [chess.fen()], sans = [], lans = [];
  for (const u of moves) {
    const mv = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    fens.push(chess.fen()); sans.push(mv.san); lans.push(mv.lan);
  }
  await engine.newGame();
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    if (c.isCheckmate()) evals.push({ terminal: 'mate', lines: [{ mate: 0, cp: null, pv: [] }] });
    else if (c.isDraw() || c.isStalemate()) evals.push({ terminal: 'draw', lines: [{ cp: 0, mate: null, pv: [] }] });
    else {
      const r = await engine.go({ fen: fens[i], depth, multipv: 2 });
      evals.push({ lines: r.lines, best: r.bestmove });
    }
    onProgress && onProgress(i + 1, fens.length);
  }

  const out = [];
  const movedSquares = { w: new Set(), b: new Set() };
  let prevCls = null;
  for (let i = 0; i < moves.length; i++) {
    const before = new Chess(fens[i]);
    const mover = before.turn();
    const legalCount = before.moves().length;
    const e0 = evals[i], e1 = evals[i + 1];
    const bestLine = e0.lines[0] || { pv: [], cp: 0, mate: null };
    const bestCp = lineCp(bestLine);
    let playedCp;
    if (e1.terminal === 'mate') playedCp = 10000; else if (e1.terminal === 'draw') playedCp = 0; else playedCp = -lineCp(e1.lines[0]);
    const isBest = bestLine.pv[0] === moves[i];
    if (isBest) playedCp = Math.max(playedCp, bestCp); // same move, remove search noise
    const wpB = winPct(bestCp), wpA = winPct(playedCp);
    const drop = Math.max(0, wpB - wpA);
    const second = e0.lines[1] ? lineCp(e0.lines[1]) : null;
    const phase = phaseOf(before, i);
    let cls;
    if (legalCount === 1) cls = 'forced';
    else if (isBest && second != null && wpB - winPct(second) >= 20 && wpB < 97 && !before.inCheck() && !isCapture(before, moves[i])) cls = 'great';
    else if (isBest) cls = 'best';
    else if (drop < 2) cls = 'excellent';
    else if (drop < 5) cls = 'good';
    else if (drop < 10) cls = 'inaccuracy';
    else if (drop < 15) cls = 'mistake';
    else cls = 'blunder';
    // already totally winning/lost: don't call conversions "blunders" unless the result flips
    if ((cls === 'mistake' || cls === 'blunder') && ((wpB > 97 && wpA > 90) || (wpB < 3))) cls = 'inaccuracy';

    const rec = {
      ply: i, mover, san: sans[i], uci: moves[i], fenBefore: fens[i], fenAfter: fens[i + 1], phase,
      bestUci: bestLine.pv[0] || null,
      bestSan: bestLine.pv.length ? lineSan(fens[i], bestLine.pv, 1).replace(/^\d+\.(…)?\s*/, '') : null,
      bestLine: bestLine.pv.length ? lineSan(fens[i], bestLine.pv, 8) : '',
      evalWhite: mover === 'w' ? playedCp : -playedCp,
      mateWhite: null,
      cpLoss: Math.max(0, Math.min(1000, bestCp) - Math.min(1000, Math.max(-1000, playedCp))),
      wpBefore: +wpB.toFixed(1), wpAfter: +wpA.toFixed(1), drop: +drop.toFixed(1),
      accuracy: +moveAccuracy(drop).toFixed(1), cls, tags: [], text: [],
    };
    // mate display from white's view after the move
    if (e1.terminal === 'mate') { rec.mateWhite = null; rec.evalWhite = mover === 'w' ? 10000 : -10000; }
    else if (e1.lines[0] && e1.lines[0].mate != null) { const m = e1.lines[0].mate; const sideAfter = mover === 'w' ? 'b' : 'w'; rec.mateWhite = sideAfter === 'w' ? m : -m; }
    else rec.mateWhite = null;

    if (['inaccuracy', 'mistake', 'blunder'].includes(cls)) {
      const from = moves[i].slice(0, 2);
      const ex = explain({ fenBefore: fens[i], fenAfter: fens[i + 1], mover, played: { from, to: moves[i].slice(2, 4), promotion: moves[i][4] },
        bestLine, replyLine: e1.lines && e1.lines[0], bestCp, playedCp, cls, phase, prevCls, ply: i, secondCp: second,
        movedBefore: movedSquares[mover].has(from), uci: moves[i] });
      // Walking into a forced mate when the best move avoids it is always a blunder.
      if (ex.tags.includes('allowed-mate') && !(bestLine.mate != null && bestLine.mate < 0)) rec.cls = 'blunder';
      rec.tags = ex.tags; rec.text = ex.text;
    } else if (cls === 'great') rec.text = ['Only move: every alternative was much worse. Well found.'];
    movedSquares[mover].add(moves[i].slice(2, 4));
    prevCls = cls;
    out.push(rec);
  }
  return { moves: out, summary: summarise(out, userColor), depth, engine: 'Stockfish 19 lite (WASM)', fens };
}

export function summarise(recs, userColor) {
  const side = (c) => {
    const r = recs.filter(x => x.mover === c && x.cls !== 'forced');
    const counts = {}; for (const k of Object.keys(CLASS_INFO)) counts[k] = 0;
    r.forEach(x => counts[x.cls]++);
    const accs = r.map(x => x.accuracy);
    const mean = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : 0;
    const harm = accs.length ? accs.length / accs.reduce((a, b) => a + 1 / Math.max(b, 1), 0) : 0;
    const phases = {};
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const p = r.filter(x => x.phase === ph);
      phases[ph] = p.length ? +(p.reduce((a, b) => a + b.accuracy, 0) / p.length).toFixed(1) : null;
    }
    const tags = {}; r.forEach(x => x.tags.forEach(t => tags[t] = (tags[t] || 0) + 1));
    return {
      accuracy: +((mean + harm) / 2).toFixed(1),
      acpl: r.length ? Math.round(r.reduce((a, b) => a + b.cpLoss, 0) / r.length) : 0,
      counts, phases, tags, moves: r.length,
    };
  };
  const res = { w: side('w'), b: side('b') };
  if (userColor) {
    const mine = recs.filter(x => x.mover === userColor && ['inaccuracy', 'mistake', 'blunder'].includes(x.cls));
    res.critical = mine.sort((a, b) => b.drop - a.drop).slice(0, 3).map(x => x.ply);
  }
  return res;
}
