#!/usr/bin/env python3
"""Forge Chess server — static web UI + game/stats API on SQLite.

Stdlib only. Binds 127.0.0.1 by default; expose over the tailnet with
`tailscale serve --bg --tcp <port> tcp://localhost:<port>`.
GPL-3.0-or-later.
"""
import argparse
import json
import mimetypes
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MAX_BODY = 4 * 1024 * 1024
START_RATING = 800

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("image/svg+xml", ".svg")

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'forge',
  rated INTEGER NOT NULL DEFAULT 0,
  user_color TEXT,
  opponent TEXT,
  engine_class INTEGER,
  engine_level INTEGER,
  engine_elo INTEGER,
  result TEXT,
  termination TEXT,
  time_control TEXT,
  plies INTEGER,
  user_accuracy REAL,
  user_acpl INTEGER,
  blunders INTEGER, mistakes INTEGER, inaccuracies INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_created ON games(created);
"""

LOCK = threading.Lock()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.conn() as c:
            c.executescript(SCHEMA)

    def conn(self):
        c = sqlite3.connect(self.path, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        return c

    def save(self, g):
        gid = g.get("id") or uuid.uuid4().hex[:12]
        if not re.fullmatch(r"[a-f0-9]{6,32}", gid):
            raise ValueError("bad id")
        g["id"] = gid
        ts = now_iso()
        g.setdefault("created", ts)
        s = ((g.get("analysis") or {}).get("summary") or {})
        uc = g.get("userColor")
        mine = s.get(uc) if uc in ("w", "b") else None
        counts = (mine or {}).get("counts") or {}
        row = dict(
            id=gid, created=g["created"], updated=ts, source=g.get("source", "forge"),
            rated=1 if g.get("rated") else 0, user_color=uc, opponent=str(g.get("opponent", ""))[:80],
            engine_class=g.get("engineClass"), engine_level=g.get("engineLevel"), engine_elo=g.get("engineElo"),
            result=g.get("result"), termination=str(g.get("termination", ""))[:40], time_control=g.get("timeControl"),
            plies=len(g.get("moves") or []), user_accuracy=(mine or {}).get("accuracy"), user_acpl=(mine or {}).get("acpl"),
            blunders=counts.get("blunder"), mistakes=counts.get("mistake"), inaccuracies=counts.get("inaccuracy"),
            archived=1 if g.get("archived") else 0, data=json.dumps(g, separators=(",", ":")),
        )
        cols = ",".join(row)
        qs = ",".join("?" for _ in row)
        upd = ",".join(f"{k}=excluded.{k}" for k in row if k not in ("id", "created"))
        with LOCK, self.conn() as c:
            c.execute(f"INSERT INTO games ({cols}) VALUES ({qs}) ON CONFLICT(id) DO UPDATE SET {upd}", list(row.values()))
        return gid

    def get(self, gid):
        with self.conn() as c:
            r = c.execute("SELECT data FROM games WHERE id=?", (gid,)).fetchone()
        return json.loads(r["data"]) if r else None

    def list(self, include_archived=False):
        q = "SELECT id,created,source,rated,user_color,opponent,engine_class,engine_level,engine_elo,result,termination,time_control,plies,user_accuracy,user_acpl,blunders,mistakes,inaccuracies,archived FROM games"
        if not include_archived:
            q += " WHERE archived=0"
        q += " ORDER BY created DESC"
        with self.conn() as c:
            return [dict(r) for r in c.execute(q)]

    def all_full(self):
        with self.conn() as c:
            return [json.loads(r["data"]) for r in c.execute("SELECT data FROM games WHERE archived=0 ORDER BY created ASC")]


def score_for_user(result, color):
    if result == "1/2-1/2":
        return 0.5
    if result == "1-0":
        return 1.0 if color == "w" else 0.0
    if result == "0-1":
        return 1.0 if color == "b" else 0.0
    return None


def compute_stats(games):
    """Growth stats: rating vs the engine ladder, accuracy trend, error tags, per-class record."""
    rating = START_RATING
    history, acc_series, per_class = [], [], {}
    tag_counts_recent, phase_acc = {}, {"opening": [], "middlegame": [], "endgame": []}
    totals = {"games": 0, "wins": 0, "draws": 0, "losses": 0, "rated": 0, "analysed": 0}
    rated_n = 0
    for g in games:
        uc = g.get("userColor")
        sc = score_for_user(g.get("result"), uc)
        if sc is None:
            continue
        totals["games"] += 1
        totals["wins" if sc == 1 else "draws" if sc == 0.5 else "losses"] += 1
        cls = g.get("engineClass")
        if cls:
            k = f"{cls}-{g.get('engineLevel', 1)}"
            pc = per_class.setdefault(k, {"class": cls, "level": g.get("engineLevel", 1), "w": 0, "d": 0, "l": 0, "elo": g.get("engineElo")})
            pc["w" if sc == 1 else "d" if sc == 0.5 else "l"] += 1
        if g.get("rated") and g.get("engineElo") and g.get("source", "forge") == "forge":
            rated_n += 1
            totals["rated"] += 1
            exp = 1 / (1 + 10 ** ((g["engineElo"] - rating) / 400))
            k_factor = 40 if rated_n <= 20 else 24
            rating = rating + k_factor * (sc - exp)
            history.append({"t": g.get("created"), "rating": round(rating), "id": g["id"]})
        s = ((g.get("analysis") or {}).get("summary") or {}).get(uc)
        if s:
            totals["analysed"] += 1
            acc_series.append({"t": g.get("created"), "acc": s.get("accuracy"), "acpl": s.get("acpl"),
                               "blunders": (s.get("counts") or {}).get("blunder", 0), "id": g["id"]})
            for ph, v in (s.get("phases") or {}).items():
                if v is not None and ph in phase_acc:
                    phase_acc[ph].append(v)
    recent = [g for g in games if ((g.get("analysis") or {}).get("summary") or {}).get(g.get("userColor"))][-30:]
    for g in recent:
        for t, n in (g["analysis"]["summary"][g["userColor"]].get("tags") or {}).items():
            tag_counts_recent[t] = tag_counts_recent.get(t, 0) + n
    last = acc_series[-20:]
    phase_avg = {ph: (round(sum(v[-20:]) / len(v[-20:]), 1) if v else None) for ph, v in phase_acc.items()}
    return {
        "rating": round(rating), "ratingHistory": history, "accuracy": acc_series, "totals": totals,
        "perClass": sorted(per_class.values(), key=lambda x: (x["class"], x["level"])),
        "tagsRecent": dict(sorted(tag_counts_recent.items(), key=lambda kv: -kv[1])),
        "phaseAccuracy": phase_avg,
        "avgAccuracy20": round(sum(x["acc"] for x in last) / len(last), 1) if last else None,
        "avgBlunders20": round(sum(x["blunders"] for x in last) / len(last), 2) if last else None,
        "generated": now_iso(),
    }


# ---------------- Obsidian report (optional) ----------------
TAG_TEXT = {
    "hung-piece": "Hung a piece (moved it to an unprotected square)",
    "allowed-tactic": "Allowed a tactic against another piece",
    "missed-tactic": "Missed a winning tactic",
    "missed-mate": "Missed a forced mate",
    "allowed-mate": "Allowed a forced mate",
    "missed-punish": "Did not punish the opponent's mistake",
    "king-safety": "King safety",
    "early-queen": "Early queen moves",
    "development": "Slow development (same piece twice)",
    "endgame-technique": "Endgame technique",
    "positional": "Positional (no direct tactic)",
}


def local_date(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone().date().isoformat()
    except ValueError:
        return str(iso or "")[:10]


def write_brain_report(store, path, base_url):
    games = store.all_full()
    st = compute_stats(games)
    lines = [
        "---", "up: \"[[Chess]]\"", "tags: [chess, auto-generated]", f"updated: {datetime.now().astimezone().date().isoformat()}", "---", "",
        "# Chess - Stats", "",
        f"> Auto-generated by Forge Chess after every saved game ({base_url}). Do not edit by hand; it is overwritten.", "",
        "## Now", "",
        f"- Ladder rating (Elo vs the Forge engine ladder, rated games only): **{st['rating']}** after {st['totals']['rated']} rated games",
        f"- Record: {st['totals']['wins']}W / {st['totals']['draws']}D / {st['totals']['losses']}L over {st['totals']['games']} games ({st['totals']['analysed']} reviewed)",
        f"- Average accuracy, last 20 reviewed: {str(st['avgAccuracy20']) + '%' if st['avgAccuracy20'] is not None else 'n/a'}",
        f"- Blunders per game, last 20 reviewed: {st['avgBlunders20'] if st['avgBlunders20'] is not None else 'n/a'}",
        "", "## Accuracy by phase (last 20 reviewed)", "",
    ]
    for ph, v in st["phaseAccuracy"].items():
        lines.append(f"- {ph.capitalize()}: {v if v is not None else 'n/a'}%")
    lines += ["", "## Recurring mistakes (last 30 reviewed games)", ""]
    if st["tagsRecent"]:
        for t, n in list(st["tagsRecent"].items())[:8]:
            lines.append(f"- {TAG_TEXT.get(t, t)}: {n}")
    else:
        lines.append("- None recorded yet.")
    lines += ["", "## Record by engine class", ""]
    names = {1: "Apprentice", 2: "Journeyman", 3: "Smith", 4: "Master", 5: "Hephaestus"}
    for pc in st["perClass"]:
        lines.append(f"- {names.get(pc['class'], pc['class'])} {['I','II','III'][pc['level']-1]} (~{pc['elo']}): {pc['w']}W {pc['d']}D {pc['l']}L")
    if not st["perClass"]:
        lines.append("- No games yet.")
    lines += ["", "## Last 10 games", ""]
    for g in list(reversed(games))[:10]:
        s = ((g.get("analysis") or {}).get("summary") or {}).get(g.get("userColor")) or {}
        acc = f"{s.get('accuracy')}%" if s else "not reviewed"
        lines.append(f"- {local_date(g.get('created'))} vs {g.get('opponent','?')} as {'White' if g.get('userColor')=='w' else 'Black'}: {g.get('result')} ({g.get('termination','')}), accuracy {acc}")
    lines += ["", "Up: [[Chess]]", ""]
    text = "\n".join(lines)
    p = Path(path)
    if p.exists() and p.read_text(encoding="utf-8") == text:
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".md.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, p)


# ---------------- HTTP ----------------
def make_handler(store, args):
    report_timer = {"t": None}

    def schedule_report():
        if not args.brain_report:
            return
        if report_timer["t"]:
            report_timer["t"].cancel()
        t = threading.Timer(5.0, lambda: _safe(write_brain_report, store, args.brain_report, args.public_url))
        t.daemon = True
        report_timer["t"] = t
        t.start()

    class H(BaseHTTPRequestHandler):
        server_version = "ForgeChess/1.0"

        def log_message(self, fmt, *a):
            if args.verbose:
                super().log_message(fmt, *a)

        def _send(self, code, body=b"", ctype="application/json", extra=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json_body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("body too large")
            return json.loads(self.rfile.read(n) or b"{}")

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = urlparse(self.path).path
            try:
                if path == "/api/health":
                    return self._send(200, {"ok": True, "games": len(store.list(True))})
                if path == "/api/games":
                    return self._send(200, store.list())
                m = re.fullmatch(r"/api/games/([a-f0-9]{6,32})", path)
                if m:
                    g = store.get(m.group(1))
                    return self._send(200, g) if g else self._send(404, {"error": "not found"})
                if path == "/api/stats":
                    return self._send(200, compute_stats(store.all_full()))
                if path == "/api/export":
                    return self._send(200, store.all_full(), extra={"Content-Disposition": "attachment; filename=forge-chess-games.json"})
                return self._static(path)
            except Exception as e:  # noqa: BLE001
                return self._send(500, {"error": str(e)})

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                if path == "/api/games":
                    g = self._json_body()
                    if not isinstance(g, dict) or not isinstance(g.get("moves"), list):
                        return self._send(400, {"error": "game needs moves[]"})
                    gid = store.save(g)
                    schedule_report()
                    return self._send(200, {"id": gid})
                m = re.fullmatch(r"/api/games/([a-f0-9]{6,32})/archive", path)
                if m:
                    g = store.get(m.group(1))
                    if not g:
                        return self._send(404, {"error": "not found"})
                    g["archived"] = True
                    store.save(g)
                    schedule_report()
                    return self._send(200, {"ok": True})
                return self._send(404, {"error": "no route"})
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                return self._send(500, {"error": str(e)})

        def _static(self, path):
            if path in ("", "/"):
                path = "/index.html"
            target = (WEB / path.lstrip("/")).resolve()
            if WEB.resolve() not in target.parents and target != WEB.resolve():
                return self._send(403, {"error": "forbidden"})
            if not target.is_file():
                target = WEB / "index.html"  # SPA fallback
            ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            cache = "public, max-age=604800, immutable" if "/vendor/" in str(target) else "no-cache"
            return self._send(200, target.read_bytes(), ctype, {"Cache-Control": cache})

    return H


def _safe(fn, *a):
    try:
        fn(*a)
    except Exception as e:  # noqa: BLE001
        print("report failed:", e, flush=True)


def main():
    ap = argparse.ArgumentParser(description="Forge Chess server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8110)
    ap.add_argument("--db", default=str(ROOT / "data" / "forge.db"))
    ap.add_argument("--brain-report", default=os.environ.get("FORGE_BRAIN_REPORT", ""),
                    help="path of an Obsidian note to regenerate after each saved game")
    ap.add_argument("--public-url", default=os.environ.get("FORGE_PUBLIC_URL", "http://localhost:8110"))
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    store = Store(args.db)
    if args.brain_report:
        _safe(write_brain_report, store, args.brain_report, args.public_url)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(store, args))
    print(f"Forge Chess on http://{args.host}:{args.port}  db={args.db}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
