/*
 * Baut aus public/ eine einzelne HTML-Datei (dist/trading-radar.html) für die
 * Vorschau als Claude-Artifact. Die Daten-Schnappschüsse aus public/data/
 * werden daneben veröffentlicht und von der Seite per fetch geladen.
 *   node scripts/build-artifact.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const html = read('index.html');
const cut = (tag) => html.split('<!--' + tag + '-->')[1].split('<!--/' + tag + '-->')[0].trim();
const out = [
  cut('HEAD'),
  '<style>\n' + read('style.css') + '</style>',
  cut('BODY'),
  '<script>\n' + read('engine.js') + '</script>',
  '<script>\n' + read('app.js') + '</script>',
  '<script>\n' + read('views.js') + '</script>',
].join('\n');
const dist = path.join(__dirname, '..', 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'trading-radar.html'), out);
console.log('dist/trading-radar.html', (out.length / 1024).toFixed(1) + ' KB');
