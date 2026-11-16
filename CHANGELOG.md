# Änderungen

## 0.4.0

Erste öffentliche Fassung.

- Panel mit allen Chats eines Projekts als nummerierter Baum: Bereiche, Unterordner, «Dieser Chat», «Zuletzt bearbeitet», «Zu klären».
- Vergibt Unterchats die nächste freie Nummer; meldet fehlende Nummern, doppelte Nummern, falsche Seitenleisten-Ordner (mit Zielordner) und lange unbenutzte Chats.
- Öffnet sich in Projektchats von selbst, nicht in geplanten Läufen und nicht, wo das Panel geschlossen wurde.
- Zeile über dem Eingabefeld und Eintrag in der Statusleiste mit wartenden, neuen und arbeitenden Chats; optional ein laufender Krebs 🦀.
- Einstellungen je Projekt in `~/.claude/chat-navigator/<name>.json`, zentrale Vorgaben in `config.json`, mehrere Projekte möglich.
- Einrichtung mit `/chat-navigator:setup`.
