# Changelog

## 0.9.1

- For the plugin directory: the call that reads the current chat has a plainer name; the icon is stored
  smaller and without metadata.

## 0.9.0

- Ready for the plugin directory: everything that works with the app is in `hooks/register.tsx`; the pane and
  the line above the prompt only draw. No change in what you see.
- README: new section on what the plugin does on your computer (app services, programs, files, hooks).
- New icon.

## 0.8.4

- Times stay visible in the mini pane too; small below 50 columns, mini below 32.

## 0.8.3

- Times, states and counts never wrap; the title in front is cut instead. Smaller text from 115 columns down.

## 0.8.2

- Text gets smaller below 90 columns, before the layout changes; titles are cut with «…» instead of wrapping.

## 0.8.1

- The pane switches later: small below 60 columns, mini below 40.

## 0.8.0

- Three width stages: standard (90 columns and more), small (55–89: smaller text, short bars, tight spacing) and mini (below 55: dot and title per chat, icons in the header, no bars, no legend).

## 0.7.1

- Narrow panes: smaller text below 90 columns, shorter bars, no bars below 70; header buttons wrap; review rows keep their columns.

## 0.7.0

- «Week» becomes «Review»: the areas worked on most this week, sorted, with bars; a click opens the area's chats of the week.

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
