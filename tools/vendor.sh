#!/bin/sh
# Refresh vendored browser libraries from npm (run on a machine with npm). GPL-3.0-or-later.
set -e
cd "$(dirname "$0")/.."
npm install --no-audit --no-fund
mkdir -p web/vendor/chessground web/vendor/stockfish
cp node_modules/chess.js/dist/esm/chess.js web/vendor/chess.js
cp node_modules/chess.js/LICENSE web/vendor/chess.js.LICENSE
cp node_modules/@lichess-org/chessground/dist/chessground.min.js web/vendor/chessground/
cp node_modules/@lichess-org/chessground/assets/*.css node_modules/@lichess-org/chessground/LICENSE web/vendor/chessground/
cp node_modules/stockfish/bin/stockfish-19-lite-single.js node_modules/stockfish/bin/stockfish-19-lite-single.wasm web/vendor/stockfish/
cp node_modules/stockfish/Copying.txt web/vendor/stockfish/COPYING
echo "vendored: chess.js $(node -p "require('./node_modules/chess.js/package.json').version"), chessground $(node -p "require('./node_modules/@lichess-org/chessground/package.json').version"), stockfish $(node -p "require('./node_modules/stockfish/package.json').version")"
