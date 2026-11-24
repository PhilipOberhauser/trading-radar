// Entwicklungs-Helfer: Screenshots der laufenden Seite (Desktop und Handy).
//   node scripts/shot.js <url> <zielordner>
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8787', out = process.argv[3] || '.';
  const b = await chromium.launch();
  const errors = [];
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 400, height: 860 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    p.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    await p.screenshot({ path: out + '/' + name + '.png', fullPage: name === 'phone' });
    if (name === 'desktop') {
      // ein paar Stellen im Chart anklicken, bis etwas ausgewählt ist
      const box = await p.locator('#chart').boundingBox();
      for (let i = 0; i < 40; i++) {
        await p.mouse.click(box.x + 200 + (i % 8) * 110, box.y + 120 + Math.floor(i / 8) * 90);
        if (await p.locator('.insp-title').count()) break;
      }
      await p.waitForTimeout(300);
      await p.screenshot({ path: out + '/desktop-selected.png' });
      console.log('overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    } else {
      console.log('overflow-phone', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    }
    await p.close();
  }
  console.log(errors.length ? errors.join('\n') : 'keine Konsolenfehler');
  await b.close();
})();
