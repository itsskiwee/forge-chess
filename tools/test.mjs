// Forge engine self-test: perft vs known node counts, hash consistency, basic tactics. GPL-3.0-or-later.
import { Position, perft, think } from '../web/js/forge-engine.js';
const tests = [
 ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
 ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
 ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 5, 674624],
 ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 4, 422333],
 ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];
for (const [fen,d,exp] of tests){ const p=new Position(fen); const t=Date.now(); const n=perft(p,d); console.log(n===exp?'OK ':'BAD', n, exp, (Date.now()-t)+'ms'); }
// hash consistency
const p=new Position(tests[1][0]); let bad=0;
(function walk(d){ if(!d) return; for(const m of p.gen()){ if(p.make(m)){ const lo=p.lo,hi=p.hi; p.computeHash(); if(lo!==p.lo||hi!==p.hi) bad++; p.lo=lo;p.hi=hi; walk(d-1); p.unmake(); } } })(3);
console.log('hash mismatches', bad);
for (const cfg of [{timeMs:1000},{timeMs:3000}]) { const r=think({moves:[],cfg}); console.log('start',cfg.timeMs,r.bestmove,r.score,'d'+r.depth,Math.round(r.nodes/(r.ms/1000))+'nps'); }
const r2=think({startFen:'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',cfg:{timeMs:2000}}); console.log('kiwipete',r2);
const r3=think({moves:['e2e4','d7d5','d1g4'],cfg:{timeMs:1000}}); console.log('free queen',r3.bestmove);
