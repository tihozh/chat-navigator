# Chat Navigator

**English** · [Deutsch](README.de.md)

A plugin for the **Claude desktop app** (Code tab) for projects with many chats. It shows all chats of a
project as a numbered tree in a pane next to the chat and keeps the order tidy.

![Chat Navigator pane next to a chat](docs/pane.svg)

- **Tree:** areas (`01`), sub-folders (`01-02`) and chats (`01-02-03 · Title`); steering chats `NN-00`.
- **This chat:** the current chat is highlighted and its area expanded.
- **Recently active:** the last 10 chats, with their state: working, waiting for you, new.
- **To clarify:** chats without a number, in the wrong sidebar group, with a duplicate number or unused for long.
- **Search:** filters all chats by title or number while you type.
- **Review:** the areas you worked on most this week, with bars; a click shows that area's chats of the week.
- **Clean up:** lists chats unused for long and moves them to the navigator's archive area with one click
  (in the app they stay as they are).
- **Automatic numbering:** a chat started from a numbered chat gets the next free number. If a chat is in the
  wrong sidebar group, «To clarify» says where it belongs; moving it is up to you (the app does not let a
  plugin move other chats without asking).
- **Line above the prompt:** who is waiting, what is new, how many are working; a click opens the chat.
- **Status bar:** this chat's number and open items, e.g. `01-01-01 · 🟠 2 waiting · 🔵 1 new`. Optionally a
  crab 🦀 runs across it while a chat is waiting for you.
- Opens automatically in every chat of the project, not in scheduled runs and not where you closed it. Several
  projects work side by side, each with its own settings file.
- English and German user interface.
- Adapts to the pane width in three stages: standard, small (smaller text, shorter bars) and mini (dot, title
  and time per chat, icons in the header).

![Status bar with the running crab](docs/statusbar.svg)

## Installation

In a terminal session of Claude Code:

```
/plugin install chat-navigator --marketplace tihozh/chat-navigator
```

Confirm adding the marketplace with `y`, then choose the «user» scope. Without the prompt:

```bash
claude plugin marketplace add tihozh/chat-navigator
```

```bash
claude plugin install chat-navigator@chat-navigator
```

In the desktop app: + next to the prompt box → Plugins → Add marketplace (`tihozh/chat-navigator`) → Add plugin.
Then restart the app.

## Setup

Open a chat in the project folder and type:

```
/chat-navigator:setup
```

Claude reads your chats and sidebar groups, proposes areas, writes the settings file and plans numbers for the
existing chats. Titles are only renamed after your yes; until then the pane shows a preview. After that,
`/navigator` opens the pane.

## Settings

### Central file (all projects)

`~/.claude/chat-navigator/config.json`, optional. Without it, the defaults below apply.
Example: [examples/config.json](examples/config.json).

| Field | Default | Meaning |
| --- | --- | --- |
| `language` | `"en"` | Language of the user interface: `"en"` or `"de"`. |
| `statusbar` | `true` | Status bar entry on or off (coloured marks: 🟠 waiting, 🔵 new, 🟢 working). |
| `crab` | `false` | While another chat waits for you, the status bar shows only `🦀 2` (number of waiting chats) and the crab runs back and forth. |
| `band` | `"active"` | Line above the prompt: `"off"`, `"active"` (only while something waits, is new or works) or `"always"`. |
| `features` | all `true` | Parts of the pane: `search`, `week` (review), `cleanup`. Set one to `false` to hide it. |
| `settings` | see below | Defaults for all projects; a project file overrides them one by one. |

### Project files

One file per project in `~/.claude/chat-navigator/<name>.json`. Example:
[examples/project.json](examples/project.json).

| Field | Required | Meaning |
| --- | --- | --- |
| `project` | yes | Absolute path of the project folder. Chats in this folder and below belong to it; with nested projects, the longest path wins. |
| `areas` | yes | Areas with `id` (two digits), `name`, `subs` (sub-folders, `id` like `01-02`) and optionally `group`: the exact name of the sidebar group for this area. |
| `name` | no | Heading in the pane. |
| `register` | no | Planned or assigned numbers: `"01-02-03": { "session": "<id>", "title": "<old title>" }`. The navigator updates it automatically. |
| `archive` | no | Archive: `area` (default `99`) and `sessions` (ids of chats that belong there, numbered or not). «Clean up» adds to it; remove an id to bring the chat back. |
| `runs` | no | Scheduled runs: `area` (default `90`) and `patterns` (text found in their titles). |
| `settings` | no | `staleDays` (14), `recent` (10), `pollMinutes` (1), `waitingHours` (48), `autoFix` (`true`: assign numbers automatically; `false`: only report). |

Sidebar groups are shared by all projects. Without `group`, the navigator expects a group whose name starts
with the area number (e.g. `01 Planning`). If you organise several projects, give each area its own group with
`group` (e.g. `Garden · 01 Planning`).

## What the plugin does on your computer

The navigator works only locally, inside the desktop app. It sends nothing to the internet and fetches nothing
from it.

- **App services it calls itself** (without the model asking), through the app's own MCP servers:
  - `ccd_session_mgmt`: `list_sessions` and `get_session` (chats and their titles, every minute and when you
    open the pane), `list_events` (the last few messages of a recently active chat, to tell whether it waits
    for you), `set_session_title` (puts a number in front of a chat's title, only with `autoFix` on).
  - `ccd_sidebar`: `list_groups` (sidebar groups, to check that a chat is in its area's group).
  - If a service is not connected yet when a chat starts, it connects it (`mcp.connect`) and tries again.
- **Programs it starts:** only the macOS command `open` with a `claude://` link to a chat, when you click a
  chat in the pane or in the line above the prompt. Links that do not start with `claude://` are not opened.
- **Files it reads:** its settings in `~/.claude/chat-navigator/` and, when an app service returns a large
  answer as a file, that file in the app's own results folder.
- **Files it writes:** only the project files in `~/.claude/chat-navigator/`: new numbers in `register` and
  chats put away with «Clean up» in `archive`. Other keys stay as they are. It writes no build, start-up or
  instruction files.
- **Hooks:**
  - `session.start`: reads the settings, registers `/navigator` and starts a one-minute timer that refreshes
    the tree, the line above the prompt and the status bar.
  - `session.attach`: when you switch to a chat, opens the pane there or reloads it.
  - `ui.close`: notices when you close the pane yourself and keeps it closed in that chat. It passes the call
    on unchanged.
  - `command.run` (`/navigator`): opens the pane again.
  - `ui.render`: draws the pane and the line above the prompt; it changes nothing else on screen.
- **Shared store:** small markers in the app's plugin store (which chats you have seen, where the pane was
  closed, a short lock so that only one chat assigns numbers at a time).

## Requirements and limits

- Claude desktop app only: the navigator needs its services for chats and the sidebar.
- macOS: chats are opened with the system command `open`.
- The app lists at most 300 chats at once; older ones are missing from the tree. With more than 300 chats,
  the navigator does not assign numbers automatically, because older chats could be missing.
- Several chats of a project may try to assign numbers at the same time; a lock in the shared store prevents
  this in most cases but is not atomic. The register never overwrites a number that belongs to another chat.
- «Waiting for you» is an estimate: Claude's last message ends with a question.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

To try it without installing: `claude --plugin-dir <this folder>`. Once the app has loaded the plugin, it
places the API types in `.claude-plugin/types/`; then `tsc -p . --noEmit` checks the types.

| File | Contents |
| --- | --- |
| [hooks/logic.ts](hooks/logic.ts) | Pure logic without app access: titles, numbers, guard, project matching, status text. Covered by [tests/](tests/). |
| [hooks/i18n.ts](hooks/i18n.ts) | All visible texts in English and German. |
| [hooks/register.tsx](hooks/register.tsx) | Everything that works with the app: events, timer, opening automatically, reloading, settings files, app services, pane state. The plugin directory reads `$` only within one file, so this stays together. |
| [hooks/pane.tsx](hooks/pane.tsx), [hooks/band.tsx](hooks/band.tsx) | Drawing the pane and the line above the prompt, from the values and click handlers they are given. |
| [skills/setup/SKILL.md](skills/setup/SKILL.md) | Setup with `/chat-navigator:setup`. |

## License

MIT, see [LICENSE](LICENSE).
