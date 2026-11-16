// Pure logic of the Chat Navigator: no app access, so it is tested directly.
// Anything that depends on time takes `now` (milliseconds) as an argument.

import type { Area, BandItem, BandMode, BandState, Chat, Config, ConfigError, Features, Finding, Global, Lang, Reason, WeekRow } from '../types'
import { LANGS, texts } from './i18n'

// ---------- Titles and numbers ----------

// «06-04-01 · Title» → number, area, sub-folder, rest of the title
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

// Sidebar group «06 Name» → «06»
export function groupArea(group: string): string {
  const m = /^(\d{2})\s/.exec(group)
  return m ? (m[1] ?? '') : ''
}

// Steering chat: «06», «06-00» or «06-04-00»
export function isSteering(num: string): boolean {
  return /^\d{2}(-00)?$/.test(num) || /-00$/.test(num)
}

// Area of a chat: archive list first (a cleaned-up chat leaves the tree even with a number),
// then the number in the title, a run pattern or the sidebar group.
export function areaOf(cfg: Config | null, c: Pick<Chat, 'id' | 'title' | 'group'>): string {
  if (cfg?.archive.sessions.includes(c.id)) return cfg.archive.area
  const p = parse(c.title)
  if (p) return p.area
  if (cfg && isRun(cfg, c.title)) return cfg.runs.area
  const named = cfg?.areas.find(a => a.group !== undefined && a.group === c.group)
  return named ? named.id : groupArea(c.group)
}

// Is the chat in its area's sidebar group? With `group` set, exactly that name counts, else a group «NN …».
export function inAreaGroup(cfg: Config, c: Pick<Chat, 'group'>, area: string): boolean {
  const a = cfg.areas.find(x => x.id === area)
  return a?.group !== undefined ? c.group === a.group : groupArea(c.group) === area
}

export function isRun(cfg: Config, title: string): boolean {
  return cfg.runs.patterns.some(t => t !== '' && title.includes(t))
}

// Archive and run areas: chats there need no number.
export function isSpecialArea(cfg: Config, area: string): boolean {
  return area === cfg.archive.area || area === cfg.runs.area
}

// Next free number in a sub-folder, from register and titles; '' once 99 is reached.
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

// ---------- Which project a folder belongs to ----------

// Clean an absolute path: collapse «//», resolve «.» and «..», no trailing «/».
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

// Does the folder belong to the project? Absolute path: the folder itself or below it.
// A bare folder name (older form): a whole folder name in the path, not «project-old».
export function inProjectPath(cwd: string, project: string): boolean {
  if (project === '' || cwd === '') return false
  if (project.startsWith('/')) {
    const root = normalizePath(project)
    const dir = normalizePath(cwd)
    return dir === root || dir.startsWith(root === '/' ? '/' : `${root}/`)
  }
  return cwd.split('/').includes(project)
}

// How well does a project match? A longer absolute path wins; a bare name counts least.
function matchScore(cwd: string, project: string): number {
  if (!inProjectPath(cwd, project)) return -1
  return project.startsWith('/') ? 1 + normalizePath(project).length : 0
}

// Does the folder belong to this project and not to a closer-matching one (a sub-project)?
export function ownsPath(cwd: string, project: string, allProjects: string[]): boolean {
  const own = matchScore(cwd, project)
  return own >= 0 && allProjects.every(p => p === project || matchScore(cwd, p) <= own)
}

// The project for a folder, or null.
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

// ---------- Validating settings ----------

export const DEFAULTS: Config['settings'] = { staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true }

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const posNum = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)

// Lay `settings` from a file over defaults; anything unusable falls back to the default.
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

// Modes of the line above the prompt; the German words of earlier versions still work.
export const BAND_MODES: BandMode[] = ['off', 'active', 'always']
const BAND_ALIASES: Record<string, BandMode> = { aus: 'off', offen: 'active', immer: 'always' }

function bandMode(v: unknown): BandMode {
  if (typeof v !== 'string') return 'active'
  if ((BAND_MODES as string[]).includes(v)) return v as BandMode
  return Object.hasOwn(BAND_ALIASES, v) ? (BAND_ALIASES[v] ?? 'active') : 'active'
}

// Every part of the pane is on unless config.json turns it off with `false`.
export const ALL_FEATURES: Features = { search: true, week: true, cleanup: true }

function features(v: unknown): Features {
  const f = isObj(v) ? v : {}
  return { search: f.search !== false, week: f.week !== false, cleanup: f.cleanup !== false }
}

// Central file config.json → settings for all projects. Without it, the defaults apply.
export function normalizeGlobal(raw: unknown): Global {
  const g = isObj(raw) ? raw : {}
  return {
    language: LANGS.includes(g.language as Lang) ? (g.language as Lang) : 'en',
    statusbar: g.statusbar !== false,
    crab: g.crab === true,
    band: bandMode(g.band),
    features: features(g.features),
    settings: mergeSettings(g.settings, DEFAULTS),
  }
}

// Raw project file → validated settings. The older keys `ablage` (archive) and `laeufe` (runs) still work.
// `base`: defaults from the central file; the project file overrides them one by one.
export function normalizeConfig(raw: unknown, base: Config['settings'] = DEFAULTS): { cfg: Config } | { error: ConfigError } {
  if (!isObj(raw)) return { error: { code: 'notObject' } }
  if (typeof raw.project !== 'string' || raw.project === '') return { error: { code: 'noProject' } }
  if (!Array.isArray(raw.areas)) return { error: { code: 'noAreas' } }
  const areas: Area[] = []
  for (const a of raw.areas) {
    if (!isObj(a) || typeof a.id !== 'string' || !/^\d{2}$/.test(a.id)) return { error: { code: 'badAreaId' } }
    const subs = Array.isArray(a.subs) ? a.subs : []
    if (areas.some(x => x.id === a.id)) return { error: { code: 'dupArea', area: a.id } }
    const okSubs = subs.every(s => isObj(s) && typeof s.id === 'string' && new RegExp(`^${a.id}-\\d{2}$`).test(s.id))
    if (!okSubs) return { error: { code: 'badSubId', area: a.id } }
    const subIds = subs.map(s => String((s as Record<string, unknown>).id))
    if (new Set(subIds).size !== subIds.length) return { error: { code: 'dupSub', area: a.id } }
    if (a.group !== undefined && (typeof a.group !== 'string' || a.group === '')) return { error: { code: 'badGroup', area: a.id } }
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
  if (!isObj(reg)) return { error: { code: 'badRegister' } }
  const register: Config['register'] = {}
  for (const [num, v] of Object.entries(reg)) {
    if (!/^\d{2}(-\d{2}){0,2}$/.test(num)) return { error: { code: 'badRegisterNum', num } }
    if (!isObj(v) || typeof v.session !== 'string') return { error: { code: 'noSession', num } }
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

// ---------- Guard: findings and the one safe fix ----------

// The only change the guard makes itself: assigning a number by renaming a chat.
// Moving chats in the sidebar is only reported: the app does not let a plugin move other chats without asking.
export type Action = { kind: 'rename'; chatId: string; num: string; title: string; original: string }

export type Group = { id: string; name: string }

// Plans what the guard fixes itself and collects what remains to clarify.
// A fix that fails later becomes a finding (see `failedFinding`).
export function planGuard(cfg: Config, chats: Chat[], groups: Group[], now: number): { findings: Finding[]; actions: Action[] } {
  const findings: Finding[] = []
  const actions: Action[] = []
  const byId = new Map(chats.map(c => [c.id, c]))
  const register = { ...cfg.register }
  const registered = new Set(Object.values(cfg.register).map(v => v.session))
  // Titles after planned renames, so the following steps take them into account.
  const title = new Map(chats.map(c => [c.id, c.title]))
  const view = () => chats.map(c => ({ title: title.get(c.id) ?? c.title }))

  // 1. Chat without a number, started from a numbered chat in a configured sub-folder: inherit the next number.
  for (const c of chats) {
    if (parse(c.title) || isSpecialArea(cfg, areaOf(cfg, c))) continue
    const parent = byId.get(c.parent)
    const pp = parent ? parse(title.get(parent.id) ?? parent.title) : null
    const known = pp ? cfg.areas.some(a => a.subs.some(s => s.id === pp.sub)) : false
    const num = pp && known && !pp.sub.endsWith('-00') && !registered.has(c.id) ? nextNumber(register, view(), pp.sub) : null
    if (num === '' && pp) {
      findings.push({ kind: 'numbersFull', chatId: c.id, title: c.title, sub: pp.sub })
    } else if (num) {
      const t = `${num} · ${c.title}`
      register[num] = { session: c.id, title: c.title }
      title.set(c.id, t)
      actions.push({ kind: 'rename', chatId: c.id, num, title: t, original: c.title })
    } else {
      findings.push({ kind: 'noNumber', chatId: c.id, title: c.title })
    }
  }

  // 2. Number does not match the sidebar group: report where the chat belongs. Sub-chats (started by another
  // chat) are nested under that chat in the sidebar and cannot be moved on their own, so they are not reported.
  // With `group` set on the area, only that group counts; else a group «NN …».
  const ownGroups = new Set(chats.map(c => c.groupId).filter(Boolean))
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p || inAreaGroup(cfg, c, p.area) || c.parent !== '' || cfg.archive.sessions.includes(c.id)) continue
    const named = cfg.areas.find(a => a.id === p.area)?.group
    const candidates = named !== undefined ? groups.filter(x => x.name === named) : groups.filter(x => x.name.startsWith(`${p.area} `))
    // Several groups with the same number (e.g. from another project): take the one this project already uses.
    const used = candidates.filter(x => ownGroups.has(x.id))
    const g = candidates.length === 1 ? candidates[0] : used.length === 1 ? used[0] : undefined
    const label = named ?? `${p.area} …`
    if (candidates.length === 0) findings.push({ kind: 'missingGroup', chatId: c.id, title: t, group: label })
    else if (!g) findings.push({ kind: 'unclearGroup', chatId: c.id, title: t, group: label })
    else findings.push({ kind: 'wrongGroup', chatId: c.id, title: t, group: g.name })
  }

  // 3. Duplicate numbers, also against the register.
  const seen = new Map<string, string>()
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p) continue
    const other = seen.get(p.num)
    if (other !== undefined) findings.push({ kind: 'duplicate', chatId: c.id, title: t, other })
    else seen.set(p.num, t)
    const reg = cfg.register[p.num]
    if (reg && reg.session !== c.id && byId.has(reg.session)) findings.push({ kind: 'duplicateRegister', chatId: c.id, num: p.num })
  }

  // 4. Working chats nobody has used for a long time.
  for (const c of chats) {
    const t = title.get(c.id) ?? c.title
    const p = parse(t)
    if (!p || isSteering(p.num) || isSpecialArea(cfg, areaOf(cfg, c))) continue
    const d = daysSince(c.last, now)
    if (d > cfg.settings.staleDays) findings.push({ kind: 'stale', chatId: c.id, title: t, days: Math.floor(d) })
  }

  return { findings, actions }
}

// A fix that was not carried out, as a finding; `reason` says why.
export function failedFinding(a: Action, reason: Reason): Finding {
  return { kind: 'noNumber', chatId: a.chatId, title: a.original, reason }
}

// ---------- Time ----------

export function daysSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / 86_400_000
}

export function age(iso: string, now: number, lang: Lang = 'en'): string {
  const t = texts(lang)
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 5) return t.ageNow
  if (min < 60) return t.ageMinutes(min)
  const h = Math.floor(min / 60)
  if (h < 24) return t.ageHours(h)
  return t.ageDays(Math.floor(h / 24))
}

// ---------- Status: waiting, new ----------

// «Waiting for you»: does the history (text of list_events) end with a question to the user?
export function endsWithQuestion(events: string): boolean {
  const blocks = events
    .split(/\n(?=\[(?:assistant|user|result)\])/)
    .map(b => b.trim())
    .filter(Boolean)
  // Tool results do not count; what matters is who last said or asked something.
  const last = [...blocks].reverse().find(b => !b.startsWith('[result]')) ?? ''
  if (!last.startsWith('[assistant]')) return false
  if (/^\[assistant\] \(called /.test(last)) return /AskUserQuestion/.test(last)
  return /\?\s*$/.test(last) || /\?\s*\n/.test(last.split('\n').slice(-2).join('\n') + '\n')
}

// Keep the «last seen» list: unknown chats count as seen; a chat active since the last look is «new».
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
    // The current chat is open right now: it counts as seen, so it is not «new» elsewhere.
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
  // Forget only after 30 days: the app lists at most 300 chats; older ones are missing but still exist.
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
    const state: BandState | null = c.isRunning ? 'working' : c.isWaiting ? 'waiting' : c.isNew ? 'new' : null
    if (!state) continue
    const p = parse(c.title)
    items.push({ id: c.id, num: p ? p.num : '', title: p ? p.rest : c.title, link: c.link, state })
  }
  return items
}

// ---------- Offloaded responses ----------

// The app saves large responses as a file in its results folder and only answers with the path.
// Accepted is only a short notice that is not JSON itself (so not a chat list with a crafted title),
// naming a .txt file directly in a `tool-results` folder below `<home>/.claude/`.
export function savedResultPath(text: string, home: string): string | null {
  if (text.length > 2000 || home === '' || !home.startsWith('/')) return null
  try {
    JSON.parse(text)
    return null
  } catch {
    // not JSON: may be a notice
  }
  const p = /saved to:?\s+(\/\S+?\.txt)\b/.exec(text)?.[1]
  if (!p || normalizePath(p) !== p) return null
  const root = `${normalizePath(home)}/.claude/`
  return p.startsWith(root) && /\/tool-results\/[^/]+\.txt$/.test(p) ? p : null
}

// ---------- Chats from the app's response ----------

type Row = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))
const field = (v: unknown, k: string): unknown => (isObj(v) ? v[k] : undefined)

// Rows of list_sessions / get_session → chats of this project (archived ones left out).
// With `allProjects`, chats of a closer-matching project (a sub-project) are left out too.
export function toChats(rows: Row[], project: string, allProjects: string[] = []): Chat[] {
  return rows
    .filter(r => typeof r.cwd === 'string' && ownsPath(r.cwd, project, allProjects) && !r.isArchived)
    .map(r => ({
      id: str(r.sessionId),
      title: str(r.title),
      group: str(field(r.group, 'name')),
      groupId: str(field(r.group, 'id')),
      isRunning: Boolean(r.isRunning),
      last: str(r.lastActivityAt),
      link: str(r.link),
      parent: str(r.startedBy ?? r.parentSessionId),
    }))
}

// For the view: chats without a number show the number planned in the register.
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

// ---------- Search, weekly review, cleanup ----------

// Does a chat match the search? Every word must appear in the title (case-insensitive);
// a number like «01-02» matches chats whose number starts with it.
export function matchesQuery(c: Pick<Chat, 'title'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const title = c.title.toLowerCase()
  const num = parse(c.title)?.num ?? ''
  return words.every(w => title.includes(w) || (/^\d{2}(-\d{0,2})*$/.test(w) && num.startsWith(w)))
}

export function searchChats<T extends Pick<Chat, 'title' | 'last'>>(chats: T[], query: string): T[] {
  return chats.filter(c => matchesQuery(c, query)).sort((a, b) => b.last.localeCompare(a.last))
}

// Review: which areas were worked on most during the last 7 days. Each row holds the area's chats active in
// that time, newest first; rows are sorted by the number of chats, most first, then by area order.
// Chats outside the configured areas are collected under area ''.
export const WEEK_DAYS = 7
export function weekSummary(cfg: Config, chats: Chat[], now: number): WeekRow[] {
  const names = new Map(cfg.areas.map(a => [a.id, a.name]))
  const rows = new Map<string, WeekRow>()
  const recent = chats.filter(c => daysSince(c.last, now) <= WEEK_DAYS).sort((x, y) => y.last.localeCompare(x.last))
  for (const c of recent) {
    const id = areaOf(cfg, c)
    const area = names.has(id) ? id : ''
    const row = rows.get(area) ?? { area, name: names.get(area) ?? '', chats: [] }
    row.chats.push(c.id)
    rows.set(area, row)
  }
  const order = [...cfg.areas.map(a => a.id), '']
  return [...rows.values()].sort((x, y) => y.chats.length - x.chats.length || order.indexOf(x.area) - order.indexOf(y.area))
}

// A bar for the review: `n` out of `max`, at most `width` blocks, at least one for any n > 0.
export function weekBar(n: number, max: number, width = 12): string {
  if (n <= 0 || max <= 0) return ''
  return '█'.repeat(Math.max(1, Math.round((n / max) * width)))
}

// Chats to propose for the archive: unused for longer than `staleDays`, not running, not waiting,
// not the current chat, no steering chat, not already in the archive or the runs area. Oldest first.
export function cleanupCandidates(cfg: Config, chats: Chat[], selfId: string, now: number): Chat[] {
  return chats
    .filter(c => {
      if (c.id === selfId || c.isRunning || c.isWaiting) return false
      const p = parse(c.title)
      if (p && isSteering(p.num)) return false
      if (isSpecialArea(cfg, areaOf(cfg, c))) return false
      return daysSince(c.last, now) > cfg.settings.staleDays
    })
    .sort((a, b) => a.last.localeCompare(b.last))
}

// ---------- Pane width ----------

// Three stages of the pane, by its width in columns: standard as designed; small with smaller text,
// shorter bars and tighter spacing; mini with only a dot and the title per chat, icons in the header,
// no bars and no legend.
export type PaneSize = 'standard' | 'small' | 'mini'
export const SMALL_BELOW = 90
export const MINI_BELOW = 55
export function paneSize(cols: number): PaneSize {
  return cols < MINI_BELOW ? 'mini' : cols < SMALL_BELOW ? 'small' : 'standard'
}

// ---------- Status bar ----------

// The status bar only takes text: colour comes from coloured characters.
export const STATUS_ICONS: Record<BandState, string> = { waiting: '🟠', new: '🔵', working: '🟢' }

// How many other chats are waiting, new or working; the current chat does not count.
export function countOthers(selfId: string, items: BandItem[]): Record<BandState, number> {
  const others = items.filter(i => i.id !== selfId)
  const n = (state: BandState) => others.filter(i => i.state === state).length
  return { waiting: n('waiting'), new: n('new'), working: n('working') }
}

// «01-01-01 · 🟠 2 waiting · 🔵 1 new · 🟢 3 working»
export function statusText(selfTitle: string, selfId: string, items: BandItem[], lang: Lang = 'en'): string {
  const t = texts(lang)
  const p = parse(selfTitle)
  const head = p ? p.num : selfTitle.length > 30 ? `${selfTitle.slice(0, 29)}…` : selfTitle
  const n = countOthers(selfId, items)
  const parts = [head || t.appName]
  if (n.waiting > 0) parts.push(`${STATUS_ICONS.waiting} ${t.countWaiting(n.waiting)}`)
  if (n.new > 0) parts.push(`${STATUS_ICONS.new} ${t.countNew(n.new)}`)
  if (n.working > 0) parts.push(`${STATUS_ICONS.working} ${t.countWorking(n.working)}`)
  return parts.join(' · ')
}

// While someone waits, the status bar shows only «🦀 2» (number of waiting chats), running back and forth.
// The track is made of middle dots «·»: the display trims spaces, and invisible special characters are
// missing from some fonts (they show as question marks). Left plus right stays the same width, so nothing
// next to it jumps.
export const CRAB_WIDTH = 12
const TRACK = '·'
export function crabFrame(waiting: number, step: number, width = CRAB_WIDTH): string {
  const period = 2 * width
  const s = ((step % period) + period) % period
  const pos = s <= width ? s : period - s
  return `${TRACK.repeat(pos)}🦀 ${waiting}${TRACK.repeat(width - pos)}`
}
