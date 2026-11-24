# Trading Radar

Kerzenchart mit automatischer Erkennung von Marktstruktur für Aktien, Futures und Krypto.
Stand: Stufe 1 (Chart mit Mustererkennung).

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

## Aufbau

- `public/engine.js` – Erkennung, läuft im Browser und in Node
- `public/app.js` – Chart, Ebenen, Inspector
- `lib/sources.js` – Kursdaten: Binance (Krypto), Yahoo Finance (Aktien, Futures; verzögert)
- `server.js` – liefert die Seite aus und holt die Kursdaten
- `scripts/` – Schnappschüsse, Artifact-Vorschau, Screenshots

## Geplant

- Stufe 2: Einstieg, Stop und Ziel pro Setup, Backtest, Tagesauswertung, Übersichtsseite
- Stufe 3: laufende Aktualisierung und Live-Signale

Keine Anlageberatung. Setup-Kandidaten sind nicht per Backtest geprüft.
