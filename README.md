# Trading Radar

Kerzenchart mit automatischer Erkennung von Marktstruktur für Aktien, Futures und Krypto.
Stand: Stufe 2 (Chart mit Mustererkennung, Backtest, Auswertung, Übersicht).

## Starten

```
node server.js
```

Danach http://localhost:8787 öffnen. Es werden keine Pakete und keine API-Schlüssel gebraucht (Node 18 oder neuer).

Ohne Server (z. B. als einzelne HTML-Datei) nutzt die Seite die Schnappschüsse aus `public/data/`.
Neu erzeugen: `node scripts/snapshot.js`.

## Was Stufe 1 erkennt

| Ebene | Regel |
| --- | --- |
| Struktur | Swing-Hoch/-Tief mit N Kerzen links und rechts (fein 2, normal 3, grob 5), beschriftet als HH / HL / LH / LL |
| Liquiditäts-Pools | Level über jedem Swing-Hoch (BSL) und unter jedem Swing-Tief (SSL); Level innerhalb 0,1 ATR werden zu EQH / EQL zusammengefasst |
| Sweeps | Kerze sticht durch einen Pool und schließt wieder zurück |
| Strukturbrüche | Schlusskurs jenseits des letzten Swings: BOS in Trendrichtung, MSS gegen den Trend |
| Order Blocks | letzte Gegenkerze vor einem Impuls von mindestens 1,5 ATR, der die Struktur bricht |
| Fair Value Gaps | Lücke zwischen Kerze 1 und 3 von mindestens 0,3 ATR (nicht über Handelspausen hinweg) |
| Setup-Kandidaten | Sweep und innerhalb von 30 Kerzen ein Strukturbruch in die Gegenrichtung |

Alle Regeln arbeiten nur mit abgeschlossenen Kerzen (kein Blick in die Zukunft). Die Schwellen stehen oben in `public/engine.js`.

## Stufe 2: Backtest

Aus jedem Setup-Kandidaten mit Order Block wird nach festen Regeln ein Trade:

- Einstieg: Limit-Order an der Kante des Order Blocks, gültig für 30 Kerzen
- Stop: hinter dem Sweep-Extrem plus 0,1 ATR; mehr als 3 ATR Abstand wird abgelehnt
- Ziel: festes Vielfaches des Risikos (1,5 R, 2 R oder 3 R)
- Es läuft immer nur ein Trade. Treffen Stop und Ziel in derselben Kerze, zählt der Stop.

Jeder nicht gehandelte Kandidat wird mit Begründung als Ablehnung festgehalten.
Gerechnet wird ohne Gebühren und Slippage. Ergebnisse stehen in R (Vielfache des Risikos).

Ansichten: **Chart** (Trades als Ebene), **Auswertung** (Kennzahlen, Ergebniskurve, Tage mit Trades
und Ablehnungen für ein Instrument), **Übersicht** (alle Instrumente, Abdeckung je Tag).

## Aufbau

- `public/engine.js` – Erkennung und Backtest, läuft im Browser und in Node
- `public/app.js` – Chart, Ebenen, Inspector
- `public/views.js` – Auswertung und Übersicht
- `lib/sources.js` – Kursdaten: Binance (Krypto), Yahoo Finance (Aktien, Futures; verzögert)
- `server.js` – liefert die Seite aus und holt die Kursdaten
- `scripts/` – Schnappschüsse, Artifact-Vorschau, Screenshots

## Geplant

- Stufe 3: laufende Aktualisierung und Live-Signale

Keine Anlageberatung. Der Backtest über wenige Tage ist keine belastbare Statistik.
