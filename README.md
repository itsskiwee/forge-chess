# Forge Chess

Our own chess platform: play a five-class engine ladder, get every move reviewed, and track growth over time. Free, self-hosted, GPL-3.0.

- **Play** against 15 opponents (5 classes × 3 levels). Rated games move your ladder rating; practice games allow hints, takebacks and a live eval bar. Clocks from 3+2 to 30+0, or untimed.
- **Review** every finished game: Stockfish 19 searches each position (depth 14, or 18 for "deep"), each move gets a win-chance before/after, an accuracy score and a class (Best, Only move, Excellent, Good, Inaccuracy, Mistake, Blunder). Errors come with a plain-language reason: hung piece, tactic allowed, tactic missed, mate allowed/missed, opponent's error left unpunished, or an opening/endgame heuristic. Drag pieces on the review board to explore alternatives with a live 3-line engine.
- **Growth**: ladder rating, accuracy per game, accuracy by phase, recurring mistake types with advice, record per class, and the next rung to beat.
- **Import** PGNs from chess.com, lichess or over-the-board games and review them the same way.
- **Obsidian**: optionally regenerates a `Chess - Stats` note after every saved game.

```
browser (phone / laptop)                          home server (thinkerpad)
┌──────────────────────────────────────┐          ┌───────────────────────────────┐
│ UI (chessground + chess.js)          │  HTTP    │ server/forge_server.py        │
│ Forge engine   (web worker, ours)    │ ───────► │  static files + /api/*        │
│ Stockfish 19   (web worker, WASM)    │ tailnet  │  SQLite data/forge.db         │
│ review + accuracy + explanations     │          │  → ~/Brain/.../Chess - Stats  │
└──────────────────────────────────────┘          └───────────────────────────────┘
```

All engine work runs on the device you play on, so the server only serves files and stores games (a few MB of RAM).

## The ladder

| Class | Engine | Levels (~Elo, rough) | How it is weakened |
|---|---|---|---|
| I Apprentice | Forge | 500 / 700 / 900 | 1–2 ply, no capture search, large eval noise, 8–25% random moves |
| II Journeyman | Forge | 1000 / 1150 / 1300 | 2–3 ply + quiescence, small noise, rare random moves |
| III Smith | Forge | 1450 / 1650 / 1850 | full Forge, capped by depth/time |
| IV Master | Stockfish 19 | 1900 / 2200 / 2500 | `UCI_LimitStrength` + `UCI_Elo` |
| V Hephaestus | Stockfish 19 | 2900 / 3100 / 3300 | unrestricted, 0.7 / 1.5 / 3 s per move |

Elo figures are targets, not measurements. Calibrate with engine-vs-engine matches:

```sh
node tools/match.mjs 2.3 3.1 20      # Journeyman III vs Smith I, 20 games
```

### Forge (`web/js/forge-engine.js`)

Our engine, no dependencies: 0x88 board, pseudo-legal generation with king-attack legality, Zobrist hashing, negamax alpha-beta, iterative deepening, transposition table, MVV-LVA + killer + history move ordering, null-move pruning, late-move reductions, check extensions, quiescence with delta pruning, tapered piece-square evaluation with bishop pair and tempo. About 1.5 M nodes/s in V8. `node tools/test.mjs` runs perft against five reference positions plus a hash-consistency walk.

Ideas for growing it: pawn structure terms (passed / isolated / doubled), king safety, mobility, aspiration windows, a proper opening book, SEE for capture ordering.

## Run it

Requirements: Python 3.9+ (stdlib only). Node is needed only for `tools/` and for refreshing vendored libraries.

```sh
python3 server/forge_server.py --port 8110                     # http://127.0.0.1:8110
python3 server/forge_server.py --port 8110 \
  --brain-report "$HOME/Brain/Projects/Chess/Chess - Stats.md" \
  --public-url http://thinkerpad.taila351d7.ts.net:8110
```

Deployment on the home server (user service, tailnet only): see `deploy/`.

```sh
deploy/install.sh               # on the server: installs + starts forge-chess.service
tailscale serve --bg --tcp 8110 tcp://localhost:8110
```

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | `{ok, games}` |
| GET | `/api/games` | summaries, newest first |
| GET | `/api/games/<id>` | full game incl. analysis |
| POST | `/api/games` | create / update (JSON game, `moves` = UCI list) |
| POST | `/api/games/<id>/archive` | hide from stats (nothing is deleted) |
| GET | `/api/stats` | growth stats |
| GET | `/api/export` | all games as JSON |

## Licences

Forge Chess is GPL-3.0-or-later (`LICENSE`). Vendored: Stockfish.js 19 (GPL-3.0), chessground 10 (GPL-3.0), chess.js 1.4 (BSD-2-Clause). `tools/vendor.sh` refreshes them from npm.
