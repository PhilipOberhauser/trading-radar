/* Trading Radar – Oberfläche: Daten laden, Chart zeichnen, Ebenen, Inspector. */
(function () {
  'use strict';

  var INSTRUMENTS = {
    stocks: [['AAPL', 'Apple'], ['NVDA', 'Nvidia'], ['TSLA', 'Tesla'], ['MSFT', 'Microsoft']],
    futures: [['NQ=F', 'Nasdaq 100'], ['ES=F', 'S&P 500'], ['GC=F', 'Gold']],
    crypto: [['BTCUSDT', 'Bitcoin'], ['ETHUSDT', 'Ethereum'], ['SOLUSDT', 'Solana']]
  };

  var LAYERS = [
    { key: 'pools', label: 'Liquiditäts-Pools', hint: 'BSL / SSL, gleiche Hochs und Tiefs', color: '--c-pool' },
    { key: 'htf', label: 'Pools aus 1h', hint: 'Liquidität des Stundencharts', color: '--c-htf' },
    { key: 'sweeps', label: 'Sweeps', hint: 'Level durchstochen, Schluss zurück', color: '--c-sweep' },
    { key: 'struct', label: 'Struktur', hint: 'HH / HL / LH / LL', color: '--c-struct' },
    { key: 'breaks', label: 'Strukturbrüche', hint: 'BOS und MSS', color: '--c-bos' },
    { key: 'obs', label: 'Order Blocks', hint: 'letzte Gegenkerze vor dem Impuls', color: '--c-ob' },
    { key: 'fvgs', label: 'Fair Value Gaps', hint: 'Lücken aus drei Kerzen', color: '--c-fvg' },
    { key: 'setups', label: 'Setup-Kandidaten', hint: 'Sweep, dann Strukturbruch', color: '--c-setup' },
    { key: 'trades', label: 'Trades', hint: 'Einstieg, Stop und Ziel', color: '--c-trade' },
    { key: 'days', label: 'Tagesgrenzen', hint: '', color: '--c-day' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var API = window.Radar = {};
  var cv = $('chart'), wrap = $('chartWrap'), ctx = cv.getContext('2d');
  var css = getComputedStyle(document.documentElement);
  var C = {};
  ['bg', 'panel', 'line', 'fg', 'muted', 'faint', 'accent', 'up', 'down', 'c-pool', 'c-htf', 'c-sweep', 'c-struct', 'c-bos', 'c-mss', 'c-ob', 'c-fvg', 'c-setup', 'c-trade', 'c-day']
    .forEach(function (k) { C[k] = css.getPropertyValue('--' + k).trim(); });
  var MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

  var S = {
    market: 'stocks', symbol: 'AAPL', tf: 5, swing: 3, rr: 2, mode: 'clean',
    on: {}, base: null, cs: [], R: null, bt: null, htf: [], meta: null, gotoT: null,
    view: { start: 0, bw: 7 }, sel: null, cross: null, hits: [], geo: null
  };
  LAYERS.forEach(function (l) { S.on[l.key] = true; });

  // ---------- Einstellungen merken ----------
  try {
    var saved = JSON.parse(localStorage.getItem('tradingRadar') || 'null');
    if (saved && INSTRUMENTS[saved.market]) {
      S.market = saved.market;
      if (INSTRUMENTS[S.market].some(function (x) { return x[0] === saved.symbol; })) S.symbol = saved.symbol;
      else S.symbol = INSTRUMENTS[S.market][0][0];
      if ([5, 15, 60].indexOf(saved.tf) >= 0) S.tf = saved.tf;
      if ([2, 3, 5].indexOf(saved.swing) >= 0) S.swing = saved.swing;
      if ([1.5, 2, 3].indexOf(saved.rr) >= 0) S.rr = saved.rr;
      if (saved.mode === 'all' || saved.mode === 'clean') S.mode = saved.mode;
      if (saved.on) LAYERS.forEach(function (l) { if (typeof saved.on[l.key] === 'boolean') S.on[l.key] = saved.on[l.key]; });
    }
  } catch (e) { /* ohne Speicher weiter */ }
  function persist() {
    try { localStorage.setItem('tradingRadar', JSON.stringify({ market: S.market, symbol: S.symbol, tf: S.tf, swing: S.swing, rr: S.rr, mode: S.mode, on: S.on })); } catch (e) { /* egal */ }
  }

  // ---------- Formatierung ----------
  var pad = function (x) { return (x < 10 ? '0' : '') + x; };
  function digits() { var c = S.cs.length ? S.cs[S.cs.length - 1].c : 100; return c < 10 ? 4 : 2; }
  function fp(x) { return x.toLocaleString('de-DE', { minimumFractionDigits: digits(), maximumFractionDigits: digits() }); }
  function fTime(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fDay(t) { var d = new Date(t); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.'; }
  function fFull(t) { return fDay(t) + ' ' + fTime(t); }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate(); }
  function fVol(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + ' Mio' : v >= 1e3 ? (v / 1e3).toFixed(1) + ' Tsd' : String(Math.round(v)); }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }
  function fR(tr) {
    if (tr.status === 'pending') return 'Order wartet';
    return (tr.r >= 0 ? '+' : '−') + Math.abs(tr.r).toFixed(1).replace('.', ',') + ' R' + (tr.status === 'open' ? ' (offen)' : '');
  }
  function fileKey(market, symbol) { return market + '_' + symbol.replace(/[^A-Z0-9]/g, ''); }
  function tfName(tf) { return tf === 60 ? '1h' : tf + 'm'; }

  // ---------- Daten laden ----------
  var loadToken = 0;
  function setStatus(cls, text) { var el = $('status'); el.className = 'status ' + cls; el.lastElementChild.textContent = text; }

  var dataCache = {};
  async function fetchData(market, symbol) {
    var key = fileKey(market, symbol);
    if (dataCache[key]) return dataCache[key];
    var data = null, live = false;
    try {
      var r = await fetch('api/candles?market=' + market + '&symbol=' + encodeURIComponent(symbol));
      if (r.ok) { data = await r.json(); live = !!(data && data.candles); }
    } catch (e) { /* kein Server -> Schnappschuss */ }
    if (!live) {
      data = null;
      try {
        var r2 = await fetch('data/' + key + '.json');
        if (r2.ok) data = await r2.json();
      } catch (e) { /* unten behandelt */ }
    }
    if (!data || !data.candles || !data.candles.length) return null;
    var out = {
      base: data.candles.map(function (r) { return { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }; }),
      meta: { source: data.source, fetchedAt: data.fetchedAt, live: live }
    };
    dataCache[key] = out;
    return out;
  }

  async function load() {
    var token = ++loadToken;
    setStatus('', 'Lade Kursdaten …');
    var d = await fetchData(S.market, S.symbol);
    if (token !== loadToken) return;
    if (!d) {
      setStatus('err', 'Keine Kursdaten für ' + S.symbol + '. Starte den Server mit „node server.js“ und lade neu.');
      return;
    }
    S.base = d.base; S.meta = d.meta;
    setStatus(d.meta.live ? 'live' : 'snap', (d.meta.live ? 'Live · ' : 'Schnappschuss · ') + d.meta.source + ' · Stand ' + fFull(d.meta.fetchedAt));
    rebuild(true);
  }

  function lowerBound(cs, t) {
    var lo = 0, hi = cs.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (cs[m].t < t) lo = m + 1; else hi = m; }
    return lo;
  }

  function rebuild(resetView) {
    if (!S.base) return;
    var keepT = !resetView && S.cs.length ? S.cs[Math.max(0, Math.min(S.cs.length - 1, Math.round(S.view.start + plotW() / S.view.bw)))].t : null;
    S.cs = S.tf === 5 ? S.base : Engine.aggregate(S.base, S.tf);
    S.R = Engine.analyze(S.cs, { swing: S.swing });
    S.bt = Engine.backtest(S.cs, S.R, { rr: S.rr });
    S.sel = null;

    // Pools des Stundencharts auf den aktuellen Zeitrahmen legen
    S.htf = [];
    if (S.tf < 60) {
      var hc = Engine.aggregate(S.base, 60), H = Engine.analyze(hc, { swing: 3 });
      H.pools.forEach(function (p) {
        var i0 = lowerBound(S.cs, hc[p.i].t), end = null;
        // genaue Kerze des Hochs/Tiefs innerhalb der Stunde suchen
        for (var k = i0; k < S.cs.length && S.cs[k].t < hc[p.i].t + 3600000; k++) {
          if (p.side === 'BSL' ? S.cs[k].h >= p.price : S.cs[k].l <= p.price) { i0 = k; break; }
        }
        if (p.end != null) {
          end = lowerBound(S.cs, hc[p.end].t);
          for (var q = end; q < S.cs.length && S.cs[q].t < hc[p.end].t + 3600000; q++) {
            if (p.side === 'BSL' ? S.cs[q].h > p.price : S.cs[q].l < p.price) { end = q; break; }
          }
        }
        S.htf.push({ id: 'h' + p.id, kind: 'pool', htf: true, side: p.side, equal: p.equal, touches: p.touches, i: i0, t: S.cs[Math.min(i0, S.cs.length - 1)].t, price: p.price, end: end, status: p.status });
      });
    }

    var n = S.cs.length, pw = plotW();
    if (resetView) {
      S.view.bw = Math.max(4, Math.min(11, pw / 130));
      S.view.start = n - pw / S.view.bw + 5;
    } else if (keepT != null) {
      S.view.start = lowerBound(S.cs, keepT) - pw / S.view.bw;
    }
    if (S.gotoT != null) { S.view.start = lowerBound(S.cs, S.gotoT) - pw / S.view.bw * 0.15; S.gotoT = null; }
    renderLayers();
    renderInspector();
    draw();
    scheduleEvents();
    if (API.onRebuild) API.onRebuild();
  }

  // ---------- Sichtbarkeit ----------
  function visible(ev) {
    if (S.mode === 'all') return true;
    if (ev.kind === 'pool') return ev.end == null || ev.end - ev.i >= (ev.htf ? 6 : 12);
    if (ev.kind === 'fvg') return ev.end == null || ev.end - ev.i >= 6;
    if (ev.kind === 'ob') return ev.status !== 'invalidated' || ev.end - ev.createdAt >= 6;
    return true;
  }
  function layerItems(key) {
    var R = S.R; if (!R) return [];
    switch (key) {
      case 'pools': return R.pools.filter(visible);
      case 'htf': return S.htf.filter(visible);
      case 'sweeps': return R.sweeps;
      case 'struct': return R.swings;
      case 'breaks': return R.breaks;
      case 'obs': return R.obs.filter(visible);
      case 'fvgs': return R.fvgs.filter(visible);
      case 'setups': return R.setups;
      case 'trades': return S.bt ? S.bt.trades : [];
      default: return [];
    }
  }

  // ---------- Beschreibung eines Objekts ----------
  function describe(ev) {
    var cs = S.cs, d = { title: '', color: C.fg, rows: [], explain: '', chain: null, short: '' };
    var endTxt = function (i) { return i == null ? 'noch offen' : fFull(cs[i].t); };
    if (ev.kind === 'pool') {
      var hi = ev.side === 'BSL';
      d.color = ev.htf ? C['c-htf'] : C['c-pool'];
      d.title = (ev.equal ? (hi ? 'Gleiche Hochs (EQH)' : 'Gleiche Tiefs (EQL)') : (hi ? 'Buy-Side-Liquidität (BSL)' : 'Sell-Side-Liquidität (SSL)')) + (ev.htf ? ' · 1h' : '');
      d.short = (ev.equal ? (hi ? 'EQH' : 'EQL') : ev.side) + (ev.htf ? ' 1h' : '') + ' bei ' + fp(ev.price);
      d.rows = [['Level', fp(ev.price)], ['Entstanden', fFull(ev.t)], ['Berührungen', String(ev.touches)],
        ['Status', ev.status === 'live' ? 'offen' : ev.status === 'swept' ? 'gesweept' : 'durchbrochen'], ['Geholt', endTxt(ev.end)]];
      d.explain = hi
        ? 'Über einem Swing-Hoch liegen meist Stop-Orders von Short-Positionen und Kauf-Stops von Ausbruchs-Tradern. Solche Level zieht der Kurs häufig an.'
        : 'Unter einem Swing-Tief liegen meist Stop-Orders von Long-Positionen und Verkaufs-Stops von Ausbruchs-Tradern. Solche Level zieht der Kurs häufig an.';
      if (ev.equal) d.explain += ' Mehrere Hochs oder Tiefs auf fast gleichem Niveau gelten als besonders auffällige Liquidität.';
    } else if (ev.kind === 'sweep') {
      d.color = C['c-sweep'];
      d.title = 'Sweep der ' + (ev.side === 'BSL' ? 'Buy-Side' : 'Sell-Side');
      d.short = 'Sweep ' + ev.side + ' bei ' + fp(ev.price);
      d.rows = [['Level', fp(ev.price)], ['Extrem der Kerze', fp(ev.extreme)], ['Tiefe', ev.depth.toFixed(2) + ' ATR'], ['Geholte Pools', String(ev.pools.length)], ['Zeit', fFull(ev.t)]];
      d.explain = 'Die Kerze sticht durch das Level, schließt aber wieder ' + (ev.side === 'BSL' ? 'darunter' : 'darüber') + '. Die Liquidität wurde geholt, ohne dass der Ausbruch gehalten hat – oft der Beginn einer Gegenbewegung.';
    } else if (ev.kind === 'swing') {
      d.color = C['c-struct'];
      var names = { HH: 'Höheres Hoch', LH: 'Tieferes Hoch', HL: 'Höheres Tief', LL: 'Tieferes Tief', H: 'Swing-Hoch', L: 'Swing-Tief' };
      d.title = names[ev.label] + ' (' + ev.label + ')';
      d.short = ev.label + ' bei ' + fp(ev.price);
      d.rows = [['Kurs', fp(ev.price)], ['Zeit', fFull(ev.t)], ['Bestätigt', fFull(cs[ev.confirmedAt].t)]];
      d.explain = 'Ein Swing gilt als bestätigt, sobald ' + S.swing + ' Kerzen links und rechts niedriger (Hoch) bzw. höher (Tief) liegen. Die Abfolge der Hochs und Tiefs zeigt die Trendrichtung.';
    } else if (ev.kind === 'break') {
      d.color = ev.type === 'MSS' ? C['c-mss'] : C['c-bos'];
      d.title = (ev.type === 'MSS' ? 'Market Structure Shift' : 'Break of Structure') + (ev.dir === 'up' ? ' nach oben' : ' nach unten');
      d.short = ev.type + (ev.dir === 'up' ? ' ↑ ' : ' ↓ ') + fp(ev.price);
      d.rows = [['Gebrochenes Level', fp(ev.price)], ['Swing vom', fFull(cs[ev.from].t)], ['Bruch', fFull(ev.t)], ['Impuls', ev.disp.toFixed(2) + ' ATR'], ['Order Block', ev.ob ? fp(ev.ob.bottom) + ' – ' + fp(ev.ob.top) : 'keiner (Impuls zu schwach)']];
      d.explain = ev.type === 'MSS'
        ? 'Erster Schlusskurs jenseits eines Swings gegen den bisherigen Trend. Das ist ein möglicher Richtungswechsel.'
        : 'Schlusskurs jenseits des letzten Swings in Trendrichtung. Der bestehende Trend setzt sich fort.';
    } else if (ev.kind === 'ob') {
      d.color = C['c-ob'];
      d.title = (ev.dir === 'bull' ? 'Bullischer' : 'Bärischer') + ' Order Block';
      d.short = 'Order Block ' + (ev.dir === 'bull' ? '↑ ' : '↓ ') + fp(ev.bottom) + ' – ' + fp(ev.top);
      d.rows = [['Zone', fp(ev.bottom) + ' – ' + fp(ev.top)], ['Kerze', fFull(ev.t)], ['Bestätigt', fFull(cs[ev.createdAt].t)], ['Impuls', ev.disp.toFixed(2) + ' ATR'],
        ['Status', ev.status === 'live' ? 'unberührt' : ev.status === 'mitigated' ? 'angelaufen' : 'ungültig'], ['Erster Rücklauf', ev.mitigatedAt == null ? '–' : fFull(cs[ev.mitigatedAt].t)]];
      d.explain = 'Die letzte Gegenkerze vor einem starken Impuls, der die Struktur gebrochen hat. Kommt der Kurs in diese Zone zurück, reagiert er dort häufig. Ein Schlusskurs durch die Zone macht sie ungültig.';
    } else if (ev.kind === 'fvg') {
      d.color = C['c-fvg'];
      d.title = (ev.dir === 'bull' ? 'Bullisches' : 'Bärisches') + ' Fair Value Gap';
      d.short = 'FVG ' + (ev.dir === 'bull' ? '↑ ' : '↓ ') + fp(ev.bottom) + ' – ' + fp(ev.top);
      d.rows = [['Lücke', fp(ev.bottom) + ' – ' + fp(ev.top)], ['Größe', ev.size.toFixed(2) + ' ATR'], ['Entstanden', fFull(ev.t)],
        ['Status', { open: ev.touchedAt == null ? 'offen' : 'teilweise gefüllt', filled: 'gefüllt', inverted: 'invertiert' }[ev.status]], ['Geschlossen', endTxt(ev.end)]];
      d.explain = 'Bei einer schnellen Bewegung bleibt zwischen dem Docht der ersten und der dritten Kerze eine Lücke. Solche Lücken werden oft später wieder gefüllt. Schließt der Kurs komplett hindurch, gilt die Lücke als invertiert.';
    } else if (ev.kind === 'setup') {
      d.color = C['c-setup'];
      d.title = 'Setup-Kandidat ' + (ev.dir === 'long' ? 'Long' : 'Short');
      d.short = 'Setup ' + (ev.dir === 'long' ? 'Long' : 'Short') + ' bei ' + fp(ev.price);
      d.chain = [
        'Sweep der ' + (ev.sweep.side === 'BSL' ? 'Buy-Side' : 'Sell-Side') + ' bei ' + fp(ev.sweep.price) + ' um ' + fTime(ev.sweep.t),
        ev.brk.type + (ev.brk.dir === 'up' ? ' nach oben' : ' nach unten') + ' über ' + fp(ev.brk.price) + ' um ' + fTime(ev.brk.t) + ' (Impuls ' + ev.brk.disp.toFixed(1) + ' ATR)',
        ev.ob ? 'Order Block als Rücklaufzone: ' + fp(ev.ob.bottom) + ' – ' + fp(ev.ob.top) : 'Kein Order Block (Impuls unter 1,5 ATR)'
      ];
      d.rows = [['Schlusskurs', fp(ev.price)], ['Zeit', fFull(ev.t)], ['Kerzen seit Sweep', String(ev.bars)]];
      d.explain = 'Erst wurde Liquidität geholt, danach brach die Struktur in die Gegenrichtung. Ob daraus ein Trade wurde oder warum nicht, steht in der Auswertung.';
    } else if (ev.kind === 'trade') {
      var res = { win: 'Ziel erreicht', loss: 'Stop ausgelöst', open: 'läuft noch', pending: 'Order wartet auf Rücklauf' }[ev.status];
      d.color = ev.status === 'win' ? C.up : ev.status === 'loss' ? C.down : C['c-trade'];
      d.title = (ev.dir === 'long' ? 'Long' : 'Short') + '-Trade · ' + res;
      d.short = (ev.dir === 'long' ? 'Long ' : 'Short ') + fp(ev.entry) + ' · ' + fR(ev);
      var su = ev.setup;
      d.chain = [
        'Sweep der ' + (su.sweep.side === 'BSL' ? 'Buy-Side' : 'Sell-Side') + ' bei ' + fp(su.sweep.price) + ' um ' + fTime(su.sweep.t),
        su.brk.type + (su.brk.dir === 'up' ? ' nach oben' : ' nach unten') + ' über ' + fp(su.brk.price) + ' um ' + fTime(su.brk.t),
        'Limit-Order an der Kante des Order Blocks bei ' + fp(su.dir === 'long' ? su.ob.top : su.ob.bottom),
        ev.fill == null ? 'Noch kein Rücklauf' : 'Einstieg um ' + fFull(cs[ev.fill].t) + ' zu ' + fp(ev.entry),
        ev.exit == null ? (ev.fill == null ? 'Kein Ausstieg' : 'Position offen') : 'Ausstieg um ' + fFull(cs[ev.exit].t) + ' zu ' + fp(ev.exitPrice)
      ];
      d.rows = [['Einstieg', fp(ev.entry)], ['Stop', fp(ev.stop)], ['Ziel', fp(ev.target)], ['Risiko', ev.riskAtr.toFixed(2) + ' ATR'], ['Ergebnis', fR(ev)]];
      d.explain = 'Regel: Einstieg beim Rücklauf in den Order Block, Stop hinter dem Sweep-Extrem, Ziel beim ' + String(ev.rr).replace('.', ',') + '-fachen Risiko. Gerechnet ohne Gebühren und Slippage. Trifft eine Kerze Stop und Ziel zugleich, zählt der Stop.';
    }
    return d;
  }

  // ---------- Zeichnen ----------
  var AX = 62, AY = 22, TOP = 10;
  function plotW() { return Math.max(100, wrap.clientWidth - AX); }
  function clampView() {
    var n = S.cs.length, bars = plotW() / S.view.bw;
    S.view.bw = Math.max(1.5, Math.min(40, S.view.bw));
    S.view.start = Math.max(-bars * 0.5, Math.min(n - bars * 0.25, S.view.start));
  }

  var raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; paint(); }); }

  function paint() {
    var dpr = window.devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, H);
    var cs = S.cs, n = cs.length, R = S.R;
    S.hits = [];
    if (!n || !R) return;
    clampView();

    var pw = W - AX, ph = H - AY, volH = Math.round(ph * 0.13), priceH = ph - volH - TOP - 6;
    var bw = S.view.bw, start = S.view.start;
    var i0 = Math.max(0, Math.floor(start)), i1 = Math.min(n - 1, Math.ceil(start + pw / bw));
    if (i1 < i0) { i0 = Math.max(0, n - 2); i1 = n - 1; }
    var lo = Infinity, hi = -Infinity, vmax = 0, i;
    for (i = i0; i <= i1; i++) { if (cs[i].l < lo) lo = cs[i].l; if (cs[i].h > hi) hi = cs[i].h; if (cs[i].v > vmax) vmax = cs[i].v; }
    var padP = (hi - lo) * 0.08 || hi * 0.001; lo -= padP; hi += padP;
    var X = function (k) { return (k - start) * bw + bw / 2; };
    var Y = function (p) { return TOP + (hi - p) / (hi - lo) * priceH; };
    S.geo = { pw: pw, ph: ph, i0: i0, i1: i1, lo: lo, hi: hi, priceH: priceH, X: X, Y: Y };
    var selId = S.sel && S.sel.id, selRect = null;
    function hit(x, y, w, h, ev) {
      S.hits.push({ x: x, y: y, w: w, h: h, ev: ev });
      if (ev.id === selId) selRect = { x: x, y: y, w: w, h: h };
    }
    var inY = function (p) { return p >= lo && p <= hi; };

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();

    // Gitter
    ctx.strokeStyle = rgba(C.line, 0.6); ctx.lineWidth = 1;
    var stepP = niceStep((hi - lo) / 7), p0 = Math.ceil(lo / stepP) * stepP, pr;
    ctx.beginPath();
    for (pr = p0; pr < hi; pr += stepP) { var gy = Math.round(Y(pr)) + 0.5; ctx.moveTo(0, gy); ctx.lineTo(pw, gy); }
    ctx.stroke();

    // Tagesgrenzen
    ctx.font = '10px ' + MONO; ctx.textBaseline = 'top';
    if (S.on.days) {
      for (i = Math.max(1, i0); i <= i1; i++) {
        if (dayKey(cs[i].t) !== dayKey(cs[i - 1].t)) {
          var dx = Math.round(X(i) - bw / 2) + 0.5;
          ctx.strokeStyle = rgba(C['c-day'], 0.8); ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.moveTo(dx, 0); ctx.lineTo(dx, ph); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.fillText(fDay(cs[i].t), dx + 4, 2);
        }
      }
    }

    // Zonen: FVG und Order Blocks
    function zone(ev, a, b, color, label) {
      if (b < i0 || a > i1) return;
      if (ev.top < lo || ev.bottom > hi) return;
      var x0 = X(a) - bw / 2, x1 = Math.min(pw, X(b) + bw / 2), y0 = Y(ev.top), y1 = Y(ev.bottom);
      var done = ev.end != null || ev.status === 'mitigated';
      ctx.fillStyle = rgba(color, done ? 0.04 : 0.11); ctx.fillRect(x0, y0, x1 - x0, Math.max(1, y1 - y0));
      ctx.strokeStyle = rgba(color, done ? 0.3 : 0.7); ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.max(1, Math.round(y1 - y0)));
      if (label && bw >= 3.5 && y1 - y0 >= 11 && x1 - x0 > 40) {
        ctx.fillStyle = rgba(color, done ? 0.55 : 0.95); ctx.font = '9px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(label, Math.max(2, x0 + 3), y0 + 2);
      }
      hit(Math.max(0, x0), y0, x1 - Math.max(0, x0), Math.max(4, y1 - y0), ev);
    }
    if (S.on.fvgs) layerItems('fvgs').forEach(function (f) { zone(f, f.i, f.end == null ? n + 50 : f.end, C['c-fvg'], f.status === 'inverted' ? 'iFVG' : 'FVG'); });
    if (S.on.obs) layerItems('obs').forEach(function (o) {
      var b = o.end != null ? o.end : o.mitigatedAt != null ? o.mitigatedAt : n + 50;
      zone(o, o.i, b, C['c-ob'], 'OB ' + (o.dir === 'bull' ? '↑' : '↓'));
    });

    // Pools
    function poolLine(p, color, width, dash) {
      var b = p.end == null ? n + 50 : p.end;
      if (b < i0 || p.i > i1 || !inY(p.price)) return;
      var x0 = Math.max(0, X(p.i)), x1 = Math.min(pw, X(b)), y = Math.round(Y(p.price)) + 0.5;
      ctx.strokeStyle = rgba(color, p.end == null ? 0.95 : 0.5); ctx.lineWidth = width + (p.equal ? 0.8 : 0);
      ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      if (x1 - x0 > 46 && bw >= 3) {
        var txt = (p.equal ? (p.side === 'BSL' ? 'EQH' : 'EQL') : p.side) + (p.htf ? ' 1h' : '');
        ctx.fillStyle = rgba(color, p.end == null ? 1 : 0.6); ctx.font = '9px ' + MONO; ctx.textAlign = 'right';
        ctx.textBaseline = p.side === 'BSL' ? 'bottom' : 'top';
        ctx.fillText(txt, x1 - 3, y + (p.side === 'BSL' ? -2 : 2));
      }
      hit(x0, y - 5, x1 - x0, 10, p);
    }
    if (S.on.htf) layerItems('htf').forEach(function (p) { poolLine(p, C['c-htf'], 1.4, [6, 3]); });
    if (S.on.pools) layerItems('pools').forEach(function (p) { poolLine(p, C['c-pool'], 1); });

    // Strukturbrüche
    if (S.on.breaks) R.breaks.forEach(function (b) {
      if (b.i < i0 || b.from > i1 || !inY(b.price)) return;
      var color = b.type === 'MSS' ? C['c-mss'] : C['c-bos'];
      var x0 = X(b.from), x1 = X(b.i), y = Math.round(Y(b.price)) + 0.5;
      ctx.strokeStyle = rgba(color, 0.85); ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
      if (bw >= 3 && x1 - x0 > 26) {
        ctx.fillStyle = color; ctx.font = '600 9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = b.dir === 'up' ? 'bottom' : 'top';
        ctx.fillText(b.type, (x0 + x1) / 2, y + (b.dir === 'up' ? -2 : 2));
      }
      hit(x0, y - 5, x1 - x0, 10, b);
    });

    // Trades: Risiko rot, Ziel grün, gestrichelt die wartende Order
    if (S.on.trades && S.bt) S.bt.trades.forEach(function (t) {
      var b = t.exit != null ? t.exit : n + 50;
      if (b < i0 || t.i > i1) return;
      var xs = X(t.i), ye = Y(t.entry), yt = Y(t.target), ys = Y(t.stop);
      var xf = t.fill != null ? X(t.fill) - bw / 2 : Math.min(pw, X(b)), x1 = Math.min(pw, X(b) + bw / 2);
      ctx.strokeStyle = C['c-trade']; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(xs, Math.round(ye) + 0.5); ctx.lineTo(xf, Math.round(ye) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      if (t.fill != null) {
        ctx.fillStyle = rgba(C.up, 0.14); ctx.fillRect(xf, Math.min(ye, yt), x1 - xf, Math.abs(yt - ye));
        ctx.fillStyle = rgba(C.down, 0.14); ctx.fillRect(xf, Math.min(ye, ys), x1 - xf, Math.abs(ys - ye));
        ctx.strokeStyle = rgba(C['c-trade'], 0.9); ctx.beginPath(); ctx.moveTo(xf, Math.round(ye) + 0.5); ctx.lineTo(x1, Math.round(ye) + 0.5); ctx.stroke();
        ctx.strokeStyle = rgba(C.up, 0.7); ctx.beginPath(); ctx.moveTo(xf, Math.round(yt) + 0.5); ctx.lineTo(x1, Math.round(yt) + 0.5); ctx.stroke();
        ctx.strokeStyle = rgba(C.down, 0.7); ctx.beginPath(); ctx.moveTo(xf, Math.round(ys) + 0.5); ctx.lineTo(x1, Math.round(ys) + 0.5); ctx.stroke();
      }
      if (bw >= 3) {
        ctx.fillStyle = C['c-trade']; ctx.font = '600 9px ' + MONO; ctx.textAlign = 'left';
        ctx.textBaseline = t.dir === 'long' ? 'bottom' : 'top';
        ctx.fillText((t.dir === 'long' ? 'LONG ' : 'SHORT ') + fR(t), Math.max(2, xf + 3), (t.fill != null ? yt : ye) + (t.dir === 'long' ? -2 : 2));
      }
      var top = Math.min(yt, ys), x0 = Math.max(0, Math.min(xs, xf));
      hit(x0, t.fill != null ? top : ye - 5, Math.max(8, x1 - x0), t.fill != null ? Math.abs(ys - yt) : 10, t);
    });

    // Volumen
    for (i = i0; i <= i1; i++) {
      var vb = cs[i], vh = vmax ? vb.v / vmax * (volH - 2) : 0;
      ctx.fillStyle = rgba(vb.c >= vb.o ? C.up : C.down, 0.35);
      ctx.fillRect(X(i) - Math.max(0.5, bw * 0.35), ph - vh, Math.max(1, bw * 0.7), vh);
    }

    // Kerzen
    var body = Math.max(1, Math.floor(bw * 0.7));
    for (i = i0; i <= i1; i++) {
      var k = cs[i], col = k.c >= k.o ? C.up : C.down, cx = Math.round(X(i));
      ctx.fillStyle = col;
      ctx.fillRect(cx, Y(k.h), 1, Math.max(1, Y(k.l) - Y(k.h)));
      var yt = Y(Math.max(k.o, k.c)), yb = Y(Math.min(k.o, k.c));
      ctx.fillRect(cx - Math.floor(body / 2), yt, body, Math.max(1, yb - yt));
    }

    // Struktur: Zickzack und Beschriftung
    if (S.on.struct && R.swings.length) {
      ctx.strokeStyle = rgba(C['c-struct'], 0.75); ctx.lineWidth = 1.1; ctx.beginPath();
      var first = true;
      R.swings.forEach(function (s, idx) {
        var nx = R.swings[idx + 1];
        if (s.i < i0 - 1 && nx && nx.i < i0) return;
        if (s.i > i1 && !first) { ctx.lineTo(X(s.i), Y(s.price)); first = null; return; }
        if (first === null) return;
        if (first) { ctx.moveTo(X(s.i), Y(s.price)); first = false; } else ctx.lineTo(X(s.i), Y(s.price));
      });
      ctx.stroke();
      R.swings.forEach(function (s) {
        if (s.i < i0 || s.i > i1) return;
        var x = X(s.i), y = Y(s.price);
        ctx.fillStyle = C['c-struct']; ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.3); ctx.fill();
        if (bw >= 3.5) {
          ctx.font = '600 9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = s.type === 'H' ? 'bottom' : 'top';
          ctx.fillText(s.label, x, y + (s.type === 'H' ? -4 : 4));
        }
        hit(x - 9, s.type === 'H' ? y - 16 : y - 4, 18, 20, s);
      });
    }

    // Sweeps
    if (S.on.sweeps) R.sweeps.forEach(function (s) {
      if (s.i < i0 || s.i > i1) return;
      var up = s.side === 'BSL', x = X(s.i), off = S.on.struct ? 17 : 6, y = Y(s.extreme) + (up ? -off : off);
      ctx.fillStyle = C['c-sweep']; ctx.beginPath();
      if (up) { ctx.moveTo(x - 4.5, y - 7); ctx.lineTo(x + 4.5, y - 7); ctx.lineTo(x, y); }
      else { ctx.moveTo(x - 4.5, y + 7); ctx.lineTo(x + 4.5, y + 7); ctx.lineTo(x, y); }
      ctx.closePath(); ctx.fill();
      hit(x - 8, up ? y - 11 : y - 3, 16, 14, s);
    });

    // Setup-Kandidaten
    if (S.on.setups) R.setups.forEach(function (s) {
      if (s.i < i0 || s.i > i1) return;
      var long = s.dir === 'long', x = X(s.i), y = long ? Y(cs[s.i].l) + 30 : Y(cs[s.i].h) - 30;
      star(x, y, 6.5, C['c-setup']);
      if (bw >= 4) {
        ctx.fillStyle = C['c-setup']; ctx.font = '600 9px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = long ? 'top' : 'bottom';
        ctx.fillText(long ? 'LONG?' : 'SHORT?', x, y + (long ? 9 : -9));
      }
      hit(x - 16, y - 12, 32, 30, s);
    });

    // Auswahl hervorheben
    if (selRect) {
      ctx.strokeStyle = C.fg; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
      ctx.strokeRect(selRect.x - 2, selRect.y - 2, selRect.w + 4, selRect.h + 4); ctx.setLineDash([]);
    }

    // Fadenkreuz
    var cr = S.cross;
    if (cr && cr.x < pw && cr.y < ph) {
      var ci = Math.max(0, Math.min(n - 1, Math.round(start + cr.x / bw - 0.5)));
      ctx.strokeStyle = rgba(C.muted, 0.7); ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath();
      ctx.moveTo(Math.round(X(ci)) + 0.5, 0); ctx.lineTo(Math.round(X(ci)) + 0.5, ph);
      ctx.moveTo(0, Math.round(cr.y) + 0.5); ctx.lineTo(pw, Math.round(cr.y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      cr.i = ci;
    }
    ctx.restore();

    // Achsen
    ctx.fillStyle = C.panel; ctx.fillRect(pw, 0, AX, H); ctx.fillRect(0, ph, W, AY);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(pw + 0.5, 0); ctx.lineTo(pw + 0.5, ph + 0.5); ctx.lineTo(0, ph + 0.5); ctx.stroke();
    ctx.font = '10px ' + MONO; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (pr = p0; pr < hi; pr += stepP) { var ly = Y(pr); if (ly > 8 && ly < ph - 6) ctx.fillText(fp(pr), pw + 6, ly); }

    var stepB = Math.max(1, Math.ceil(78 / bw)), lastDay = null;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (i = Math.ceil(i0 / stepB) * stepB; i <= i1; i += stepB) {
      var tx = X(i); if (tx < 24 || tx > pw - 24) continue;
      var dk = dayKey(cs[i].t), lab = S.tf >= 60 || dk !== lastDay ? fDay(cs[i].t) + ' ' + fTime(cs[i].t) : fTime(cs[i].t);
      lastDay = dk; ctx.fillStyle = C.muted; ctx.fillText(lab, tx, ph + AY / 2 + 1);
    }

    // letzter Kurs
    var last = cs[n - 1], lyy = Y(last.c);
    if (lyy > 0 && lyy < ph) tag(pw, lyy, fp(last.c), last.c >= last.o ? C.up : C.down, '#0c0d10');
    if (cr && cr.x < pw && cr.y < ph) {
      tag(pw, cr.y, fp(hi - (cr.y - TOP) / priceH * (hi - lo)), C.fg, '#0c0d10');
      var tl = fFull(cs[cr.i].t), tw = ctx.measureText(tl).width + 10, cxx = Math.max(tw / 2, Math.min(pw - tw / 2, X(cr.i)));
      ctx.fillStyle = C.fg; ctx.fillRect(cxx - tw / 2, ph + 2, tw, AY - 4);
      ctx.fillStyle = '#0c0d10'; ctx.textAlign = 'center'; ctx.fillText(tl, cxx, ph + AY / 2 + 1);
    }
    readout(cr && cr.i != null && cr.x < pw ? cr.i : n - 1);

    function tag(x, y, text, bg, fg) {
      ctx.font = '10px ' + MONO; ctx.fillStyle = bg; ctx.fillRect(x + 1, y - 8, AX - 1, 16);
      ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 6, y + 0.5);
    }
    function star(x, y, r, color) {
      ctx.fillStyle = color; ctx.beginPath();
      for (var a = 0; a < 10; a++) {
        var rr = a % 2 ? r * 0.45 : r, ang = -Math.PI / 2 + a * Math.PI / 5;
        ctx[a ? 'lineTo' : 'moveTo'](x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
      }
      ctx.closePath(); ctx.fill();
    }
  }

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  function readout(i) {
    var k = S.cs[i]; if (!k) return;
    var name = (INSTRUMENTS[S.market].filter(function (x) { return x[0] === S.symbol; })[0] || [])[1] || S.symbol;
    var chg = (k.c - k.o) / k.o * 100, cls = k.c >= k.o ? 'up' : 'down';
    $('readout').innerHTML = '<span class="sym">' + name + ' · ' + tfName(S.tf) + '</span><span>' + fFull(k.t) + '</span>' +
      '<span>O <b>' + fp(k.o) + '</b></span><span>H <b>' + fp(k.h) + '</b></span><span>L <b>' + fp(k.l) + '</b></span>' +
      '<span>C <b class="' + cls + '">' + fp(k.c) + '</b></span><span class="' + cls + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2).replace('.', ',') + ' %</span>' +
      '<span>Vol <b>' + fVol(k.v) + '</b></span>';
  }

  // ---------- Seitenleiste ----------
  function renderLayers() {
    var box = $('layers'); box.innerHTML = '';
    LAYERS.forEach(function (l) {
      if (l.key === 'htf' && S.tf >= 60) return;
      var row = document.createElement('label'); row.className = 'layer';
      var cnt = l.key === 'days' ? '' : layerItems(l.key).length;
      row.innerHTML = '<input type="checkbox" id="layer-' + l.key + '"' + (S.on[l.key] ? ' checked' : '') + '>' +
        '<span class="dot" style="background:' + C[l.color.slice(2)] + '"></span>' +
        '<span class="name">' + l.label + (l.hint ? '<small>' + l.hint + '</small>' : '') + '</span><span class="n">' + cnt + '</span>';
      row.firstChild.addEventListener('change', function (e) { S.on[l.key] = e.target.checked; persist(); draw(); scheduleEvents(); });
      box.appendChild(row);
    });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderInspector() {
    var box = $('inspector');
    if (!S.sel) { box.innerHTML = '<p class="insp-empty">Tippe im Chart auf eine Zone, Linie oder Markierung, um zu sehen, was erkannt wurde und warum.</p>'; return; }
    var d = describe(S.sel);
    box.innerHTML = '<div class="insp-title"><span class="dot" style="background:' + d.color + '"></span>' + esc(d.title) + '</div>' +
      (d.chain ? '<ol class="chain">' + d.chain.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ol>' : '') +
      '<dl class="kv">' + d.rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<p class="explain">' + esc(d.explain) + '</p>';
  }

  var evTimer = 0;
  function scheduleEvents() { clearTimeout(evTimer); evTimer = setTimeout(renderEvents, 140); }
  function renderEvents() {
    var box = $('events'), g = S.geo; box.innerHTML = '';
    if (!g || !S.R) return;
    var list = [];
    [['trades', 'i'], ['setups', 'i'], ['sweeps', 'i'], ['breaks', 'i'], ['obs', 'createdAt'], ['fvgs', 'createdAt'], ['pools', 'confirmedAt'], ['htf', 'i']].forEach(function (pair) {
      if (!S.on[pair[0]]) return;
      layerItems(pair[0]).forEach(function (ev) { var at = ev[pair[1]]; if (at >= g.i0 && at <= g.i1) list.push({ at: at, ev: ev }); });
    });
    list.sort(function (a, b) { return b.at - a.at; });
    if (!list.length) { box.innerHTML = '<p class="insp-empty">In diesem Ausschnitt wurde nichts erkannt.</p>'; return; }
    list.slice(0, 80).forEach(function (it) {
      var d = describe(it.ev), b = document.createElement('button');
      b.type = 'button'; b.className = 'ev';
      if (S.sel && S.sel.id === it.ev.id) b.setAttribute('aria-current', 'true');
      b.innerHTML = '<time>' + fFull(S.cs[Math.min(it.at, S.cs.length - 1)].t) + '</time><span class="dot" style="background:' + d.color + '"></span><span>' + esc(d.short) + '</span>';
      b.addEventListener('click', function () { select(it.ev); });
      box.appendChild(b);
    });
  }

  function select(ev) { S.sel = ev; renderInspector(); draw(); scheduleEvents(); }

  // ---------- Bedienung ----------
  function zoomAt(factor, x) {
    var idx = S.view.start + x / S.view.bw, nb = Math.max(1.5, Math.min(40, S.view.bw * factor));
    S.view.bw = nb; S.view.start = idx - x / nb; draw(); scheduleEvents();
  }
  var ptrs = new Map(), drag = null, pinch = null, moved = 0;
  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pinchState() {
    var a = Array.from(ptrs.values());
    return { d: Math.max(10, Math.abs(a[0].x - a[1].x)), mid: (a[0].x + a[1].x) / 2 };
  }
  cv.addEventListener('pointerdown', function (e) {
    var p = pos(e); ptrs.set(e.pointerId, p);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    if (ptrs.size === 1) { drag = { x: p.x, start: S.view.start }; moved = 0; }
    else if (ptrs.size === 2) { var ps = pinchState(); pinch = { d: ps.d, bw: S.view.bw, idx: S.view.start + ps.mid / S.view.bw }; drag = null; moved = 99; }
  });
  cv.addEventListener('pointermove', function (e) {
    var p = pos(e);
    if (ptrs.has(e.pointerId)) {
      ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) {
        var ps = pinchState();
        S.view.bw = Math.max(1.5, Math.min(40, pinch.bw * ps.d / pinch.d));
        S.view.start = pinch.idx - ps.mid / S.view.bw;
        draw(); scheduleEvents();
      } else if (drag) {
        var dx = p.x - drag.x; moved = Math.max(moved, Math.abs(dx));
        if (moved > 4) { S.view.start = drag.start - dx / S.view.bw; S.cross = null; draw(); scheduleEvents(); }
      }
    } else if (e.pointerType === 'mouse') { S.cross = p; draw(); }
  });
  function up(e, cancelled) {
    var had = ptrs.has(e.pointerId), p = pos(e);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { var rest = Array.from(ptrs.values())[0]; drag = { x: rest.x, start: S.view.start }; }
    if (ptrs.size === 0) {
      drag = null;
      if (had && !cancelled && moved <= 4) click(p, e.pointerType);
    }
  }
  cv.addEventListener('pointerup', function (e) { up(e, false); });
  cv.addEventListener('pointercancel', function (e) { up(e, true); });
  cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !ptrs.size) { S.cross = null; draw(); } });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { S.view.start += e.deltaX / S.view.bw; draw(); scheduleEvents(); }
    else zoomAt(Math.exp(-e.deltaY * 0.0015), pos(e).x);
  }, { passive: false });
  cv.addEventListener('keydown', function (e) {
    var bars = plotW() / S.view.bw;
    if (e.key === 'ArrowLeft') S.view.start -= bars * 0.15;
    else if (e.key === 'ArrowRight') S.view.start += bars * 0.15;
    else if (e.key === '+' || e.key === '=') return zoomAt(1.25, plotW() / 2);
    else if (e.key === '-') return zoomAt(0.8, plotW() / 2);
    else return;
    e.preventDefault(); draw(); scheduleEvents();
  });

  function click(p, type) {
    var best = null, area = Infinity, tol = type === 'mouse' ? 3 : 8;
    S.hits.forEach(function (h) {
      if (p.x >= h.x - tol && p.x <= h.x + h.w + tol && p.y >= h.y - tol && p.y <= h.y + h.h + tol) {
        var a = h.w * h.h; if (a < area) { area = a; best = h.ev; }
      }
    });
    S.cross = p;
    select(best);
  }

  $('zin').addEventListener('click', function () { zoomAt(1.35, plotW() * 0.7); });
  $('zout').addEventListener('click', function () { zoomAt(1 / 1.35, plotW() * 0.7); });
  $('znow').addEventListener('click', function () { S.view.start = S.cs.length - plotW() / S.view.bw + 5; draw(); scheduleEvents(); });

  function pressed(groupId, attr, value) {
    Array.prototype.forEach.call($(groupId).querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(value))); });
  }
  function fillSymbols() {
    $('symbol').innerHTML = INSTRUMENTS[S.market].map(function (x) { return '<option value="' + x[0] + '">' + x[1] + ' (' + x[0].replace('USDT', '').replace('=F', '') + ')</option>'; }).join('');
    $('symbol').value = S.symbol;
  }
  $('marketSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.dataset.market === S.market) return;
    S.market = b.dataset.market; S.symbol = INSTRUMENTS[S.market][0][0];
    pressed('marketSeg', 'data-market', S.market); fillSymbols(); persist(); load();
  });
  $('symbol').addEventListener('change', function (e) { S.symbol = e.target.value; persist(); load(); });
  $('tfSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.tf = +b.dataset.tf; pressed('tfSeg', 'data-tf', S.tf); persist(); rebuild(false);
  });
  $('swingSel').addEventListener('change', function (e) { S.swing = +e.target.value; persist(); rebuild(false); });
  $('rrSel').addEventListener('change', function (e) { S.rr = +e.target.value; persist(); rebuild(false); });
  $('modeSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    S.mode = b.dataset.mode; pressed('modeSeg', 'data-mode', S.mode); persist(); renderLayers(); draw(); scheduleEvents();
  });

  if (window.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(wrap);
  else window.addEventListener('resize', draw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);

  pressed('marketSeg', 'data-market', S.market);
  pressed('tfSeg', 'data-tf', S.tf);
  pressed('modeSeg', 'data-mode', S.mode);
  $('swingSel').value = String(S.swing);
  $('rrSel').value = String(S.rr);
  fillSymbols();

  // Schnittstelle für Auswertung und Übersicht (views.js)
  API.S = S; API.C = C; API.INSTRUMENTS = INSTRUMENTS; API.fetchData = fetchData;
  API.fp = fp; API.fR = fR; API.fDay = fDay; API.fTime = fTime; API.fFull = fFull; API.dayKey = dayKey; API.tfName = tfName; API.esc = esc; API.describe = describe;
  API.draw = draw;
  API.showEvent = function (ev, at) {
    S.view.start = at - plotW() / S.view.bw * 0.45;
    select(ev);
  };
  API.gotoT = function (t) { S.view.start = lowerBound(S.cs, t) - plotW() / S.view.bw * 0.15; draw(); scheduleEvents(); };
  API.open = function (market, symbol, t) {
    S.gotoT = t;
    if (market === S.market && symbol === S.symbol && S.base) { rebuild(false); return; }
    S.market = market; S.symbol = symbol;
    pressed('marketSeg', 'data-market', S.market); fillSymbols(); persist(); load();
  };
  load();
})();
