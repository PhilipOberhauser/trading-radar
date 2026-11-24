/*
 * Kursdaten-Quellen. Liefert immer 5-Minuten-Kerzen als kompakte Zeilen
 * [t(ms), open, high, low, close, volume].
 *
 *  - Krypto:  Binance Public Data API (kein Schlüssel nötig)
 *  - Aktien / Futures: Yahoo Finance Chart-API (kein Schlüssel, Kurse verzögert)
 */
'use strict';

const INSTRUMENTS = {
  stocks: [
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'NVDA', name: 'Nvidia' },
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'MSFT', name: 'Microsoft' },
  ],
  futures: [
    { symbol: 'NQ=F', name: 'Nasdaq 100' },
    { symbol: 'ES=F', name: 'S&P 500' },
    { symbol: 'GC=F', name: 'Gold' },
  ],
  crypto: [
    { symbol: 'BTCUSDT', name: 'Bitcoin' },
    { symbol: 'ETHUSDT', name: 'Ethereum' },
    { symbol: 'SOLUSDT', name: 'Solana' },
  ],
};

// Wie viele Tage 5-Minuten-Daten pro Markt geladen werden
const DAYS = { stocks: 30, futures: 10, crypto: 7 };

const SYMBOL_RE = /^[A-Z0-9=.^-]{1,12}$/;

function fileKey(market, symbol) {
  return market + '_' + symbol.replace(/[^A-Z0-9]/g, '');
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' von ' + new URL(url).host);
  return res.json();
}

async function binance(symbol, days) {
  const step = 5 * 60000, per = 1000;
  const end = Date.now();
  let start = end - days * 86400000;
  const rows = [];
  while (start < end) {
    const url = 'https://data-api.binance.vision/api/v3/klines?symbol=' + encodeURIComponent(symbol) +
      '&interval=5m&limit=' + per + '&startTime=' + start;
    const part = await getJson(url);
    if (!part.length) break;
    for (const k of part) rows.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
    start = part[part.length - 1][0] + step;
    if (part.length < per) break;
  }
  return rows;
}

async function yahoo(symbol, days) {
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - days * 86400;
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?interval=5m&period1=' + p1 + '&period2=' + p2 + '&includePrePost=false';
  const j = await getJson(url);
  const r = j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) throw new Error('Keine Daten von Yahoo für ' + symbol);
  const q = r.indicators.quote[0], rows = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    rows.push([r.timestamp[i] * 1000, q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0]);
  }
  return rows;
}

async function loadCandles(market, symbol) {
  if (!INSTRUMENTS[market]) throw new Error('Unbekannter Markt: ' + market);
  if (!SYMBOL_RE.test(symbol)) throw new Error('Ungültiges Symbol');
  const days = DAYS[market];
  const rows = market === 'crypto' ? await binance(symbol, days) : await yahoo(symbol, days);
  const digits = rows.length && rows[rows.length - 1][4] < 10 ? 4 : 2;
  const f = Math.pow(10, digits);
  for (const r of rows) for (let i = 1; i <= 4; i++) r[i] = Math.round(r[i] * f) / f;
  return {
    market, symbol, tf: '5m',
    source: market === 'crypto' ? 'Binance' : 'Yahoo Finance',
    fetchedAt: Date.now(),
    candles: rows,
  };
}

module.exports = { INSTRUMENTS, DAYS, fileKey, loadCandles };
