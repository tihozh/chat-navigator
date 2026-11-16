// Reine Logik des Chat-Navigators: kein Zugriff auf die App, darum direkt testbar.
// Alles, was Zeit braucht, bekommt `now` (Millisekunden) als Argument.

import type { Area, BandItem, BandMode, Chat, Config, Finding, Global } from '../types'

// ---------- Titel und Nummern ----------

// «06-04-01 · Titel» → Nummer, Bereich, Unterordner, Resttitel
const NUM = /^(\d{2})(?:-(\d{2}))?(?:-(\d{2}))?\s*·\s*(.*)$/

export type Parsed = { num: string; area: string; sub: string; rest: string }

export function parse(title: string): Parsed | null {
  const m = NUM.exec(title)
  if (!m) return null
  const area = m[1] ?? ''
  const sub = m[2] ? `${area}-${m[2]}` : ''
  const num = [m[1], m[2], m[3]].filter(Boolean).join('-')
  return { num, area, sub, rest: m[4] ?? '' }
}

// Seitenleisten-Ordner «06 Name» → «06»
export function groupArea(group: string): string {
  const m = /^(\d{2})\s/.exec(group)
  return m ? (m[1] ?? '') : ''
}

// Steuerchat: «06», «06-00» oder «06-04-00»
export function isSteering(num: string): boolean {
  return /^\d{2}(-00)?$/.test(num) || /-00$/.test(num)
}

// Bereich eines Chats: Nummer im Titel, sonst Ablage, Lauf-Muster oder Ordner.
export function areaOf(cfg: Config | null, c: Pick<Chat, 'id' | 'title' | 'group'>): string {
  const p = parse(c.title)
  if (p) return p.area
  if (cfg?.archive.sessions.includes(c.id)) return cfg.archive.area
  if (cfg && isRun(cfg, c.title)) return cfg.runs.area
  const named = cfg?.areas.find(a => a.group !== undefined && a.group === c.group)
  return named ? named.id : groupArea(c.group)
}

// Liegt der Chat im Seitenleisten-Ordner seines Bereichs? Mit `group` in den Einstellungen zählt
// genau dieser Ordnername, sonst ein Ordner «NN …».
export function inAreaGroup(cfg: Config, c: Pick<Chat, 'group'>, area: string): boolean {
  const a = cfg.areas.find(x => x.id === area)
  return a?.group !== undefined ? c.group === a.group : groupArea(c.group) === area
}

export function isRun(cfg: Config, title: string): boolean {
  return cfg.runs.patterns.some(t => t !== '' && title.includes(t))
}

// Bereiche für Ablage und Läufe: dort braucht ein Chat keine Nummer.
export function isSpecialArea(cfg: Config, area: string): boolean {
  return area === cfg.archive.area || area === cfg.runs.area
}

// Nächste freie Nummer in einem Unterordner, aus Register und Titeln; '' wenn 99 erreicht ist.
export function nextNumber(register: Config['register'], chats: Pick<Chat, 'title'>[], sub: string): string {
  let max = 0
  const take = (num: string) => {
    if (!num.startsWith(`${sub}-`)) return
    const rest = num.slice(sub.length + 1)
    if (/^\d{2}$/.test(rest)) max = Math.max(max, Number(rest))
  }
  Object.keys(register).forEach(take)
  for (const c of chats) {
    const p = parse(c.title)
    if (p) take(p.num)
  }
  return max >= 99 ? '' : `${sub}-${String(max + 1).padStart(2, '0')}`
}

// ---------- Projekt erkennen ----------

// Absoluten Pfad bereinigen: doppelte «/», «.» und «..» auflösen, kein «/» am Ende.
export function normalizePath(p: string): string {
  if (!p.startsWith('/')) return p
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

function trimSlash(p: string): string {
  return normalizePath(p)
}

// Gehört der Ordner zum Projekt? Absoluter Pfad: der Ordner selbst oder darunter.
// Blosser Name (alte Form): ein ganzer Ordnername im Pfad, nicht «Projekt-alt».
export function inProjectPath(cwd: string, project: string): boolean {
  if (project === '' || cwd === '') return false
  if (project.startsWith('/')) {
    const root = trimSlash(project)
    const dir = trimSlash(cwd)
    return dir === root || dir.startsWith(root === '/' ? '/' : `${root}/`)
  }
  return cwd.split('/').includes(project)
}

// Wie genau passt ein Projekt? Längerer absoluter Pfad gewinnt; ein blosser Name zählt am wenigsten.
function matchScore(cwd: string, project: string): number {
  if (!inProjectPath(cwd, project)) return -1
  return project.startsWith('/') ? 1 + trimSlash(project).length : 0
}

// Gehört ein Ordner zu diesem Projekt und nicht zu einem genauer passenden anderen?
export function ownsPath(cwd: string, project: string, allProjects: string[]): boolean {
  const own = matchScore(cwd, project)
  return own >= 0 && allProjects.every(p => p === project || matchScore(cwd, p) <= own)
}

// Das passende Projekt für einen Ordner, oder null.
export function pickProject<T extends { cfg: Config }>(cwd: string, projects: T[]): T | null {
  let best: T | null = null
  let bestScore = -1
  for (const p of projects) {
    const s = matchScore(cwd, p.cfg.project)
    if (s > bestScore) {
      best = p
      bestScore = s
    }
  }
  return best
}

// ---------- Einstellungen prüfen ----------

export const DEFAULTS: Config['settings'] = { staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const posNum = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)

// `settings` aus einer Datei über Vorgaben legen; Unbrauchbares fällt auf die Vorgabe zurück.
function mergeSettings(v: unknown, base: Config['settings']): Config['settings'] {
  const s = isObj(v) ? v : {}
  return {
    staleDays: posNum(s.staleDays, base.staleDays),
    recent: Math.round(posNum(s.recent, base.recent)),
    pollMinutes: posNum(s.pollMinutes, base.pollMinutes),
    waitingHours: posNum(s.waitingHours, base.waitingHours),
    autoFix: typeof s.autoFix === 'boolean' ? s.autoFix : base.autoFix,
  }
}

// Zentrale Datei config.json → Einstellungen für alle Projekte. Fehlt sie, gilt alles wie vorgegeben.
export const BAND_MODES: BandMode[] = ['aus', 'offen', 'immer']
export function normalizeGlobal(raw: unknown): Global {
  const g = isObj(raw) ? raw : {}
  return {
    statusbar: g.statusbar !== false,
    crab: g.crab === true,
    band: BAND_MODES.includes(g.band as BandMode) ? (g.band as BandMode) : 'offen',
    settings: mergeSettings(g.settings, DEFAULTS),
  }
}

// Rohdaten aus der Datei → geprüfte Einstellungen. Alte Schlüssel `ablage` und `laeufe` gelten weiter.
// `base`: Vorgaben aus der zentralen Datei; die Projektdatei überschreibt sie einzeln.
export function normalizeConfig(raw: unknown, base: Config['settings'] = DEFAULTS): { cfg: Config } | { error: string } {
  if (!isObj(raw)) return { error: 'kein JSON-Objekt' }
  if (typeof raw.project !== 'string' || raw.project === '') return { error: '«project» fehlt' }
  if (!Array.isArray(raw.areas)) return { error: '«areas» fehlt' }
  const areas: Area[] = []
  for (const a of raw.areas) {
    if (!isObj(a) || typeof a.id !== 'string' || !/^\d{2}$/.test(a.id)) return { error: 'ein Bereich hat keine gültige «id» (zwei Ziffern)' }
    const subs = Array.isArray(a.subs) ? a.subs : []
    if (areas.some(x => x.id === a.id)) return { error: `Bereich ${a.id} kommt doppelt vor` }
    const okSubs = subs.every(s => isObj(s) && typeof s.id === 'string' && new RegExp(`^${a.id}-\\d{2}$`).test(s.id))
    if (!okSubs) return { error: `Bereich ${a.id}: ein Unterordner hat keine gültige «id» (${a.id}-NN)` }
    const subIds = subs.map(s => String((s as Record<string, unknown>).id))
    if (new Set(subIds).size !== subIds.length) return { error: `Bereich ${a.id}: ein Unterordner kommt doppelt vor` }
    if (a.group !== undefined && (typeof a.group !== 'string' || a.group === '')) return { error: `Bereich ${a.id}: «group» ist kein Ordnername` }
    areas.push({
      ...(typeof a.group === 'string' ? { group: a.group } : {}),
      id: a.id,
      name: typeof a.name === 'string' ? a.name : a.id,
      subs: subs.map(s => {
        const o = s as Record<string, unknown>
        return { id: String(o.id), name: typeof o.name === 'string' ? o.name : String(o.id) }
      }),
    })
  }
  const reg = raw.register ?? {}
  if (!isObj(reg)) return { error: '«register» ist kein Objekt' }
  const register: Config['register'] = {}
  for (const [num, v] of Object.entries(reg)) {
    if (!/^\d{2}(-\d{2}){0,2}$/.test(num)) return { error: `Register: «${num}» ist keine Nummer (NN-SS-CC)` }
    if (!isObj(v) || typeof v.session !== 'string') return { error: `Register ${num}: «session» fehlt` }
    register[num] = { session: v.session, title: typeof v.title === 'string' ? v.title : '' }
  }
  const archive = isObj(raw.archive) ? raw.archive : {}
  const runs = isObj(raw.runs) ? raw.runs : {}
  return {
    cfg: {
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : 'Chats',
      project: raw.project,
      areas,
      register,
      archive: {
        area: typeof archive.area === 'string' ? archive.area : '99',
        sessions: [...strList(archive.sessions), ...strList(raw.ablage)],
      },
      runs: {
        area: typeof runs.area === 'string' ? runs.area : '90',
        patterns: [...strList(runs.patterns), ...strList(raw.laeufe)],
      },
      settings: mergeSettings(raw.settings, base),
    },
  }
}

// ---------- Wächter: Befunde und sichere Aufräumschritte ----------

// Einziger Schritt, den der Wächter selbst ausführt: eine Nummer vergeben.
// Verschieben in der Seitenleiste meldet er nur: die App lässt einen Mod andere Chats nicht ohne Rückfrage verschieben.
export type Action = { kind: 'rename'; chatId: string; num: string; title: string; original: string }

export type Group = { id: string; name: string }

// Plant, was der Wächter selbst ordnet, und sammelt, was zu klären bleibt.
// Ein Schritt, der später scheitert, wird zum Befund (siehe `failedFinding`).
export function planGuard(cfg: Config, chats: Chat[], groups: Group[], now: number): { findings: Finding[]; actions: Action[] } {
  const findings: Finding[] = []
  const actions: Action[] = []
  const byId = new Map(chats.map(c => [c.id, c]))
  const register = { ...cfg.register }
  const registered = new Set(Object.values(cfg.register).map(v => v.session))
  // Titel nach geplanten Umbenennungen, damit die folgenden Schritte damit rechnen.
  const title = new Map(chats.map(c => [c.id, c.title]))
  const view = () => chats.map(c => ({ title: title.get(c.id) ?? c.title }))

  // 1. Chat ohne Nummer, gestartet von einem nummerierten Chat in einem echten Unterordner: Nummer erben.
  for (const c of chats) {
    if (parse(c.title) || isSpecialArea(cfg, areaOf(cfg, c))) continue
    const parent = byId.get(c.parent)
    const pp = parent ? parse(title.get(parent.id) ?? parent.title) : null
    // Nur in Unterordner, die in den Einstellungen eingerichtet sind.
    const known = pp ? cfg.areas.some(a => a.subs.some(s => s.id === pp.sub)) : false
    const num = pp && known && !pp.sub.endsWith('-00') && !registered.has(c.id) ? nextNumber(register, view(), pp.sub) : null
    if (num === '') {
      findings.push({ kind: 'Nummern voll', text: `${c.title} (Unterordner ${pp?.sub} hat schon 99 Chats)`, chatId: c.id })
    } else if (num) {
      const t = `${num} · ${c.title}`
      register[num] = { session: c.id, title: c.title }
      title.set(c.id, t)
      actions.push({ kind: 'rename', chatId: c.id, num, title: t, original: c.title })
    } else {
      findings.push({ kind: 'Ohne Nummer', text: c.title, chatId: c.id })
    }
  }

  // 2. Nummer passt nicht zum Ordner: melden, wohin der Chat gehört. Unterchats (von einem anderen Chat
  // gestartet) hängt die App in der Seitenleiste unter ihren Ausgangschat; sie lassen sich nicht einzeln
  // verschieben und werden darum nicht gemeldet, auch wenn der Ausgangschat nicht in der Liste ist.
  // Hat der Bereich einen eigenen Ordner (`group`), zählt nur dieser; sonst ein Ordner «NN …».
  const ownGroups = new Set(chats.map(c => c.groupId).filter(Boolean))
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p || inAreaGroup(cfg, c, p.area) || c.parent !== '') continue
    const named = cfg.areas.find(a => a.id === p.area)?.group
    const candidates = named !== undefined ? groups.filter(x => x.name === named) : groups.filter(x => x.name.startsWith(`${p.area} `))
    // Mehrere Ordner mit gleicher Nummer (z. B. aus einem anderen Projekt): den nehmen, den dieses Projekt schon nutzt.
    const used = candidates.filter(x => ownGroups.has(x.id))
    const g = candidates.length === 1 ? candidates[0] : used.length === 1 ? used[0] : undefined
    const label = named ?? `${p.area} …`
    if (candidates.length === 0) findings.push({ kind: 'Ordner fehlt', text: `${t} (kein Ordner «${label}»)`, chatId: c.id })
    else if (!g) findings.push({ kind: 'Ordner unklar', text: `${t} (mehrere Ordner «${label}»)`, chatId: c.id })
    else findings.push({ kind: 'Falscher Ordner', text: `${t} → in «${g.name}» verschieben`, chatId: c.id })
  }

  // 3. Doppelte Nummern, auch gegen das Register.
  const seen = new Map<string, string>()
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p) continue
    const other = seen.get(p.num)
    if (other !== undefined) findings.push({ kind: 'Nummer doppelt', text: `${p.num}: «${other}» und «${t}»`, chatId: c.id })
    else seen.set(p.num, t)
    const reg = cfg.register[p.num]
    if (reg && reg.session !== c.id && byId.has(reg.session))
      findings.push({ kind: 'Nummer doppelt', text: `${p.num} ist im Register schon vergeben`, chatId: c.id })
  }

  // 4. Arbeitschats, die lange niemand benutzt hat.
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p || isSteering(p.num) || isSpecialArea(cfg, areaOf(cfg, c))) continue
    const d = daysSince(c.last, now)
    if (d > cfg.settings.staleDays) findings.push({ kind: 'Lange unbenutzt', text: `${t} (${Math.floor(d)} Tage)`, chatId: c.id })
  }

  return { findings, actions }
}

// Ein Schritt, der nicht ausgeführt wurde, als Befund; `reason` sagt warum (z. B. Fehlermeldung der App).
export function failedFinding(a: Action, reason = ''): Finding {
  const why = reason !== '' ? ` (${reason.slice(0, 120)})` : ''
  return { kind: 'Ohne Nummer', text: `${a.original}${why}`, chatId: a.chatId }
}

export function doneText(a: Action): string {
  return `Nummer vergeben: ${a.title}`
}

// ---------- Zeit ----------

export function daysSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / 86_400_000
}

export function age(iso: string, now: number): string {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 5) return 'jetzt'
  if (min < 60) return `${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} Std.`
  return `${Math.floor(h / 24)} T.`
}

// ---------- Status: wartet, neu ----------

// «Wartet auf dich»: Endet der Verlauf (Text von list_events) mit einer Frage an den Nutzer?
export function endsWithQuestion(events: string): boolean {
  const blocks = events.split(/\n(?=\[(?:assistant|user|result)\])/).map(b => b.trim()).filter(Boolean)
  // Ergebnisse von Werkzeugen zählen nicht; entscheidend ist, wer zuletzt etwas gesagt oder gefragt hat.
  const last = [...blocks].reverse().find(b => !b.startsWith('[result]')) ?? ''
  if (!last.startsWith('[assistant]')) return false
  if (/^\[assistant\] \(called /.test(last)) return /AskUserQuestion/.test(last)
  return /\?\s*$/.test(last) || /\?\s*\n/.test(last.split('\n').slice(-2).join('\n') + '\n')
}

// Merkliste «zuletzt gesehen» nachführen: neue Chats gelten als gesehen,
// ein Chat mit Aktivität seit dem letzten Blick ist «neu».
export function updateSeen(
  chats: Pick<Chat, 'id' | 'last' | 'isRunning'>[],
  seen: Record<string, string>,
  selfId: string,
  now: number,
): { seen: Record<string, string>; changed: boolean; fresh: Set<string> } {
  const next = { ...seen }
  const fresh = new Set<string>()
  let changed = false
  for (const c of chats) {
    // Der eigene Chat ist gerade offen: gilt als gesehen, damit er anderswo nicht «neu» ist.
    if (c.id === selfId) {
      if (c.last !== '' && next[c.id] !== c.last) {
        next[c.id] = c.last
        changed = true
      }
      continue
    }
    if (c.isRunning) continue
    const was = next[c.id]
    if (was === undefined) {
      next[c.id] = c.last
      changed = true
    } else if (Date.parse(c.last) - Date.parse(was) > 60_000) fresh.add(c.id)
  }
  // Nur nach 30 Tagen vergessen: die Abfrage liefert höchstens 300 Chats, ältere fehlen darin, gibt es aber noch.
  const ids = new Set(chats.map(c => c.id))
  for (const id of Object.keys(next)) {
    if (id !== selfId && !ids.has(id) && daysSince(next[id] ?? '', now) > 30) {
      delete next[id]
      changed = true
    }
  }
  return { seen: next, changed, fresh }
}

export function toBandItems(chats: Chat[]): BandItem[] {
  const items: BandItem[] = []
  for (const c of chats) {
    const state = c.isRunning ? 'arbeitet' : c.isWaiting ? 'wartet' : c.isNew ? 'neu' : null
    if (!state) continue
    const p = parse(c.title)
    items.push({ id: c.id, num: p ? p.num : '', title: p ? p.rest : c.title, link: c.link, state })
  }
  return items
}

// ---------- Ausgelagerte Antworten ----------

// Grosse Antworten legt die App als Datei in ihrem Ergebnisordner ab und antwortet nur mit dem Pfad.
// Akzeptiert wird nur ein kurzer Hinweis, der selbst kein JSON ist (also nicht eine Chatliste mit einem
// präparierten Titel), mit einer .txt-Datei direkt in einem Ordner `tool-results` unter `<home>/.claude/`.
export function savedResultPath(text: string, home: string): string | null {
  if (text.length > 2000 || home === '' || !home.startsWith('/')) return null
  try {
    JSON.parse(text)
    return null
  } catch {
    // kein JSON: kann ein Hinweis sein
  }
  const p = /saved to:?\s+(\/\S+?\.txt)\b/.exec(text)?.[1]
  if (!p || normalizePath(p) !== p) return null
  const root = `${normalizePath(home)}/.claude/`
  return p.startsWith(root) && /\/tool-results\/[^/]+\.txt$/.test(p) ? p : null
}

// ---------- Chats aus der App-Antwort ----------

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const sub = (v: unknown, k: string): unknown => (isObj(v) ? v[k] : undefined)

// Zeilen aus list_sessions / get_session → Chats dieses Projekts (ohne archivierte).
// Mit `allProjects` gehen Chats eines genauer passenden anderen Projekts (Unterordner) nicht mit.
export function toChats(rows: Row[], project: string, allProjects: string[] = []): Chat[] {
  return rows
    .filter(r => typeof r.cwd === 'string' && ownsPath(r.cwd, project, allProjects) && !r.isArchived)
    .map(r => ({
      id: str(r.sessionId),
      title: str(r.title),
      group: str(sub(r.group, 'name')),
      groupId: str(sub(r.group, 'id')),
      isRunning: Boolean(r.isRunning),
      last: str(r.lastActivityAt),
      link: str(r.link),
      parent: str(r.startedBy ?? r.parentSessionId),
    }))
}

// Für die Ansicht: Chats ohne Nummer zeigen die im Register geplante Nummer.
export function withPlannedTitles(cfg: Config | null, chats: Chat[]): { chats: Chat[]; planned: number } {
  const byId = new Map<string, string>()
  for (const [num, v] of Object.entries(cfg?.register ?? {})) byId.set(v.session, `${num} · ${v.title}`)
  let planned = 0
  const out = chats.map(c => {
    const t = byId.get(c.id)
    if (parse(c.title) || !t) return c
    planned++
    return { ...c, title: t }
  })
  return { chats: out, planned }
}

// ---------- Statusleiste unten ----------

// Die Statusleiste kennt nur Text: Farbe kommt über farbige Zeichen.
export const STATUS_ICONS = { wartet: '🟠', neu: '🔵', arbeitet: '🟢' } as const

// Wie viele andere Chats warten, sind neu, arbeiten; der eigene Chat zählt nicht mit.
export function countOthers(selfId: string, items: BandItem[]): Record<BandItem['state'], number> {
  const others = items.filter(i => i.id !== selfId)
  const n = (state: BandItem['state']) => others.filter(i => i.state === state).length
  return { wartet: n('wartet'), neu: n('neu'), arbeitet: n('arbeitet') }
}

// «01-01-01 · 🟠 2 wartet · 🔵 1 neu · 🟢 3 arbeiten»
export function statusText(selfTitle: string, selfId: string, items: BandItem[]): string {
  const p = parse(selfTitle)
  const head = p ? p.num : selfTitle.length > 30 ? `${selfTitle.slice(0, 29)}…` : selfTitle
  const n = countOthers(selfId, items)
  const parts = [head || 'Chat-Navigator']
  if (n.wartet > 0) parts.push(`${STATUS_ICONS.wartet} ${n.wartet} wartet`)
  if (n.neu > 0) parts.push(`${STATUS_ICONS.neu} ${n.neu} neu`)
  if (n.arbeitet > 0) parts.push(`${STATUS_ICONS.arbeitet} ${n.arbeitet} arbeiten`)
  return parts.join(' · ')
}

// Solange jemand wartet, steht unten nur «🦀 2» (Zahl der Wartenden) und läuft hin und her.
// Die Bahn besteht aus Mittelpunkten «·»: Leerzeichen schneidet die Anzeige weg, unsichtbare Sonderzeichen
// kennt nicht jede Schrift (sie erscheinen als Fragezeichen). Links und rechts zusammen bleibt die Bahn
// gleich breit, damit nichts daneben hüpft.
export const CRAB_WIDTH = 12
const TRACK = '·'
export function crabFrame(waiting: number, step: number, width = CRAB_WIDTH): string {
  const period = 2 * width
  const s = ((step % period) + period) % period
  const pos = s <= width ? s : period - s
  return `${TRACK.repeat(pos)}🦀 ${waiting}${TRACK.repeat(width - pos)}`
}
