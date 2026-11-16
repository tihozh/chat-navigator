# Chat-Navigator

Ein Plugin für die **Claude Desktop-App** (Code-Tab), wenn ein Projekt viele Chats hat. Es zeigt alle Chats
eines Projekts als nummerierten Baum in einem Panel neben dem Chat und hält die Ordnung selbst sauber.

- **Baum:** Bereiche (`01`), Unterordner (`01-02`) und Chats (`01-02-03 · Titel`); Steuerchats `NN-00`.
- **Dieser Chat:** der aktuelle Chat ist hervorgehoben, sein Bereich aufgeklappt.
- **Zuletzt bearbeitet:** die letzten 10 Chats, mit Status: arbeitet, wartet auf dich, neu.
- **Zu klären:** Chats ohne Nummer, im falschen Ordner, mit doppelter Nummer oder lange unbenutzt.
- **Ordnet selbst:** Ein Chat, der aus einem nummerierten Chat gestartet wurde, erbt die nächste freie
  Nummer. Liegt ein Chat im falschen Seitenleisten-Ordner, sagt «Zu klären», wohin er gehört; verschieben
  tust du ihn selbst (die App lässt ein Plugin andere Chats nicht ohne Rückfrage verschieben).
- **Zeile über dem Eingabefeld:** wer wartet, was neu ist, wie viele arbeiten; ein Klick öffnet den Chat.
- **Statusleiste unten:** Nummer dieses Chats und offene Punkte, z. B. `01-01-01 · 🟠 2 wartet · 🔵 1 neu`.
- Öffnet sich in jedem Chat des Projekts von selbst, nicht in geplanten Läufen und nicht dort, wo du es
  geschlossen hast. Mehrere Projekte gehen: jedes hat seine eigene Einstellungsdatei.

## Installation

In einem Terminal-Chat von Claude Code:

```
/plugin install chat-navigator --marketplace tihozh/chat-navigator
```

Mit `y` den Marktplatz hinzufügen, dann den Bereich «user» wählen. Ohne Prompt geht es auch so:

```bash
claude plugin marketplace add tihozh/chat-navigator
```

```bash
claude plugin install chat-navigator@chat-navigator
```

In der Desktop-App: + neben dem Eingabefeld → Plugins → Marktplatz hinzufügen (`tihozh/chat-navigator`) →
Plugin hinzufügen. Danach die App neu starten.

## Einrichten

Öffne einen Chat im Projektordner und tippe:

```
/chat-navigator:setup
```

Claude liest deine Chats und Seitenleisten-Ordner, schlägt Bereiche vor, schreibt die Einstellungsdatei
und plant Nummern für die bestehenden Chats. Titel werden erst nach deinem Ja umbenannt; bis dahin zeigt
das Panel eine Vorschau. Danach öffnet `/navigator` das Panel.

## Einstellungen

### Zentrale Datei (alle Projekte)

`~/.claude/chat-navigator/config.json`, optional. Fehlt sie, gilt alles wie unten vorgegeben.
Beispiel: [examples/config.json](examples/config.json).

| Feld | Standard | Bedeutung |
| --- | --- | --- |
| `statusbar` | `true` | Eintrag in der Statusleiste unten an oder aus (farbige Zeichen: 🟠 wartet, 🔵 neu, 🟢 arbeitet). |
| `crab` | `false` | Solange ein anderer Chat auf dich wartet, steht unten statt des Texts nur `🦀 2` (Zahl der Wartenden), und der Krebs läuft hin und her. |
| `band` | `"offen"` | Zeile über dem Eingabefeld: `"aus"`, `"offen"` (nur wenn etwas wartet, neu ist oder arbeitet) oder `"immer"`. |
| `settings` | siehe unten | Vorgaben für alle Projekte; eine Projektdatei überschreibt sie einzeln. |

### Projektdateien

Eine Datei je Projekt in `~/.claude/chat-navigator/<name>.json`. Ein Beispiel liegt in
[examples/beispiel.json](examples/beispiel.json).

| Feld | Pflicht | Bedeutung |
| --- | --- | --- |
| `project` | ja | Absoluter Pfad des Projektordners. Chats in diesem Ordner und darunter gehören dazu; bei verschachtelten Projekten gewinnt der längste Pfad. |
| `areas` | ja | Bereiche mit `id` (zwei Ziffern), `name`, `subs` (Unterordner, `id` wie `01-02`) und optional `group`: der genaue Name des Seitenleisten-Ordners für diesen Bereich. |
| `name` | nein | Überschrift im Panel. |
| `register` | nein | Geplante oder vergebene Nummern: `"01-02-03": { "session": "<id>", "title": "<alter Titel>" }`. Der Navigator ergänzt es selbst. |
| `archive` | nein | Ablage: `area` (Standard `99`) und `sessions` (IDs von Chats ohne Nummer, die dorthin gehören). |
| `runs` | nein | Automatische Läufe: `area` (Standard `90`) und `patterns` (Textstücke im Titel). |
| `settings` | nein | `staleDays` (14), `recent` (10), `pollMinutes` (1), `waitingHours` (48), `autoFix` (`true`: Nummern selbst vergeben; `false`: nur melden). |

Seitenleisten-Ordner gelten für alle Projekte gemeinsam. Ohne `group` erwartet der Navigator einen Ordner,
der mit der Bereichsnummer beginnt (z. B. `01 Planung`). Wer mehrere Projekte ordnet, gibt jedem Bereich
mit `group` einen eigenen Ordner (z. B. `Garten · 01 Planung`).

## Voraussetzungen und Grenzen

- Nur in der Claude Desktop-App: Der Navigator braucht deren Dienste für Chats und Seitenleiste.
- macOS: Chats werden mit dem Systembefehl `open` geöffnet.
- Mehrere Chats eines Projekts können gleichzeitig ordnen; eine Sperre im gemeinsamen Speicher verhindert das
  meist, ist aber nicht atomar. Das Register überschreibt nie eine Nummer, die schon einem anderen Chat gehört.
- Bei mehr als 300 Chats vergibt der Navigator keine Nummern selbst, weil ältere Chats fehlen könnten.
- Die App liefert höchstens 300 Chats auf einmal; ältere fehlen im Baum.
- «Wartet auf dich» ist eine Schätzung: der letzte Beitrag von Claude endet mit einer Frage.

## Entwicklung

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Zum Ausprobieren ohne Installation: `claude --plugin-dir <dieser Ordner>`. Sobald die App das Plugin einmal
geladen hat, legt sie die Typen unter `.claude-plugin/types/` ab; dann prüft `tsc -p . --noEmit` die Typen.

| Datei | Inhalt |
| --- | --- |
| [hooks/logic.ts](hooks/logic.ts) | Reine Logik ohne App-Zugriff: Titel, Nummern, Wächter, Projektwahl, Statustext. In [tests/](tests/) abgedeckt. |
| [hooks/register.tsx](hooks/register.tsx) | Verdrahtung: Ereignisse, Takt, automatisches Öffnen, Neuladen. |
| [hooks/config.ts](hooks/config.ts) | Einstellungsdateien finden, lesen und das Register ergänzen. |
| [hooks/app.ts](hooks/app.ts) | Aufrufe an die Dienste der Desktop-App. |
| [hooks/state.ts](hooks/state.ts) | Zustand des Panels und Merker je Projekt. |
| [hooks/pane.tsx](hooks/pane.tsx), [hooks/band.tsx](hooks/band.tsx) | Panel und Zeile über dem Eingabefeld. |
| [skills/setup/SKILL.md](skills/setup/SKILL.md) | Einrichtung mit `/chat-navigator:setup`. |

## Lizenz

MIT, siehe [LICENSE](LICENSE).
