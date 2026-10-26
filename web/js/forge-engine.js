// Forge — our own chess engine (no dependencies).
// 0x88 board, pseudo-legal move generation + legality by king-attack test,
// Zobrist hashing, negamax alpha-beta with iterative deepening, transposition
// table, MVV-LVA + killer + history ordering, null-move pruning, late-move
// reductions, check extension, quiescence search, tapered piece-square eval.
// Strength is shaped per class with depth, time, eval noise and blunder rate.
// GPL-3.0-or-later. Part of Forge Chess.

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const WHITE = 0, BLACK = 1;
const MATE = 100000;
const VAL = [0, 100, 320, 335, 500, 950, 0];
const PHASE_W = [0, 0, 1, 1, 2, 4, 0];
const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8, F_PROMO = 16;

const N_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const K_DIRS = [1, -1, 16, -16, 17, 15, -17, -15];
const B_DIRS = [17, 15, -17, -15];
const R_DIRS = [1, -1, 16, -16];

// --- Piece-square tables (white's view; row 0 = rank 8) ----------------------
const T = {
  pMg: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
        0,0,0,22,22,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  pEg: [0,0,0,0,0,0,0,0, 90,90,90,90,90,90,90,90, 55,55,55,55,55,55,55,55, 30,30,30,30,30,30,30,30,
        15,15,15,15,15,15,15,15, 5,5,5,5,5,5,5,5, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
      -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
      -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  kMg: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
        20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  kEg: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
        -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
        -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};
const MG = [null, T.pMg, T.n, T.b, T.r, T.q, T.kMg];
const EG = [null, T.pEg, T.n, T.b, T.r, T.q, T.kEg];

// --- Zobrist -----------------------------------------------------------------
let seed = 0x9e3779b9;
function rnd32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const ZP = [];
for (let p = 0; p < 16; p++) { ZP.push([]); for (let s = 0; s < 128; s++) ZP[p].push([rnd32(), rnd32() & 0x1fffff]); }
const ZSIDE = [rnd32(), rnd32() & 0x1fffff];
const ZCAS = []; for (let i = 0; i < 16; i++) ZCAS.push([rnd32(), rnd32() & 0x1fffff]);
const ZEP = []; for (let i = 0; i < 8; i++) ZEP.push([rnd32(), rnd32() & 0x1fffff]);

const sqName = s => 'abcdefgh'[s & 7] + (1 + (s >> 4));
const nameSq = n => (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97);
const PCH = ' pnbrqk';

const CMASK = new Int8Array(128).fill(15);
CMASK[0x04] = 15 & ~3; CMASK[0x00] = 15 & ~2; CMASK[0x07] = 15 & ~1;
CMASK[0x74] = 15 & ~12; CMASK[0x70] = 15 & ~8; CMASK[0x77] = 15 & ~4;

export class Position {
  constructor(fen) {
    this.b = new Int8Array(128);
    this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }
  load(fen) {
    const [pos, side, cas, ep, hm] = fen.trim().split(/\s+/);
    this.b.fill(0);
    let r = 7, f = 0;
    for (const ch of pos) {
      if (ch === '/') { r--; f = 0; continue; }
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      const t = PCH.indexOf(ch.toLowerCase());
      const col = ch === ch.toLowerCase() ? BLACK : WHITE;
      const s = r * 16 + f;
      this.b[s] = t | (col << 3);
      if (t === K) { if (col === WHITE) this.wk = s; else this.bk = s; }
      f++;
    }
    this.side = side === 'b' ? BLACK : WHITE;
    this.cas = 0;
    if (cas && cas !== '-') { if (cas.includes('K')) this.cas |= 1; if (cas.includes('Q')) this.cas |= 2; if (cas.includes('k')) this.cas |= 4; if (cas.includes('q')) this.cas |= 8; }
    this.ep = ep && ep !== '-' ? nameSq(ep) : -1;
    this.hm = +(hm || 0);
    this.stack = [];
    this.history = [];
    this.computeHash();
  }
  computeHash() {
    let lo = 0, hi = 0;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (p) { lo ^= ZP[p][s][0]; hi ^= ZP[p][s][1]; } }
    if (this.side) { lo ^= ZSIDE[0]; hi ^= ZSIDE[1]; }
    lo ^= ZCAS[this.cas][0]; hi ^= ZCAS[this.cas][1];
    if (this.ep >= 0) { lo ^= ZEP[this.ep & 7][0]; hi ^= ZEP[this.ep & 7][1]; }
    this.lo = lo >>> 0; this.hi = hi;
  }
  key() { return this.hi * 4294967296 + this.lo; }

  attacked(s, by) {
    const b = this.b;
    if (by === WHITE) {
      if (!((s - 15) & 0x88) && b[s - 15] === P) return true;
      if (!((s - 17) & 0x88) && b[s - 17] === P) return true;
    } else {
      if (!((s + 15) & 0x88) && b[s + 15] === (P | 8)) return true;
      if (!((s + 17) & 0x88) && b[s + 17] === (P | 8)) return true;
    }
    const c = by << 3;
    for (const d of N_DIRS) { const t = s + d; if (!(t & 0x88) && b[t] === (N | c)) return true; }
    for (const d of K_DIRS) { const t = s + d; if (!(t & 0x88) && b[t] === (K | c)) return true; }
    for (const d of B_DIRS) {
      let t = s + d;
      while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === (B | c) || p === (Q | c)) return true; break; } t += d; }
    }
    for (const d of R_DIRS) {
      let t = s + d;
      while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === (R | c) || p === (Q | c)) return true; break; } t += d; }
    }
    return false;
  }
  inCheck(side = this.side) { return this.attacked(side === WHITE ? this.wk : this.bk, side ^ 1); }

  // Pseudo-legal moves. Encoding: from | to<<7 | promo<<14 | flags<<17
  gen(capsOnly = false) {
    const b = this.b, us = this.side, them = us ^ 1, out = [];
    const push = (f, t, fl, pr = 0) => out.push(f | (t << 7) | (pr << 14) | (fl << 17));
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s];
      if (!p || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === P) {
        const dir = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
        const one = s + dir;
        if (!(one & 0x88) && !b[one]) {
          if ((one >> 4) === lastRank) { push(s, one, F_PROMO, Q); push(s, one, F_PROMO, R); push(s, one, F_PROMO, B); push(s, one, F_PROMO, N); }
          else if (!capsOnly) {
            push(s, one, 0);
            const two = one + dir;
            if ((s >> 4) === startRank && !b[two]) push(s, two, F_DOUBLE);
          }
        }
        for (let i = 0; i < 2; i++) {
          const c = s + dir + (i ? 1 : -1);
          if (c & 0x88) continue;
          if (b[c] && (b[c] >> 3) === them) {
            if ((c >> 4) === lastRank) { push(s, c, F_CAP | F_PROMO, Q); push(s, c, F_CAP | F_PROMO, R); push(s, c, F_CAP | F_PROMO, B); push(s, c, F_CAP | F_PROMO, N); }
            else push(s, c, F_CAP);
          } else if (c === this.ep) push(s, c, F_CAP | F_EP);
        }
      } else if (t === N || t === K) {
        const dirs = t === N ? N_DIRS : K_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = s + dirs[i];
          if (to & 0x88) continue;
          const q = b[to];
          if (!q) { if (!capsOnly) push(s, to, 0); }
          else if ((q >> 3) === them) push(s, to, F_CAP);
        }
        if (t === K && !capsOnly) {
          if (us === WHITE && s === 0x04) {
            if ((this.cas & 1) && !b[5] && !b[6] && b[7] === R && !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) push(4, 6, F_CASTLE);
            if ((this.cas & 2) && !b[3] && !b[2] && !b[1] && b[0] === R && !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) push(4, 2, F_CASTLE);
          } else if (us === BLACK && s === 0x74) {
            if ((this.cas & 4) && !b[0x75] && !b[0x76] && b[0x77] === (R | 8) && !this.attacked(0x74, them) && !this.attacked(0x75, them) && !this.attacked(0x76, them)) push(0x74, 0x76, F_CASTLE);
            if ((this.cas & 8) && !b[0x73] && !b[0x72] && !b[0x71] && b[0x70] === (R | 8) && !this.attacked(0x74, them) && !this.attacked(0x73, them) && !this.attacked(0x72, them)) push(0x74, 0x72, F_CASTLE);
          }
        }
      } else {
        const dirs = t === B ? B_DIRS : t === R ? R_DIRS : K_DIRS;
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          let to = s + d;
          while (!(to & 0x88)) {
            const q = b[to];
            if (!q) { if (!capsOnly) push(s, to, 0); }
            else { if ((q >> 3) === them) push(s, to, F_CAP); break; }
            to += d;
          }
        }
      }
    }
    return out;
  }

  xor(p, s) { this.lo = (this.lo ^ ZP[p][s][0]) >>> 0; this.hi ^= ZP[p][s][1]; }

  // Returns false (and restores) if the move leaves own king in check.
  make(m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    const p = b[from], us = this.side;
    let cap = b[to], capSq = to;
    if (fl & F_EP) { capSq = us === WHITE ? to - 16 : to + 16; cap = b[capSq]; }
    this.stack.push({ m, cap, capSq, cas: this.cas, ep: this.ep, hm: this.hm, lo: this.lo, hi: this.hi, wk: this.wk, bk: this.bk });
    this.history.push(this.key());

    if (this.ep >= 0) { this.lo = (this.lo ^ ZEP[this.ep & 7][0]) >>> 0; this.hi ^= ZEP[this.ep & 7][1]; }
    this.lo = (this.lo ^ ZCAS[this.cas][0]) >>> 0; this.hi ^= ZCAS[this.cas][1];

    if (cap) { this.xor(cap, capSq); b[capSq] = 0; }
    this.xor(p, from); b[from] = 0;
    const np = pr ? (pr | (us << 3)) : p;
    b[to] = np; this.xor(np, to);
    if ((p & 7) === K) { if (us === WHITE) this.wk = to; else this.bk = to; }
    if (fl & F_CASTLE) {
      let rf, rt;
      if (to === 0x06) { rf = 0x07; rt = 0x05; } else if (to === 0x02) { rf = 0x00; rt = 0x03; }
      else if (to === 0x76) { rf = 0x77; rt = 0x75; } else { rf = 0x70; rt = 0x73; }
      const rp = b[rf]; this.xor(rp, rf); b[rf] = 0; b[rt] = rp; this.xor(rp, rt);
    }
    this.cas &= CMASK[from] & CMASK[to];
    this.ep = (fl & F_DOUBLE) ? (from + to) >> 1 : -1;
    this.hm = (cap || (p & 7) === P) ? 0 : this.hm + 1;
    this.lo = (this.lo ^ ZCAS[this.cas][0]) >>> 0; this.hi ^= ZCAS[this.cas][1];
    if (this.ep >= 0) { this.lo = (this.lo ^ ZEP[this.ep & 7][0]) >>> 0; this.hi ^= ZEP[this.ep & 7][1]; }
    this.side ^= 1; this.lo = (this.lo ^ ZSIDE[0]) >>> 0; this.hi ^= ZSIDE[1];

    if (this.inCheck(us)) { this.unmake(); return false; }
    return true;
  }
  unmake() {
    const u = this.stack.pop(); this.history.pop();
    const b = this.b, m = u.m, from = m & 127, to = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    this.side ^= 1;
    const us = this.side;
    b[from] = pr ? (P | (us << 3)) : b[to];
    b[to] = 0;
    if (u.cap) b[u.capSq] = u.cap;
    if (fl & F_CASTLE) {
      let rf, rt;
      if (to === 0x06) { rf = 0x07; rt = 0x05; } else if (to === 0x02) { rf = 0x00; rt = 0x03; }
      else if (to === 0x76) { rf = 0x77; rt = 0x75; } else { rf = 0x70; rt = 0x73; }
      b[rf] = b[rt]; b[rt] = 0;
    }
    this.cas = u.cas; this.ep = u.ep; this.hm = u.hm; this.lo = u.lo; this.hi = u.hi; this.wk = u.wk; this.bk = u.bk;
  }
  makeNull() {
    this.stack.push({ ep: this.ep, lo: this.lo, hi: this.hi, hm: this.hm });
    this.history.push(this.key());
    if (this.ep >= 0) { this.lo = (this.lo ^ ZEP[this.ep & 7][0]) >>> 0; this.hi ^= ZEP[this.ep & 7][1]; }
    this.ep = -1; this.hm++;
    this.side ^= 1; this.lo = (this.lo ^ ZSIDE[0]) >>> 0; this.hi ^= ZSIDE[1];
  }
  unmakeNull() {
    const u = this.stack.pop(); this.history.pop();
    this.side ^= 1; this.ep = u.ep; this.lo = u.lo; this.hi = u.hi; this.hm = u.hm;
  }
  legal() { const out = []; for (const m of this.gen()) if (this.make(m)) { this.unmake(); out.push(m); } return out; }
  isRepetition() {
    const k = this.key(), h = this.history;
    for (let i = h.length - 2, n = 2; i >= 0 && n <= this.hm; i -= 2, n += 2) if (h[i] === k) return true;
    return false;
  }
  insufficient() {
    let minors = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const t = this.b[s] & 7;
      if (t === P || t === R || t === Q) return false;
      if (t === N || t === B) minors++;
    }
    return minors <= 1;
  }
  uci(m) { const pr = (m >> 14) & 7; return sqName(m & 127) + sqName((m >> 7) & 127) + (pr ? PCH[pr] : ''); }
  parseUci(u) { return this.legal().find(m => this.uci(m) === u); }
}

export function evaluate(pos) {
  const b = pos.b;
  let mg = 0, eg = 0, phase = 0, wb = 0, bb = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = b[s];
    if (!p) continue;
    const t = p & 7, white = !(p & 8);
    const r = s >> 4, f = s & 7;
    const idx = white ? (7 - r) * 8 + f : r * 8 + f;
    phase += PHASE_W[t];
    const v = VAL[t];
    const m = v + MG[t][idx], e = v + (t === P ? 10 : 0) + EG[t][idx];
    if (white) { mg += m; eg += e; if (t === B) wb++; } else { mg -= m; eg -= e; if (t === B) bb++; }
  }
  if (wb >= 2) { mg += 30; eg += 50; }
  if (bb >= 2) { mg -= 30; eg -= 50; }
  const ph = phase > 24 ? 24 : phase;
  const score = (mg * ph + eg * (24 - ph)) / 24;
  return (pos.side === WHITE ? score : -score) + 10 | 0; // side-to-move POV + tempo
}

class Abort extends Error {}

class Searcher {
  constructor(pos, opts) {
    this.pos = pos;
    this.deadline = opts.deadline;
    this.maxNodes = opts.maxNodes || Infinity;
    this.qsearch = opts.qsearch !== false;
    this.pruning = opts.pruning !== false;
    this.nodes = 0;
    this.tt = new Map();
    this.killers = [];
    this.hist = new Int32Array(128 * 128);
  }
  tick() {
    if ((++this.nodes & 2047) === 0 && (performance.now() > this.deadline || this.nodes > this.maxNodes)) throw new Abort();
  }
  score(m, ttMove, ply) {
    if (m === ttMove) return 1e7;
    const fl = m >> 17, b = this.pos.b;
    if (fl & F_CAP) { const victim = (fl & F_EP) ? P : (b[(m >> 7) & 127] & 7); return 1e6 + VAL[victim] * 10 - VAL[b[m & 127] & 7] / 10; }
    if (fl & F_PROMO) return 9e5 + VAL[(m >> 14) & 7];
    const k = this.killers[ply];
    if (k && (k[0] === m || k[1] === m)) return 8e5;
    return this.hist[(m & 127) * 128 + ((m >> 7) & 127)];
  }
  order(moves, ttMove, ply) {
    const sc = moves.map(m => this.score(m, ttMove, ply));
    const idx = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
    return idx.map(i => moves[i]);
  }
  quiesce(alpha, beta, qd) {
    this.tick();
    const pos = this.pos;
    const stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qd > 8) return alpha;
    for (const m of this.order(pos.gen(true), 0, 127)) {
      const fl = m >> 17;
      if (!(fl & F_PROMO)) {
        const victim = (fl & F_EP) ? P : (pos.b[(m >> 7) & 127] & 7);
        if (stand + VAL[victim] + 200 < alpha) continue; // delta pruning
      }
      if (!pos.make(m)) continue;
      const s = -this.quiesce(-beta, -alpha, qd + 1);
      pos.unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
  search(depth, alpha, beta, ply, allowNull = true) {
    this.tick();
    const pos = this.pos;
    if (ply > 0 && (pos.hm >= 100 || pos.isRepetition() || pos.insufficient())) return 0;
    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.qsearch ? this.quiesce(alpha, beta, 0) : evaluate(pos);
    const key = pos.key();
    const hit = this.tt.get(key);
    if (hit && hit.depth >= depth && ply > 0) {
      if (hit.flag === 0) return hit.score;
      if (hit.flag === 1 && hit.score >= beta) return hit.score;
      if (hit.flag === -1 && hit.score <= alpha) return hit.score;
    }
    if (this.pruning && allowNull && !inCheck && depth >= 3 && ply > 0 && beta < MATE - 1000 && this.hasPieces()) {
      pos.makeNull();
      const s = -this.search(depth - 3, -beta, -beta + 1, ply + 1, false);
      pos.unmakeNull();
      if (s >= beta) return beta;
    }
    const moves = this.order(pos.gen(), hit ? hit.move : 0, ply);
    const a0 = alpha;
    let best = -Infinity, bestMove = 0, played = 0;
    for (const m of moves) {
      if (!pos.make(m)) continue;
      played++;
      const quiet = !((m >> 17) & (F_CAP | F_PROMO));
      let s;
      if (this.pruning && played > 4 && depth >= 3 && quiet && !inCheck && !pos.inCheck()) {
        s = -this.search(depth - 2, -alpha - 1, -alpha, ply + 1);
        if (s > alpha) s = -this.search(depth - 1, -beta, -alpha, ply + 1);
      } else {
        s = -this.search(depth - 1, -beta, -alpha, ply + 1);
      }
      pos.unmake();
      if (s > best) { best = s; bestMove = m; }
      if (s > alpha) alpha = s;
      if (alpha >= beta) {
        if (quiet) {
          const k = this.killers[ply] || (this.killers[ply] = [0, 0]);
          if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
          this.hist[(m & 127) * 128 + ((m >> 7) & 127)] += depth * depth;
        }
        break;
      }
    }
    if (!played) return inCheck ? -MATE + ply : 0;
    if (this.tt.size > 600000) this.tt.clear();
    this.tt.set(key, { depth, score: best, flag: best <= a0 ? -1 : best >= beta ? 1 : 0, move: bestMove });
    return best;
  }
  hasPieces() {
    const c = this.pos.side << 3;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.pos.b[s]; if (p && (p & 8) === c && (p & 7) > P && (p & 7) < K) return true; }
    return false;
  }
  rootScores(depth, legal) {
    const out = [];
    for (const m of legal) {
      this.pos.make(m);
      const s = -this.search(depth - 1, -MATE - 1, MATE + 1, 1);
      this.pos.unmake();
      out.push({ m, score: s });
    }
    return out;
  }
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * think({startFen, moves: [uci...], cfg: {depth, timeMs, noise, randomProb, qsearch, pruning}})
 * -> {bestmove, score (cp, side to move), depth, nodes, ms}
 */
export function think({ startFen, moves, cfg = {} }) {
  const pos = new Position(startFen);
  for (const u of moves || []) {
    const m = pos.parseUci(u);
    if (!m) throw new Error('illegal move in history: ' + u);
    pos.make(m);
  }
  const legal = pos.legal();
  if (!legal.length) return { bestmove: null };
  const t0 = performance.now();
  if (legal.length === 1) return { bestmove: pos.uci(legal[0]), score: 0, depth: 0, nodes: 0, ms: 0, forced: true };
  const timeMs = cfg.timeMs || 1000;
  const s = new Searcher(pos, { deadline: t0 + timeMs, maxNodes: cfg.maxNodes, qsearch: cfg.qsearch, pruning: cfg.pruning });
  const maxDepth = cfg.depth || 64;

  if (cfg.noise > 0 || cfg.randomProb > 0) {
    let scored = null, depthDone = 0;
    for (let d = 1; d <= maxDepth; d++) {
      try { scored = s.rootScores(d, legal); depthDone = d; } catch (e) { if (!(e instanceof Abort)) throw e; break; }
    }
    if (!scored) scored = legal.map(m => ({ m, score: 0 }));
    let pick;
    if (Math.random() < (cfg.randomProb || 0)) pick = scored[Math.floor(Math.random() * scored.length)];
    else pick = scored.map(x => ({ ...x, noisy: x.score + gauss() * (cfg.noise || 0) })).sort((a, b) => b.noisy - a.noisy)[0];
    return { bestmove: pos.uci(pick.m), score: pick.score, depth: depthDone, nodes: s.nodes, ms: Math.round(performance.now() - t0) };
  }

  let best = 0, bestScore = 0, depthDone = 0;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      let alpha = -MATE - 1, iterBest = 0;
      for (const m of s.order(legal, best, 0)) {
        pos.make(m);
        let sc;
        if (iterBest) {
          sc = -s.search(d - 1, -alpha - 1, -alpha, 1);
          if (sc > alpha) sc = -s.search(d - 1, -MATE - 1, -alpha, 1);
        } else sc = -s.search(d - 1, -MATE - 1, MATE + 1, 1);
        pos.unmake();
        if (sc > alpha) { alpha = sc; iterBest = m; }
      }
      best = iterBest; bestScore = alpha; depthDone = d;
      if (Math.abs(alpha) > MATE - 1000) break;
      if (performance.now() - t0 > timeMs * 0.5) break;
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      break;
    }
  }
  if (!best) best = legal[0];
  return { bestmove: pos.uci(best), score: bestScore, depth: depthDone, nodes: s.nodes, ms: Math.round(performance.now() - t0) };
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pos.gen()) { if (pos.make(m)) { n += perft(pos, depth - 1); pos.unmake(); } }
  return n;
}
