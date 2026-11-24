/*
 * Trading Radar – Erkennungs-Engine und Backtest
 *
 * Reine Funktionen ohne Abhängigkeiten, laufen im Browser und in Node.
 * Jede Erkennung ist "kausal": ein Ereignis bei Kerze j benutzt nur Kerzen <= j.
 * Kerzenformat: { t (ms), o, h, l, c, v }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function atr(cs, len) {
    len = len || 14;
    var out = new Array(cs.length), prev = null, sum = 0;
    for (var i = 0; i < cs.length; i++) {
      var b = cs[i];
      var tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - cs[i - 1].c), Math.abs(b.l - cs[i - 1].c));
      if (i < len) { sum += tr; prev = sum / (i + 1); }
      else prev = (prev * (len - 1) + tr) / len;
      out[i] = prev;
    }
    return out;
  }

  /** Fasst Kerzen zu einem größeren Zeitrahmen zusammen (Minuten). */
  function aggregate(cs, minutes) {
    var ms = minutes * 60000, out = [], cur = null, key = null;
    for (var i = 0; i < cs.length; i++) {
      var b = cs[i], k = Math.floor(b.t / ms);
      if (k !== key) {
        cur = { t: k * ms, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
        out.push(cur); key = k;
      } else {
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
        cur.c = b.c; cur.v += b.v || 0;
      }
    }
    return out;
  }

  function analyze(cs, opt) {
    opt = opt || {};
    var N = opt.swing || 3;                 // Kerzen links/rechts für ein Swing-Hoch/-Tief
    var EQ_TOL = opt.eqTol || 0.1;          // Gleichstand-Toleranz in ATR
    var FVG_MIN = opt.fvgMin || 0.3;        // Mindestgröße einer Lücke in ATR
    var OB_DISP = opt.obDisp || 1.5;        // Mindest-Impuls für einen Order Block in ATR
    var SETUP_WIN = opt.setupWindow || 30;  // Kerzen zwischen Sweep und Strukturbruch

    var n = cs.length, A = atr(cs, 14);
    // übliche Kerzenlänge, um Lücken über Handelspausen (Nacht, Wochenende) zu erkennen
    var step = Infinity;
    for (var s0 = 1; s0 < Math.min(n, 60); s0++) step = Math.min(step, cs[s0].t - cs[s0 - 1].t);
    var R = { swings: [], pools: [], sweeps: [], breaks: [], obs: [], fvgs: [], setups: [], atr: A };
    var trend = 0, lastH = null, lastL = null;
    var livePools = [], openFvg = [], openOb = [], recentSweeps = [];
    var id = 0;

    for (var j = 0; j < n; j++) {
      var b = cs[j], a = A[j] || (b.h - b.l) || 1e-9, q, k;

      // 1) Liquidität: wird ein offener Pool von dieser Kerze geholt?
      var hitUp = [], hitDn = [];
      for (q = livePools.length - 1; q >= 0; q--) {
        var p = livePools[q];
        if (p.side === 'BSL' ? b.h > p.price : b.l < p.price) {
          p.end = j;
          p.status = (p.side === 'BSL' ? b.c < p.price : b.c > p.price) ? 'swept' : 'run';
          (p.side === 'BSL' ? hitUp : hitDn).push(p);
          livePools.splice(q, 1);
        }
      }
      [hitUp, hitDn].forEach(function (hits) {
        var swept = hits.filter(function (x) { return x.status === 'swept'; });
        if (!swept.length) return;
        var side = swept[0].side;
        var level = side === 'BSL'
          ? Math.max.apply(null, swept.map(function (x) { return x.price; }))
          : Math.min.apply(null, swept.map(function (x) { return x.price; }));
        var sw = {
          id: 'sw' + (id++), kind: 'sweep', side: side, i: j, t: b.t, price: level,
          extreme: side === 'BSL' ? b.h : b.l,
          depth: Math.abs((side === 'BSL' ? b.h : b.l) - level) / a,
          pools: swept, used: false
        };
        R.sweeps.push(sw); recentSweeps.push(sw);
      });

      // 2) Lebenszyklus offener Zonen
      for (q = openFvg.length - 1; q >= 0; q--) {
        var f = openFvg[q];
        if (f.dir === 'bull') {
          if (b.l <= f.top && f.touchedAt == null) f.touchedAt = j;
          if (b.l <= f.bottom) { f.end = j; f.status = b.c < f.bottom ? 'inverted' : 'filled'; openFvg.splice(q, 1); }
        } else {
          if (b.h >= f.bottom && f.touchedAt == null) f.touchedAt = j;
          if (b.h >= f.top) { f.end = j; f.status = b.c > f.top ? 'inverted' : 'filled'; openFvg.splice(q, 1); }
        }
      }
      for (q = openOb.length - 1; q >= 0; q--) {
        var o = openOb[q];
        if (o.dir === 'bull') {
          if (b.c < o.bottom) { o.end = j; o.status = 'invalidated'; openOb.splice(q, 1); }
          else if (b.l <= o.top && o.mitigatedAt == null) { o.mitigatedAt = j; o.status = 'mitigated'; }
        } else {
          if (b.c > o.top) { o.end = j; o.status = 'invalidated'; openOb.splice(q, 1); }
          else if (b.h >= o.bottom && o.mitigatedAt == null) { o.mitigatedAt = j; o.status = 'mitigated'; }
        }
      }

      // 3) Swing bei Kerze pv = j - N wird jetzt bestätigt
      var pv = j - N;
      if (pv - N >= 0) {
        var isH = true, isL = true, c0 = cs[pv];
        for (k = 1; k <= N; k++) {
          if (!(c0.h > cs[pv - k].h) || !(c0.h >= cs[pv + k].h)) isH = false;
          if (!(c0.l < cs[pv - k].l) || !(c0.l <= cs[pv + k].l)) isL = false;
        }
        if (isH) addPivot('H', pv, c0.h, j, a);
        if (isL) addPivot('L', pv, c0.l, j, a);
      }

      // 4) Strukturbruch: Schlusskurs über letztem Swing-Hoch / unter letztem Swing-Tief
      var brk = null;
      if (lastH && !lastH.broken && b.c > lastH.price) brk = makeBreak('up', lastH, j, a);
      else if (lastL && !lastL.broken && b.c < lastL.price) brk = makeBreak('down', lastL, j, a);

      // 5) Fair Value Gap aus drei Kerzen
      if (j >= 2 && cs[j].t - cs[j - 2].t <= step * 3) {
        var c2 = cs[j - 2], g = null;
        if (b.l > c2.h && (b.l - c2.h) >= FVG_MIN * a) {
          g = { id: 'fvg' + (id++), kind: 'fvg', dir: 'bull', i: j - 1, t: cs[j - 1].t, createdAt: j, top: b.l, bottom: c2.h, size: (b.l - c2.h) / a, status: 'open', end: null, touchedAt: null };
        } else if (b.h < c2.l && (c2.l - b.h) >= FVG_MIN * a) {
          g = { id: 'fvg' + (id++), kind: 'fvg', dir: 'bear', i: j - 1, t: cs[j - 1].t, createdAt: j, top: c2.l, bottom: b.h, size: (c2.l - b.h) / a, status: 'open', end: null, touchedAt: null };
        }
        if (g) { R.fvgs.push(g); openFvg.push(g); }
      }

      // 6) Setup-Kandidat: Sweep, danach Strukturbruch in die Gegenrichtung
      if (brk) {
        var want = brk.dir === 'up' ? 'SSL' : 'BSL';
        for (q = recentSweeps.length - 1; q >= 0; q--) {
          var s = recentSweeps[q];
          if (j - s.i > SETUP_WIN) break;
          if (s.side === want && !s.used && s.i <= j) {
            s.used = true;
            R.setups.push({
              id: 'su' + (id++), kind: 'setup', dir: brk.dir === 'up' ? 'long' : 'short',
              i: j, t: b.t, price: b.c, sweep: s, brk: brk, ob: brk.ob || null, bars: j - s.i
            });
            break;
          }
        }
        while (recentSweeps.length && j - recentSweeps[0].i > SETUP_WIN) recentSweeps.shift();
      }
    }

    function addPivot(type, i, price, confirmedAt, a) {
      // Pool: über jedem Swing-Hoch liegt Buy-Side-, unter jedem Swing-Tief Sell-Side-Liquidität
      var side = type === 'H' ? 'BSL' : 'SSL', merged = false;
      for (var q = 0; q < livePools.length; q++) {
        var p = livePools[q];
        if (p.side === side && Math.abs(p.price - price) <= EQ_TOL * a) {
          p.equal = true; p.touches++; p.pivots.push(i);
          p.price = side === 'BSL' ? Math.max(p.price, price) : Math.min(p.price, price);
          merged = true; break;
        }
      }
      if (!merged) {
        var np = { id: 'pl' + (id++), kind: 'pool', side: side, equal: false, touches: 1, pivots: [i], i: i, t: cs[i].t, price: price, confirmedAt: confirmedAt, end: null, status: 'live' };
        R.pools.push(np); livePools.push(np);
      }

      // Struktur: Hochs und Tiefs wechseln sich ab; bei zwei gleichen in Folge zählt das extremere
      var last = R.swings[R.swings.length - 1], sw;
      if (last && last.type === type) {
        if (type === 'H' ? price > last.price : price < last.price) {
          last.i = i; last.t = cs[i].t; last.price = price; last.confirmedAt = confirmedAt; last.broken = false;
          sw = last;
        } else return;
      } else {
        sw = { id: 'sg' + (id++), kind: 'swing', type: type, i: i, t: cs[i].t, price: price, confirmedAt: confirmedAt, broken: false, label: '' };
        R.swings.push(sw);
      }
      var prevSame = null;
      for (var z = R.swings.length - 2; z >= 0; z--) if (R.swings[z].type === type) { prevSame = R.swings[z]; break; }
      if (type === 'H') { sw.label = !prevSame ? 'H' : (price > prevSame.price ? 'HH' : 'LH'); lastH = sw; }
      else { sw.label = !prevSame ? 'L' : (price > prevSame.price ? 'HL' : 'LL'); lastL = sw; }
    }

    function makeBreak(dir, sw, j, a) {
      var b = cs[j];
      sw.broken = true;
      var type = (dir === 'up' && trend === -1) || (dir === 'down' && trend === 1) ? 'MSS' : 'BOS';
      trend = dir === 'up' ? 1 : -1;
      var brk = { id: 'bk' + (id++), kind: 'break', type: type, dir: dir, i: j, t: b.t, from: sw.i, price: sw.price, ob: null, disp: 0 };

      // Ursprung der Bewegung = Extrem zwischen dem gebrochenen Swing und dem Bruch
      var m = j, k;
      for (k = sw.i + 1; k <= j; k++) {
        if (dir === 'up' ? cs[k].l < cs[m].l : cs[k].h > cs[m].h) m = k;
      }
      brk.disp = Math.abs(b.c - (dir === 'up' ? cs[m].l : cs[m].h)) / a;
      brk.origin = m;

      // Order Block = letzte Gegenkerze vor dem Impuls
      if (brk.disp >= OB_DISP) {
        var ok = -1;
        for (k = m; k >= Math.max(0, m - 4); k--) {
          if (dir === 'up' ? cs[k].c < cs[k].o : cs[k].c > cs[k].o) { ok = k; break; }
        }
        if (ok < 0) ok = m;
        if (ok < j) {
          var ob = { id: 'ob' + (id++), kind: 'ob', dir: dir === 'up' ? 'bull' : 'bear', i: ok, t: cs[ok].t, createdAt: j, top: cs[ok].h, bottom: cs[ok].l, disp: brk.disp, status: 'live', mitigatedAt: null, end: null, brk: brk };
          brk.ob = ob; R.obs.push(ob); openOb.push(ob);
        }
      }
      R.breaks.push(brk);
      return brk;
    }

    return R;
  }

  /**
   * Stufe 2: macht aus Setup-Kandidaten regelbasierte Trades.
   *   Einstieg  Limit-Order an der Kante des Order Blocks (Rücklauf nach dem Bruch)
   *   Stop      hinter Sweep-Extrem bzw. Order Block, plus Puffer
   *   Ziel      festes Vielfaches des Risikos (rr)
   * Es läuft immer nur ein Trade gleichzeitig. Jeder nicht gehandelte
   * Kandidat wird mit Begründung als Ablehnung festgehalten.
   */
  function backtest(cs, R, opt) {
    opt = opt || {};
    var RR = opt.rr || 2, WAIT = opt.wait || 30, MAXSTOP = opt.maxStop || 3, BUF = opt.buffer || 0.1;
    var A = R.atr, n = cs.length, trades = [], refusals = [], busyUntil = -1;

    R.setups.forEach(function (s) {
      var j = s.i, a = A[j] || 1e-9, long = s.dir === 'long', k;
      function refuse(reason) { refusals.push({ id: 'rf' + s.id, kind: 'refusal', setup: s, i: j, t: s.t, dir: s.dir, reason: reason }); }
      if (!s.ob) return refuse('Kein Order Block, der Impuls war zu schwach');
      if (j <= busyUntil) return refuse('Es lief bereits ein Trade');
      var entry = long ? s.ob.top : s.ob.bottom;
      var stop = long ? Math.min(s.sweep.extreme, s.ob.bottom) - BUF * a : Math.max(s.sweep.extreme, s.ob.top) + BUF * a;
      var risk = Math.abs(entry - stop);
      if (risk > MAXSTOP * a) return refuse('Stop zu weit entfernt (' + (risk / a).toFixed(1) + ' ATR)');
      var target = long ? entry + RR * risk : entry - RR * risk;

      var fill = -1, last = Math.min(n - 1, j + WAIT);
      for (k = j + 1; k <= last; k++) {
        if (long ? cs[k].l <= entry : cs[k].h >= entry) { fill = k; break; }
        if (long ? cs[k].h >= target : cs[k].l <= target) return refuse('Ziel ohne Rücklauf zum Order Block erreicht');
      }
      var tr = { id: 'tr' + s.id, kind: 'trade', dir: s.dir, setup: s, i: j, t: s.t, entry: entry, stop: stop, target: target,
        risk: risk, riskAtr: risk / a, rr: RR, fill: null, exit: null, exitPrice: null, status: 'pending', r: 0 };
      if (fill < 0) {
        if (j + WAIT <= n - 1) return refuse('Kein Rücklauf innerhalb von ' + WAIT + ' Kerzen');
        trades.push(tr); busyUntil = n; return;        // Order wartet noch am Datenende
      }
      // Einstieg: bei einer Kurslücke über das Level hinweg zum Eröffnungskurs
      var b0 = cs[fill];
      if (long ? b0.o < entry : b0.o > entry) tr.entry = entry = b0.o;
      tr.fill = fill; tr.status = 'open';
      for (k = fill; k < n; k++) {
        var b = cs[k];
        if (k > fill && (long ? b.o <= stop : b.o >= stop)) { close(tr, k, b.o, 'loss'); break; }
        if (long ? b.l <= stop : b.h >= stop) { close(tr, k, stop, 'loss'); break; }      // im Zweifel zuerst der Stop
        if (k > fill && (long ? b.h >= target : b.l <= target)) { close(tr, k, target, 'win'); break; }
      }
      if (tr.status === 'open') tr.r = (long ? cs[n - 1].c - entry : entry - cs[n - 1].c) / risk;
      trades.push(tr);
      busyUntil = tr.exit == null ? n : tr.exit;
    });

    function close(tr, k, price, status) {
      tr.exit = k; tr.exitPrice = price; tr.status = status;
      tr.r = (tr.dir === 'long' ? price - tr.entry : tr.entry - price) / tr.risk;
    }

    // Kennzahlen über abgeschlossene Trades, in Vielfachen des Risikos (R)
    var closed = trades.filter(function (t) { return t.exit != null; }).sort(function (x, y) { return x.exit - y.exit; });
    var sum = 0, peak = 0, dd = 0, gw = 0, gl = 0, wins = 0, equity = [];
    closed.forEach(function (t) {
      sum += t.r; if (t.r > 0) { wins++; gw += t.r; } else gl -= t.r;
      if (sum > peak) peak = sum; if (peak - sum > dd) dd = peak - sum;
      equity.push({ i: t.exit, t: cs[t.exit].t, r: sum, trade: t });
    });
    return {
      trades: trades, refusals: refusals, equity: equity,
      stats: { closed: closed.length, wins: wins, losses: closed.length - wins, winRate: closed.length ? wins / closed.length : 0,
        sumR: sum, avgR: closed.length ? sum / closed.length : 0, profitFactor: gl ? gw / gl : (gw ? Infinity : 0), maxDD: dd,
        open: trades.length - closed.length, refusals: refusals.length, setups: R.setups.length }
    };
  }

  return { atr: atr, aggregate: aggregate, analyze: analyze, backtest: backtest };
});
