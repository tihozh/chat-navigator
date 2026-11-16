# Changelog

## 0.6.1

- «Clean up» is always visible; with nothing to do it says so.

## 0.6.0

- Search: filters all chats by title or number while you type.
- Week: what happened in each area during the last 7 days.
- Clean up: moves chats unused for long to the navigator's archive area with one click.
- `features` in `config.json` switches search, week and clean up off one by one.
- The archive list now beats the number in the title, so archived numbered chats leave the tree.

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
