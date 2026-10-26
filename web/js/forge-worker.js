// Forge engine worker wrapper. GPL-3.0-or-later.
import { think } from './forge-engine.js';

self.onmessage = (ev) => {
  const { id } = ev.data;
  try { self.postMessage({ id, ...think(ev.data) }); }
  catch (e) { self.postMessage({ id, error: String(e && e.stack || e) }); }
};
