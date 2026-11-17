export type Lang = 'en' | 'de'

// A problem in a project file, shown in the configured language.
export type ConfigError =
  | { code: 'notObject' | 'noProject' | 'noAreas' | 'badAreaId' | 'badRegister' }
  | { code: 'dupArea' | 'badSubId' | 'dupSub' | 'badGroup'; area: string }
  | { code: 'badRegisterNum' | 'noSession'; num: string }

export type Sub = { id: string; name: string }

// `group`: the area's own sidebar group (exact name). Without it, a group named «NN …» is expected.
export type Area = { id: string; name: string; subs: Sub[]; group?: string }

// Validated settings of one project (from ~/.claude/chat-navigator/<name>.json).
export type Config = {
  name: string
  project: string
  areas: Area[]
  register: Record<string, { session: string; title: string }>
  archive: { area: string; sessions: string[] }
  runs: { area: string; patterns: string[] }
  settings: { staleDays: number; recent: number; pollMinutes: number; waitingHours: number; autoFix: boolean }
}

export type Chat = {
  id: string
  title: string
  group: string
  groupId: string
  isRunning: boolean
  last: string
  link: string
  parent: string
  isWaiting?: boolean
  isNew?: boolean
}

// Why the navigator did not assign a number itself.
export type ReasonCode = 'autoFixOff' | 'incomplete' | 'paneInactive' | 'locked' | 'error'
export type Reason = { code: ReasonCode; message?: string }

// Findings are stored as data and turned into text when drawn, in the configured language.
export type Finding =
  | { kind: 'noNumber'; chatId: string; title: string; reason?: Reason }
  | { kind: 'numbersFull'; chatId: string; title: string; sub: string }
  | { kind: 'missingGroup' | 'unclearGroup' | 'wrongGroup'; chatId: string; title: string; group: string }
  | { kind: 'duplicate'; chatId: string; title: string; other: string }
  | { kind: 'duplicateRegister'; chatId: string; num: string }

export type FindingKind = Finding['kind']

export type BandState = 'waiting' | 'new' | 'working'
export type BandItem = { id: string; num: string; title: string; link: string; state: BandState }

// `mode` and `lang` come from the central file and are set in the own chat only.
export type BandMode = 'off' | 'active' | 'always'
export type Band = { at: string; items: BandItem[]; mode?: BandMode; lang?: Lang }

// Parts of the pane that can be switched off in config.json.
export type Features = { search: boolean; week: boolean; cleanup: boolean }

// Central file ~/.claude/chat-navigator/config.json: applies to all projects.
// `crab`: while another chat waits, a running crab replaces the status bar text.
export type Global = { language: Lang; statusbar: boolean; crab: boolean; band: BandMode; features: Features; settings: Config['settings'] }

// One line of the weekly review: an area and its chats worked on during the last 7 days (newest first).
export type WeekRow = { area: string; name: string; chats: string[] }

// State of the pane. `config` is null while no project matches; `configError` says why.
// `fixed` holds the new titles of chats that got a number in the last pass.
export type Snapshot = {
  chats: Chat[]
  at: string
  error: string
  findings: Finding[]
  fixed: string[]
  selfId: string
  config: Config | null
  configError: string
  lang: Lang
  features: Features
}

declare module 'claude-code' {
  interface PluginState {
    'chat-navigator': {
      snapshot: Shaped<Snapshot>
      open: Shaped<string[]>
      note: string
      query: string
      band: Shaped<Band>
    }
  }
}
