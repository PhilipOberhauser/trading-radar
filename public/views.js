/* Trading Radar – Ansichten "Auswertung" (ein Instrument) und "Übersicht" (alle Instrumente). */
(function () {
  'use strict';
  var A = window.Radar, S = A.S, C = A.C, esc = A.esc;
  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['chart', 'auswertung', 'uebersicht'];
  var current = 'chart', selDay = null;
  var MARKET_NAME = { stocks: 'Aktien', futures: 'Futures', crypto: 'Krypto' };

  // ---------- Formatierung ----------
  function num(x, d) { return x.toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function sR(x) { return (x >= 0 ? '+' : '−') + num(Math.abs(x), 1) + ' R'; }
  function cls(x) { return x > 0 ? 'pos' : x < 0 ? 'neg' : ''; }
  function pf(x) { return x === Infinity ? '∞' : num(x, 2); }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }
  function dateKey(t) { var d = new Date(t), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function symName(market, symbol) {
    var hit = A.INSTRUMENTS[market].filter(function (x) { return x[0] === symbol; })[0];
    return hit ? hit[1] : symbol;
  }

  // ---------- Tage auswerten ----------
  function daily(cs, R, bt) {
    var days = [], byKey = {}, dayOf = new Array(cs.length);
    for (var i = 0; i < cs.length; i++) {
      var k = dateKey(cs[i].t), d = byKey[k];
      if (!d) { d = byKey[k] = { key: k, t: cs[i].t, bars: 0, events: 0, setups: 0, trades: [], refusals: [], r: 0, closed: 0 }; days.push(d); }
      d.bars++; dayOf[i] = d;
    }
    var at = function (i) { return dayOf[Math.min(i, cs.length - 1)]; };
    R.sweeps.forEach(function (e) { at(e.i).events++; });
    R.breaks.forEach(function (e) { at(e.i).events++; });
    R.obs.forEach(function (e) { at(e.createdAt).events++; });
    R.fvgs.forEach(function (e) { at(e.createdAt).events++; });
    R.pools.forEach(function (e) { at(e.confirmedAt).events++; });
    R.setups.forEach(function (e) { at(e.i).setups++; });
    bt.trades.forEach(function (t) { var d = at(t.i); d.trades.push(t); if (t.exit != null) { d.r += t.r; d.closed++; } });
    bt.refusals.forEach(function (r) { at(r.i).refusals.push(r); });
    return days;
  }

  function tiles(list) {
    return '<div class="tiles">' + list.map(function (t) {
      return '<div class="tile"><b class="' + (t[2] || '') + '">' + t[0] + '</b><span>' + t[1] + '</span></div>';
    }).join('') + '</div>';
  }

  // ---------- Ergebniskurve ----------
  function curveSvg(eq) {
    var W = 640, H = 190, L = 44, Rr = 16, T = 12, B = 24;
    var pts = [{ r: 0 }].concat(eq), lo = 0, hi = 0;
    pts.forEach(function (p) { if (p.r < lo) lo = p.r; if (p.r > hi) hi = p.r; });
    if (hi - lo < 2) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    var X = function (i) { return L + (pts.length > 1 ? i / (pts.length - 1) : 0) * (W - L - Rr); };
    var Y = function (r) { return T + (hi - r) / (hi - lo) * (H - T - B); };
    var step = (hi - lo) / 4 <= 1 ? 1 : (hi - lo) / 4 <= 2 ? 2 : (hi - lo) / 4 <= 5 ? 5 : 10, g = '';
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      g += '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="' + (v === 0 ? C.muted : C.line) + '" stroke-width="1"' + (v === 0 ? '' : ' stroke-dasharray="2 3"') + '/>' +
        '<text x="' + (L - 6) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="' + C.muted + '" font-family="JetBrains Mono, monospace">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' R</text>';
    }
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.r).toFixed(1); }).join(' ');
    var area = path + ' L' + X(pts.length - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1) + ' Z';
    var last = pts[pts.length - 1];
    return {
      html: '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Summe der Ergebnisse in R nach jedem abgeschlossenen Trade">' + g +
        '<path d="' + area + '" fill="' + rgba(C.accent, 0.1) + '"/>' +
        '<path d="' + path + '" fill="none" stroke="' + C.accent + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<line id="curveX" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" stroke="' + C.muted + '" stroke-width="1" visibility="hidden"/>' +
        '<circle id="curveDot" r="4.5" fill="' + C.accent + '" stroke="' + C.panel + '" stroke-width="2" cx="' + X(pts.length - 1) + '" cy="' + Y(last.r) + '"/>' +
        '<text x="' + L + '" y="' + (H - 6) + '" font-size="10" fill="' + C.muted + '" font-family="JetBrains Mono, monospace">Start</text>' +
        '<text x="' + (W - Rr) + '" y="' + (H - 6) + '" text-anchor="end" font-size="10" fill="' + C.muted + '" font-family="JetBrains Mono, monospace">Trade ' + eq.length + '</text></svg><div class="tip" id="curveTip" hidden></div>',
      W: W, H: H, X: X, Y: Y, pts: pts
    };
  }

  function bindCurve(box, cv) {
    var svg = box.querySelector('svg'), tip = $('curveTip'), dot = $('curveDot'), line = $('curveX');
    if (!svg || cv.pts.length < 2) return;
    function move(e) {
      var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * cv.W, best = 1, bd = Infinity;
      for (var i = 1; i < cv.pts.length; i++) { var d = Math.abs(cv.X(i) - x); if (d < bd) { bd = d; best = i; } }
      var p = cv.pts[best], px = cv.X(best), py = cv.Y(p.r);
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      line.setAttribute('x1', px); line.setAttribute('x2', px); line.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = 'Trade ' + best + ' · ' + A.fFull(p.t) + '<br>' + (p.trade.dir === 'long' ? 'Long ' : 'Short ') + sR(p.trade.r) + ' · Summe ' + sR(p.r);
      var left = px / cv.W * r.width, half = tip.offsetWidth / 2;
      tip.style.left = Math.max(half, Math.min(r.width - half, left)) + 'px';
      tip.style.top = (py / cv.H * r.height - 10) + 'px';
    }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', function () {
      var n = cv.pts.length - 1; tip.hidden = true; line.setAttribute('visibility', 'hidden');
      dot.setAttribute('cx', cv.X(n)); dot.setAttribute('cy', cv.Y(cv.pts[n].r));
    });
  }

  // ---------- Auswertung ----------
  function renderStudy() {
    var box = $('view-auswertung');
    if (!S.R || !S.bt) { box.innerHTML = '<p class="note">Kursdaten werden geladen …</p>'; return; }
    var st = S.bt.stats, days = daily(S.cs, S.R, S.bt), name = symName(S.market, S.symbol);
    if (!selDay || !days.some(function (d) { return d.key === selDay; })) {
      var withTrades = days.filter(function (d) { return d.trades.length; });
      selDay = (withTrades.length ? withTrades[withTrades.length - 1] : days[days.length - 1]).key;
    }
    var cv = curveSvg(S.bt.equity);
    var rrTxt = String(S.rr).replace('.', ',');

    box.innerHTML =
      '<div class="view-head"><h2>' + esc(name) + ' · ' + A.tfName(S.tf) + '</h2><p>' + days.length + ' Handelstage, ' + num(S.cs.length) + ' Kerzen, Ziel ' + rrTxt + ' R</p></div>' +
      tiles([
        [num(st.closed), 'Abgeschlossene Trades'],
        [st.closed ? num(st.winRate * 100) + ' %' : '–', 'Trefferquote'],
        [st.closed ? sR(st.sumR) : '–', 'Summe', cls(st.sumR)],
        [st.closed ? sR(st.avgR) : '–', 'Schnitt je Trade', cls(st.avgR)],
        [st.closed ? pf(st.profitFactor) : '–', 'Profit-Faktor'],
        [st.closed ? '−' + num(st.maxDD, 1) + ' R' : '–', 'Größter Rückgang'],
        [num(st.refusals), 'Abgelehnte Setups']
      ]) +
      '<div class="cols"><div class="view">' +
        '<section class="panel"><div class="panel-head"><h2>Ergebnis nach jedem Trade</h2></div>' +
          (S.bt.equity.length ? '<div class="curve" id="curve">' + cv.html + '</div>' : '<p class="insp-empty">In diesem Zeitraum wurde kein Trade abgeschlossen.</p>') + '</section>' +
        '<section class="panel"><div class="panel-head"><h2>Tage</h2></div><div class="scroll-x"><table class="grid"><thead><tr><th>Tag</th><th>Ergebnis</th><th>Trades</th><th>Abgelehnt</th><th>Setups</th><th>Ereignisse</th></tr></thead><tbody>' +
          days.slice().reverse().map(function (d) {
            return '<tr data-day="' + d.key + '" tabindex="0"' + (d.key === selDay ? ' aria-selected="true"' : '') + '><td>' + A.fDay(d.t) + '</td><td class="' + cls(d.r) + '">' + (d.closed ? sR(d.r) : '–') + '</td><td>' + d.trades.length + '</td><td>' + d.refusals.length + '</td><td>' + d.setups + '</td><td>' + num(d.events) + '</td></tr>';
          }).join('') + '</tbody></table></div></section>' +
      '</div><div class="view">' +
        '<section class="panel" id="dayPanel"></section>' +
        '<section class="panel"><div class="panel-head"><h2>Regeln des Backtests</h2></div><ul class="rules">' +
          '<li>Auslöser: Sweep, danach Strukturbruch in die Gegenrichtung mit Order Block.</li>' +
          '<li>Einstieg: Limit-Order an der Kante des Order Blocks, gültig für 30 Kerzen.</li>' +
          '<li>Stop: hinter dem Sweep-Extrem plus 0,1 ATR; mehr als 3 ATR Abstand wird abgelehnt.</li>' +
          '<li>Ziel: ' + rrTxt + '-faches Risiko. Es läuft immer nur ein Trade.</li>' +
          '<li>Treffen Stop und Ziel in derselben Kerze, zählt der Stop.</li></ul>' +
          '<p class="note" style="margin-top:8px">Ohne Gebühren und Slippage gerechnet. Wenige Tage und wenige Trades sagen wenig über die Zukunft aus.</p></section>' +
      '</div></div>';

    if (S.bt.equity.length) bindCurve($('curve'), cv);
    renderDay(days);
    Array.prototype.forEach.call(box.querySelectorAll('tr[data-day]'), function (tr) {
      var pick = function () {
        selDay = tr.dataset.day;
        Array.prototype.forEach.call(box.querySelectorAll('tr[data-day]'), function (o) { if (o === tr) o.setAttribute('aria-selected', 'true'); else o.removeAttribute('aria-selected'); });
        renderDay(days);
      };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
  }

  function renderDay(days) {
    var d = days.filter(function (x) { return x.key === selDay; })[0], box = $('dayPanel');
    if (!d) { box.innerHTML = ''; return; }
    var html = '<div class="panel-head"><h2>Tag ' + A.fDay(d.t) + '</h2><div class="seg small"><button type="button" id="dayToChart">Im Chart zeigen</button></div></div><div class="daylist">';
    if (!d.trades.length && !d.refusals.length) html += '<p class="insp-empty">An diesem Tag gab es keinen Setup-Kandidaten.</p>';
    if (d.trades.length) html += '<div class="sub-h">Trades</div>';
    d.trades.forEach(function (t, i) {
      var des = A.describe(t);
      html += '<button type="button" class="item" data-trade="' + i + '"><div class="head"><span>' + A.fTime(t.t) + ' · ' + (t.dir === 'long' ? 'Long' : 'Short') + '</span><span class="' + (t.exit != null ? cls(t.r) : '') + '">' + A.fR(t) + '</span></div>' +
        '<div class="sub">' + esc(des.chain.slice(0, 2).join(' → ')) + '</div>' +
        '<div class="sub">Einstieg ' + A.fp(t.entry) + ' · Stop ' + A.fp(t.stop) + ' · Ziel ' + A.fp(t.target) + '</div></button>';
    });
    if (d.refusals.length) html += '<div class="sub-h">Abgelehnt</div>';
    d.refusals.forEach(function (r, i) {
      html += '<button type="button" class="item refusal" data-refusal="' + i + '"><div class="head"><span>' + A.fTime(r.t) + ' · ' + (r.dir === 'long' ? 'Long' : 'Short') + '</span><span></span></div><div class="sub">' + esc(r.reason) + '</div></button>';
    });
    box.innerHTML = html + '</div>';
    $('dayToChart').addEventListener('click', function () { show('chart'); A.gotoT(d.t); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-trade]'), function (b) {
      b.addEventListener('click', function () { var t = d.trades[+b.dataset.trade]; show('chart'); A.showEvent(t, t.fill != null ? t.fill : t.i); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-refusal]'), function (b) {
      b.addEventListener('click', function () { var r = d.refusals[+b.dataset.refusal]; show('chart'); A.showEvent(r.setup, r.i); });
    });
  }

  // ---------- Übersicht ----------
  var ovToken = 0;
  async function renderOverview() {
    var box = $('view-uebersicht'), token = ++ovToken, rows = [], all = [];
    Object.keys(A.INSTRUMENTS).forEach(function (m) { A.INSTRUMENTS[m].forEach(function (x) { all.push({ market: m, symbol: x[0], name: x[1] }); }); });
    box.innerHTML = '<p class="note" id="ovLoad">Lade Instrumente …</p>';
    for (var i = 0; i < all.length; i++) {
      var ins = all[i], d = await A.fetchData(ins.market, ins.symbol);
      if (token !== ovToken || current !== 'uebersicht') return;
      if ($('ovLoad')) $('ovLoad').textContent = 'Lade Instrumente … ' + (i + 1) + ' von ' + all.length;
      if (!d) continue;
      var cs = S.tf === 5 ? d.base : Engine.aggregate(d.base, S.tf);
      var R = Engine.analyze(cs, { swing: S.swing }), bt = Engine.backtest(cs, R, { rr: S.rr });
      rows.push({ ins: ins, cs: cs, R: R, bt: bt, days: daily(cs, R, bt) });
    }
    if (!rows.length) { box.innerHTML = '<p class="note">Keine Kursdaten gefunden. Starte den Server mit „node server.js“ und lade neu.</p>'; return; }

    var tot = { days: 0, events: 0, setups: 0, closed: 0, wins: 0, sumR: 0, refusals: 0 }, keys = {};
    rows.forEach(function (r) {
      r.events = r.days.reduce(function (a, d) { return a + d.events; }, 0);
      tot.days += r.days.length; tot.events += r.events; tot.setups += r.bt.stats.setups; tot.closed += r.bt.stats.closed;
      tot.wins += r.bt.stats.wins; tot.sumR += r.bt.stats.sumR; tot.refusals += r.bt.stats.refusals;
      r.days.forEach(function (d) { keys[d.key] = d.t; });
    });
    var dayKeys = Object.keys(keys).sort();

    var html = '<div class="view-head"><h2>Alle Instrumente · ' + A.tfName(S.tf) + '</h2><p>Ziel ' + String(S.rr).replace('.', ',') + ' R, Swings ' + ({ 2: 'fein', 3: 'normal', 5: 'grob' })[S.swing] + '</p></div>' +
      tiles([
        [num(rows.length), 'Instrumente'], [num(tot.days), 'Handelstage'], [num(tot.events), 'Ereignisse'], [num(tot.setups), 'Setup-Kandidaten'],
        [num(tot.closed), 'Abgeschlossene Trades'], [num(tot.refusals), 'Abgelehnt'],
        [tot.closed ? num(tot.wins / tot.closed * 100) + ' %' : '–', 'Trefferquote'], [tot.closed ? sR(tot.sumR) : '–', 'Summe', cls(tot.sumR)]
      ]);

    html += '<section class="panel"><div class="panel-head"><h2>Ergebnis je Instrument</h2></div><div class="scroll-x"><table class="grid"><thead><tr><th>Instrument</th><th>Summe</th><th>Trades</th><th>Treffer</th><th>Profit-Faktor</th><th>Rückgang</th><th>Setups</th><th>Ereignisse</th><th>Tage</th><th>Markt</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var s = r.bt.stats;
        return '<tr data-row="' + i + '" tabindex="0"><td>' + esc(r.ins.name) + '</td><td class="' + cls(s.sumR) + '">' + (s.closed ? sR(s.sumR) : '–') + '</td><td>' + s.closed + '</td><td>' +
          (s.closed ? num(s.winRate * 100) + ' %' : '–') + '</td><td>' + (s.closed ? pf(s.profitFactor) : '–') + '</td><td>' + (s.closed ? '−' + num(s.maxDD, 1) + ' R' : '–') + '</td><td>' + s.setups + '</td><td>' + num(r.events) + '</td><td>' + r.days.length + '</td><td>' + MARKET_NAME[r.ins.market] + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

    // Abdeckung: Instrument x Tag, Farbe = Anzahl Ereignisse (je Zeile skaliert)
    html += '<section class="panel"><div class="panel-head"><h2>Abdeckung: Ereignisse je Tag</h2></div><div class="scroll-x"><div class="heat" style="grid-template-columns:max-content repeat(' + dayKeys.length + ', minmax(16px, 26px))">';
    html += '<span></span>' + dayKeys.map(function (k, i) { var d = new Date(keys[k]); return '<span class="dayh">' + (i === 0 || d.getDate() === 1 || i % 5 === 0 ? d.getDate() + '.' : '') + '</span>'; }).join('');
    rows.forEach(function (r, ri) {
      var by = {}, mx = 1; r.days.forEach(function (d) { by[d.key] = d; if (d.events > mx) mx = d.events; });
      html += '<span class="lab">' + esc(r.ins.name) + '</span>' + dayKeys.map(function (k) {
        var d = by[k]; if (!d) return '<span class="empty"></span>';
        var lab = r.ins.name + ', ' + A.fDay(d.t) + ': ' + d.events + ' Ereignisse, ' + d.trades.length + ' Trades' + (d.closed ? ', ' + sR(d.r) : '');
        return '<button type="button" data-row="' + ri + '" data-t="' + d.t + '" title="' + esc(lab) + '" aria-label="' + esc(lab) + '" style="background:' + rgba(C.accent, 0.12 + 0.88 * d.events / mx) + '"></button>';
      }).join('');
    });
    html += '</div></div><div class="legend"><span>wenig</span><i style="background:' + rgba(C.accent, 0.12) + '"></i><i style="background:' + rgba(C.accent, 0.4) + '"></i><i style="background:' + rgba(C.accent, 0.7) + '"></i><i style="background:' + C.accent + '"></i><span>viel · je Instrument skaliert · Antippen öffnet den Tag im Chart</span></div></section>' +
      '<p class="note">Jedes Instrument wird mit denselben Regeln einzeln gerechnet. Ohne Gebühren und Slippage.</p>';
    box.innerHTML = html;

    Array.prototype.forEach.call(box.querySelectorAll('tr[data-row]'), function (tr) {
      var go = function () { var r = rows[+tr.dataset.row]; A.open(r.ins.market, r.ins.symbol, null); show('auswertung'); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.heat button'), function (b) {
      b.addEventListener('click', function () { var r = rows[+b.dataset.row]; show('chart'); A.open(r.ins.market, r.ins.symbol, +b.dataset.t); });
    });
  }

  // ---------- Umschalten ----------
  function show(view) {
    if (VIEWS.indexOf(view) < 0) view = 'chart';
    current = view;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = v !== view; });
    Array.prototype.forEach.call($('nav').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
    try { if (location.hash.replace('#', '') !== view) history.replaceState(null, '', '#' + view); } catch (e) { /* ohne Hash weiter */ }
    if (view === 'chart') A.draw();
    else if (view === 'auswertung') renderStudy();
    else renderOverview();
  }
  $('nav').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) show(b.dataset.view); });
  window.addEventListener('hashchange', function () { var v = location.hash.replace('#', ''); if (v && v !== current) show(v); });
  A.onRebuild = function () { if (current === 'auswertung') renderStudy(); else if (current === 'uebersicht') renderOverview(); };

  show(location.hash.replace('#', '') || 'chart');
})();
