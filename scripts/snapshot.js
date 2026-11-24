/*
 * Speichert für jedes Instrument einen Daten-Schnappschuss nach public/data/.
 * Die Seite nutzt diese Dateien, wenn kein Server für Live-Daten erreichbar ist.
 *   node scripts/snapshot.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { INSTRUMENTS, fileKey, loadCandles } = require('../lib/sources');

(async () => {
  const dir = path.join(__dirname, '..', 'public', 'data');
  fs.mkdirSync(dir, { recursive: true });
  let failed = 0;
  for (const market of Object.keys(INSTRUMENTS)) {
    for (const ins of INSTRUMENTS[market]) {
      try {
        const data = await loadCandles(market, ins.symbol);
        // eine Kerze pro Zeile, damit die Datei lesbar bleibt
        const body = JSON.stringify({ ...data, candles: 0 }).replace('"candles":0',
          '"candles":[\n' + data.candles.map((r) => JSON.stringify(r)).join(',\n') + '\n]');
        fs.writeFileSync(path.join(dir, fileKey(market, ins.symbol) + '.json'), body);
        console.log('ok  ', market, ins.symbol, data.candles.length, 'Kerzen');
      } catch (e) {
        failed++;
        console.log('FEHL', market, ins.symbol, e.message);
      }
    }
  }
  process.exit(failed ? 1 : 0);
})();
