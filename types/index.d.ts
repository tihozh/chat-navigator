export type Sub = { id: string; name: string }

// `group`: eigener Seitenleisten-Ordner dieses Bereichs (genauer Name). Ohne: ein Ordner «NN …».
export type Area = { id: string; name: string; subs: Sub[]; group?: string }

// Geprüfte Einstellungen eines Projekts (aus ~/.claude/chat-navigator/<name>.json).
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

export type Finding = { kind: string; text: string; chatId: string }

export type BandItem = { id: string; num: string; title: string; link: string; state: 'wartet' | 'neu' | 'arbeitet' }

// `mode`: wann die Zeile über dem Eingabefeld erscheint (aus der zentralen Datei; nur im eigenen Chat gesetzt).
export type BandMode = 'aus' | 'offen' | 'immer'
export type Band = { at: string; items: BandItem[]; mode?: BandMode }

// Zentrale Datei ~/.claude/chat-navigator/config.json: gilt für alle Projekte.
// `crab`: ein Krebs läuft über die Statusleiste, solange jemand wartet.
export type Global = { statusbar: boolean; crab: boolean; band: BandMode; settings: Config['settings'] }

// Stand des Panels. `config` ist null, solange kein Projekt passt; `configError` sagt dann warum.
export type Snapshot = {
  chats: Chat[]
  at: string
  error: string
  findings: Finding[]
  fixed: string[]
  selfId: string
  config: Config | null
  configError: string
}

declare module 'claude-code' {
  interface PluginState {
    'chat-navigator': {
      snapshot: Shaped<Snapshot>
      open: Shaped<string[]>
      note: string
      band: Shaped<Band>
    }
  }
}
