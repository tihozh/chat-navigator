# Changelog

## 0.5.0

- User interface in English and German, switchable with `language` in `config.json` (default: English).
- Findings are stored as data and shown in the configured language.
- Line modes are now `off`, `active` and `always`; the German values `aus`, `offen` and `immer` still work.
- Code, comments, tests and documentation in English; German README in `README.de.md`.

## 0.4.0

First public release.

- Pane with all chats of a project as a numbered tree: areas, sub-folders, «this chat», «recently active», «to clarify».
- Gives sub-chats the next free number; reports missing numbers, duplicate numbers, wrong sidebar groups (with the target group) and chats unused for long.
- Opens by itself in project chats, not in scheduled runs and not where the pane was closed.
- Line above the prompt and status bar entry with waiting, new and working chats; optionally a running crab 🦀.
- Settings per project in `~/.claude/chat-navigator/<name>.json`, central defaults in `config.json`, several projects possible.
- Setup with `/chat-navigator:setup`.
