#!/usr/bin/env node
// Engine-vs-engine matches for calibrating the Forge ladder. GPL-3.0-or-later.
// Usage: node tools/match.mjs <classA>.<levelA> <classB>.<levelB> [games=10] [timeScale=1]
//   e.g. node tools/match.mjs 2.3 3.1 20
// Only Forge classes (1–3) run here; Stockfish classes need the browser.
import { think, Position } from '../web/js/forge-engine.js';
import { CLASSES } from '../web/js/engines.js';

const [a = '1.1', b = '2.1', nGames = '10', scale = '1'] = process.argv.slice(2);
const cfgOf = (s) => {
  const [c, l] = s.split('.').map(Number);
  const cls = CLASSES.find(x => x.id === c);
  if (!cls || cls.engine !== 'forge') throw new Error(`${s}: only Forge classes 1-3 can run in node`);
  const cfg = { ...cls.levels[l - 1].cfg };
  cfg.timeMs = Math.round(cfg.timeMs * +scale);
  return { name: `${cls.name} ${['I', 'II', 'III'][l - 1]}`, cfg };
};
const A = cfgOf(a), B = cfgOf(b);

function playGame(white, black) {
  const pos = new Position();
  const moves = [];
  const seen = new Map();
  for (let ply = 0; ply < 300; ply++) {
    const legal = pos.legal();
    if (!legal.length) return pos.inCheck() ? (pos.side === 0 ? '0-1' : '1-0') : '1/2-1/2';
    if (pos.hm >= 100 || pos.insufficient()) return '1/2-1/2';
    const k = pos.key(); seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) >= 3) return '1/2-1/2';
    const side = pos.side === 0 ? white : black;
    const r = think({ moves, cfg: side.cfg });
    moves.push(r.bestmove);
    pos.make(pos.parseUci(r.bestmove));
  }
  return '1/2-1/2';
}

let score = 0;
for (let i = 0; i < +nGames; i++) {
  const aWhite = i % 2 === 0;
  const res = aWhite ? playGame(A, B) : playGame(B, A);
  const s = res === '1/2-1/2' ? 0.5 : ((res === '1-0') === aWhite ? 1 : 0);
  score += s;
  console.log(`game ${i + 1}: ${aWhite ? A.name : B.name} (W) vs ${aWhite ? B.name : A.name} (B) ${res}`);
}
const p = Math.min(0.99, Math.max(0.01, score / +nGames));
console.log(`\n${A.name} scored ${score}/${nGames} vs ${B.name} → Elo diff ≈ ${Math.round(-400 * Math.log10(1 / p - 1))}`);
