/*
 * Trading Radar – kleiner Server ohne Abhängigkeiten.
 *   node server.js          -> http://localhost:8787
 *
 * Liefert die Seite aus public/ und holt Kursdaten über /api/candles,
 * weil Yahoo Finance direkte Abfragen aus dem Browser nicht erlaubt.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { INSTRUMENTS, loadCandles } = require('./lib/sources');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const CACHE_MS = 60000;
const cache = new Map();

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/instruments') return send(res, 200, JSON.stringify(INSTRUMENTS));

  if (url.pathname === '/api/candles') {
    const market = url.searchParams.get('market') || '';
    const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
    const known = (INSTRUMENTS[market] || []).some((x) => x.symbol === symbol);
    if (!known) return send(res, 400, JSON.stringify({ error: 'Unbekanntes Instrument' }));
    const key = market + ':' + symbol, hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.body);
    try {
      const body = JSON.stringify(await loadCandles(market, symbol));
      cache.set(key, { at: Date.now(), body });
      return send(res, 200, body);
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: String(e.message || e) }));
    }
  }

  // statische Dateien
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Nicht gefunden', 'text/plain');
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log('Trading Radar läuft auf http://localhost:' + PORT));
