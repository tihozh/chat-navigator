import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { Band, BandItem, BandMode, Chat, Config, Finding, Global, Lang, Reason, Snapshot } from '../types'
import { bandView } from './band'
import { configErrorText, texts } from './i18n'
import type { Action, Group } from './logic'
import {
  ALL_FEATURES,
  areaOf,
  cleanupCandidates,
  countOthers,
  crabFrame,
  endsWithQuestion,
  failedFinding,
  isRun,
  normalizeConfig,
  normalizeGlobal,
  parse,
  pickProject,
  planGuard,
  savedResultPath,
  statusText,
  toBandItems,
  toChats,
  updateSeen,
} from './logic'
import { paneView } from './pane'

// Chat Navigator: shows the chats of a project as a numbered tree
// (area 06 › sub-folder 06-04 › chat 06-04-01), checks the order (guard)
// and opens chats on click. Settings: ~/.claude/chat-navigator/<name>.json and config.json.
//
// Everything that works with the app (`$`) is in this one file: the plugin directory only reads `$` when it is
// passed to functions of the same file. pane.tsx and band.tsx only draw; logic.ts and i18n.ts hold pure logic.

// Values the pane and the band draw ($.state), and markers shared across chats ($.store).

const PANE = 'chat-navigator'

const EMPTY: Snapshot = {
  chats: [],
  at: '',
  error: '',
  findings: [],
  fixed: [],
  selfId: '',
  config: null,
  configError: '',
  lang: 'en',
  features: ALL_FEATURES,
}

const snapshot = atom({ plugin: 'chat-navigator', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-5' })
const open = atom({ plugin: 'chat-navigator', key: 'open' } as const, [] as string[], { shape: 'open-3' })
const band = atom({ plugin: 'chat-navigator', key: 'band' } as const, { at: '', items: [] } as Band, { shape: 'band-2' })
const note = atom({ plugin: 'chat-navigator', key: 'note' } as const, '')
const query = atom({ plugin: 'chat-navigator', key: 'query' } as const, '')

// Read (also while drawing) and write (only from clicks and events, never while drawing).
// The app's checker requires read/update to see their atoms in the same file, hence these helpers.
function getSnapshot($: EngineInterface) {
  return read($, snapshot)
}
function getOpen($: EngineInterface) {
  return read($, open)
}
function getBand($: EngineInterface) {
  return read($, band)
}
function getNote($: EngineInterface) {
  return read($, note)
}
function getQuery($: EngineInterface) {
  return read($, query)
}
function setSnapshot($: EngineInterface, fn: (s: Snapshot) => Snapshot) {
  return update($, snapshot, fn)
}
function setOpen($: EngineInterface, fn: (l: string[]) => string[]) {
  return update($, open, fn)
}
function setBand($: EngineInterface, fn: (b: Band) => Band) {
  return update($, band, fn)
}
function setNote($: EngineInterface, text: string) {
  return update($, note, () => text)
}
function setQuery($: EngineInterface, text: string) {
  return update($, query, () => text)
}

// Keys in the shared store, separate per project. The shared band carries no mode or language:
// each chat adds its own when it takes the band over.
const storeKey = {
  band: (p: Project) => `band-v2:${p.key}`,
  lock: (p: Project) => `band-lock:${p.key}`,
  seen: (p: Project) => `seen:${p.key}`,
  guard: (p: Project) => `guard-lock:${p.key}`,
  closed: 'closed',
}

async function getSeen($: EngineInterface, p: Project): Promise<Record<string, string>> {
  return ((await $.store.get(storeKey.seen(p))) as Record<string, string> | undefined) ?? {}
}

// Check «waiting for you» per chat only when something has happened there.
const waitCache = new Map<string, { last: string; waiting: boolean }>()

async function isWaiting($: EngineInterface, c: Chat): Promise<boolean> {
  const hit = waitCache.get(c.id)
  if (hit && hit.last === c.last) return hit.waiting
  const waiting = endsWithQuestion(await listEvents($, c.id))
  waitCache.set(c.id, { last: c.last, waiting })
  return waiting
}

// Sets `isNew` and `isWaiting` on the chats and keeps the «last seen» list.
async function markStatus($: EngineInterface, p: Project, chats: Chat[], selfId: string): Promise<void> {
  const now = Date.now()
  const r = updateSeen(chats, await getSeen($, p), selfId, now)
  for (const c of chats) {
    if (r.fresh.has(c.id)) c.isNew = true
    if (c.id === selfId || c.isRunning) continue
    if (now - Date.parse(c.last) < p.cfg.settings.waitingHours * 3_600_000) {
      try {
        c.isWaiting = await isWaiting($, c)
      } catch {
        c.isWaiting = false
      }
    }
  }
  const ids = new Set(chats.map(c => c.id))
  for (const id of [...waitCache.keys()]) if (!ids.has(id)) waitCache.delete(id)
  if (r.changed) await $.store.set(storeKey.seen(p), r.seen)
}

// A chat was opened: no longer «new».
async function markSeen($: EngineInterface, p: Project | null, id: string): Promise<void> {
  if (p) {
    const seen = await getSeen($, p)
    seen[id] = new Date().toISOString()
    await $.store.set(storeKey.seen(p), seen)
  }
  await setBand($, b => ({ ...b, items: b.items.filter(i => !(i.id === id && i.state === 'new')) }))
  await setSnapshot($, s => ({ ...s, chats: s.chats.map(x => (x.id === id ? { ...x, isNew: false } : x)) }))
}

async function publishBand($: EngineInterface, p: Project, chats: Chat[], mode: BandMode, lang: Lang): Promise<Band> {
  const b: Band = { at: new Date().toISOString(), items: toBandItems(chats) }
  await $.store.set(storeKey.band(p), b)
  await setBand($, () => ({ ...b, mode, lang }))
  return b
}

async function getClosed($: EngineInterface): Promise<string[]> {
  return ((await $.store.get(storeKey.closed)) as string[] | undefined) ?? []
}

// Calls to the services of the desktop app (ccd_session_mgmt, ccd_sidebar).

type Res = { content: Array<{ type: string; text?: string }>; isError?: boolean }

async function call($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<Res> {
  try {
    return (await $.mcp.call(server, tool, args)) as Res
  } catch {
    // When a chat starts, the app service is often not connected yet: connect and try again.
    await $.mcp.connect(server)
    return (await $.mcp.call(server, tool, args)) as Res
  }
}

async function callText($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const res = await call($, server, tool, args)
  let text = res.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  // The app saves large responses to a file and only names the path. Only such a notice is followed
  // (short, file in the app's results folder), never a path that appears somewhere in a title.
  const saved = savedResultPath(text, (await $.env.get('HOME')) ?? '')
  if (saved) text = await $.fs.read(saved)
  if (res.isError) throw new Error(text.slice(0, 200))
  return text
}

async function callJson($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await callText($, server, tool, args))
}

type Row = Record<string, unknown>

// The current chat: get_session with session_id 'self'. Written out at each place (not as a helper): the plugin
// directory could not read the helper's calls.
// All chats of the project, the current chat always included. list_sessions returns at most 300 chats;
// `complete` is false when the list is full and older chats may be missing.
const MAX_SESSIONS = 300
async function listChats(
  $: EngineInterface,
  project: string,
  others: string[],
): Promise<{ chats: Chat[]; selfId: string; mine: Row; complete: boolean }> {
  const rows = (await callJson($, 'ccd_session_mgmt', 'list_sessions', { limit: MAX_SESSIONS })) as Row[]
  const mine = (await callJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Row
  const selfId = String(mine.sessionId ?? '')
  const all = [...rows.filter(r => String(r.sessionId) !== selfId), mine]
  return { chats: toChats(all, project, others), selfId, mine, complete: rows.length < MAX_SESSIONS }
}

async function listGroups($: EngineInterface): Promise<Group[]> {
  return (await callJson($, 'ccd_sidebar', 'list_groups', {})) as Group[]
}

async function listEvents($: EngineInterface, sessionId: string): Promise<string> {
  return callText($, 'ccd_session_mgmt', 'list_events', { session_id: sessionId, limit: 8 })
}

// Carry out the planned renames; whatever fails becomes a finding.
async function runActions($: EngineInterface, actions: Action[]): Promise<{ done: Action[]; failed: Finding[] }> {
  const done: Action[] = []
  const failed: Finding[] = []
  for (const a of actions) {
    try {
      await callText($, 'ccd_session_mgmt', 'set_session_title', { session_id: a.chatId, title: a.title })
      done.push(a)
    } catch (err) {
      failed.push(failedFinding(a, { code: 'error', message: err instanceof Error ? err.message : String(err) }))
    }
  }
  return { done, failed }
}

// Settings: one file per project in ~/.claude/chat-navigator/<name>.json, plus the central
// config.json for all projects. The navigator takes the project file whose path matches the chat's folder.

const GLOBAL_FILE = 'config.json'

// `others`: paths of all configured projects, so sub-projects keep their own chats.
type Project = { file: string; key: string; cfg: Config; others: string[] }

async function settingsDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/chat-navigator`
}

// Central file; without it, the defaults apply. If it is broken, the defaults apply too, with an error.
async function loadGlobal($: EngineInterface, dir: string): Promise<{ global: Global; broken: boolean }> {
  const file = `${dir}/${GLOBAL_FILE}`
  if (!(await $.fs.exists(file))) return { global: normalizeGlobal({}), broken: false }
  try {
    return { global: normalizeGlobal(JSON.parse(await $.fs.read(file))), broken: false }
  } catch {
    // Broken central file: defaults, but no automatic numbering to be safe.
    return { global: normalizeGlobal({ settings: { autoFix: false } }), broken: true }
  }
}

// Central file and all readable projects; broken files come back as errors instead of blocking everything.
async function loadProjects($: EngineInterface): Promise<{ projects: Project[]; global: Global; errors: string[] }> {
  const dir = await settingsDir($)
  if (!(await $.fs.exists(dir))) return { projects: [], global: normalizeGlobal({}), errors: [] }
  const { global, broken } = await loadGlobal($, dir)
  const t = texts(global.language)
  const projects: Project[] = []
  const errors: string[] = broken ? [t.config.invalidJson(GLOBAL_FILE)] : []
  for (const e of await $.fs.list(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === GLOBAL_FILE) continue
    const file = `${dir}/${e.name}`
    let raw: unknown
    try {
      raw = JSON.parse(await $.fs.read(file))
    } catch {
      errors.push(t.config.invalidJson(e.name))
      continue
    }
    const r = normalizeConfig(raw, global.settings)
    if ('error' in r) {
      errors.push(`${e.name}: ${configErrorText(global.language, r.error)}`)
      continue
    }
    // Broken central file: automatic numbering stays off, even if the project file turns it on.
    if (broken) r.cfg.settings.autoFix = false
    projects.push({ file, key: e.name.replace(/\.json$/, ''), cfg: r.cfg, others: [] })
  }
  const all = projects.map(p => p.cfg.project)
  for (const p of projects) p.others = all
  return { projects, global, errors }
}

// The project for a folder. `error` lists broken settings files, if any.
async function projectFor($: EngineInterface, cwd: string): Promise<{ project: Project | null; global: Global; error: string }> {
  const { projects, global, errors } = await loadProjects($)
  const project = pickProject(cwd, projects)
  const error = errors.length > 0 ? texts(global.language).config.broken(errors.join('; ')) : ''
  return { project, global, error }
}

// All writes to project files in this chat run one after another, so the register and the archive
// never overwrite each other's change. (Across chats the app offers no lock; see README.)
let writeQueue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(job, job)
  writeQueue = run.catch(() => undefined)
  return run
}

// Write new register entries to the file. The file is read again first, so changes made by hand or from
// other chats are kept and other keys stay untouched. A number that already belongs to another chat there
// is never overwritten (the skipped numbers are returned).
async function addToRegister($: EngineInterface, p: Project, add: Config['register']): Promise<string[]> {
  if (Object.keys(add).length === 0) return []
  return serial(() => writeRegister($, p, add))
}

async function writeRegister($: EngineInterface, p: Project, add: Config['register']): Promise<string[]> {
  const raw = JSON.parse(await $.fs.read(p.file)) as Record<string, unknown>
  const reg = (raw.register && typeof raw.register === 'object' ? raw.register : {}) as Config['register']
  const skipped: string[] = []
  const merged = { ...reg }
  for (const [num, v] of Object.entries(add)) {
    const had = reg[num]
    if (had && had.session !== v.session) skipped.push(num)
    else merged[num] = v
  }
  raw.register = merged
  await $.fs.write(p.file, `${JSON.stringify(raw, null, 2)}\n`)
  return skipped
}

// Put chats into the navigator's archive (`archive.sessions` in the project file). The file is read again
// first; other keys, and an older `ablage` list, stay untouched. Returns how many ids were new.
async function addToArchive($: EngineInterface, p: Project, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  return serial(() => writeArchive($, p, ids))
}

async function writeArchive($: EngineInterface, p: Project, ids: string[]): Promise<number> {
  const raw = JSON.parse(await $.fs.read(p.file)) as Record<string, unknown>
  const archive = (raw.archive && typeof raw.archive === 'object' ? raw.archive : {}) as Record<string, unknown>
  const sessions = Array.isArray(archive.sessions) ? archive.sessions.filter((x): x is string => typeof x === 'string') : []
  const older = Array.isArray(raw.ablage) ? raw.ablage : []
  const fresh = ids.filter(id => !sessions.includes(id) && !older.includes(id))
  if (fresh.length === 0) return 0
  raw.archive = { ...archive, sessions: [...sessions, ...fresh] }
  await $.fs.write(p.file, `${JSON.stringify(raw, null, 2)}\n`)
  return fresh.length
}

const TICK_MS = 60_000
const BAND_MAX_AGE_MS = 300_000
const CRAB_MS = 600

// State of this chat (lost on a module reload, which is fine).
let project: Project | null = null // project of this chat, at the last look
let global: Global = normalizeGlobal({}) // central settings, at the last look
let selfId = '' // the chat this module runs in
let selfTitle = '' // its title, for the status bar
let expandedFor = '' // the chat the tree was last expanded for
let wantPane: boolean | null = null // null: not yet decided whether this chat gets the pane
let checkTries = 0
let busy = false
let again: boolean | null = null // request during a pass: exactly one more pass afterwards
let lastFull = 0 // last full pass of this pane (ms)
let crab: { cancel: () => void } | null = null
let crabStep = 0
let crabWaiting = 0
let shownLang: Lang | null = null // language the command and notes were last given in

async function currentProject($: EngineInterface): Promise<{ project: Project | null; error: string }> {
  try {
    const r = await projectFor($, await $.session.cwd())
    project = r.project
    global = r.global
    return r
  } catch (err) {
    project = null
    return { project: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// After a language change: register the command again in the new language and drop notes in the old one.
async function applyLanguage($: EngineInterface) {
  if (shownLang === global.language) return
  const first = shownLang === null
  shownLang = global.language
  await $.command.register({ name: 'navigator', description: texts(global.language).commandDescription })
  if (!first) await setNote($, '')
}

function stopCrab() {
  crab?.cancel()
  crab = null
}

// Status bar entry: only in project chats and only when turned on.
// With `crab`, a running crab replaces the text while another chat waits.
function showStatus($: EngineInterface, b: Band | undefined) {
  if (!project || !global.statusbar || selfTitle === '') {
    stopCrab()
    return $.ui.status(undefined)
  }
  const items = b?.items ?? []
  crabWaiting = countOthers(selfId, items).waiting
  if (global.crab && crabWaiting > 0) {
    if (!crab) crab = $.clock.every(CRAB_MS, () => $.ui.status(crabFrame(crabWaiting, ++crabStep)))
    $.ui.status(crabFrame(crabWaiting, crabStep))
  } else {
    stopCrab()
    $.ui.status(statusText(selfTitle, selfId, items, global.language))
  }
}

// Opening automatically: open first (needs only the folder), then load the chat details. If the chat is a
// scheduled run or the user closed the pane here, it is closed again. When a chat starts, the app service
// is often not connected yet, so tick() retries loading the details every minute (at most 5 times).
async function openIfWanted($: EngineInterface) {
  if (wantPane === false || !(await currentProject($)).project) return
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (pane?.isPlaced) return
  const opened = await $.ui.open({ id: PANE, title: texts(global.language).appName })
  if (opened.isPlaced) void refresh($, true)
}

async function autoOpen($: EngineInterface) {
  if (wantPane !== null || checkTries >= 5) return
  const p = (await currentProject($)).project
  if (!p) {
    wantPane = false
    return
  }
  if (checkTries === 0) await openIfWanted($)
  checkTries++
  try {
    const mine = (await callJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Row
    selfId = String(mine.sessionId ?? '')
    if (selfId === '') return
    selfTitle = String(mine.title ?? '')
    const isRunChat = Boolean(mine.scheduledTaskId) || isRun(p.cfg, selfTitle)
    wantPane = !isRunChat && !(await getClosed($)).includes(selfId)
    if (!wantPane && (await $.ui.panes()).some(x => x.id === PANE)) await $.ui.close({ id: PANE })
  } catch {
    // App service not connected yet: the next tick tries again.
  }
}

// Tick in every chat: take over the shared band from the store; if it is old, refresh it.
// The guard only runs while the pane is open.
async function tick($: EngineInterface) {
  if (wantPane === null) await autoOpen($)
  const had = project
  const p = (await currentProject($)).project
  if (!p) {
    // Settings file removed or broken: do not leave the old state on screen.
    if (had) {
      await setBand($, () => ({ at: '', items: [] }))
      await refresh($, true)
    }
    showStatus($, undefined)
    return
  }
  // Apply the switches of the central file at once, whether or not the queries below succeed.
  await applyLanguage($)
  await setBand($, b => ({ ...b, mode: global.band, lang: global.language }))
  if (!global.statusbar) showStatus($, undefined)
  const pollMs = p.cfg.settings.pollMinutes * 60_000
  const paneOpen = (await $.ui.panes()).some(x => x.id === PANE)
  const stored = (await $.store.get(storeKey.band(p))) as Band | undefined
  const ageMs = stored?.at ? Date.now() - Date.parse(stored.at) : Infinity
  // The pane goes by its own last pass, not by the shared band.
  if (paneOpen && Date.now() - lastFull > pollMs - 10_000) return refresh($, true)
  if (ageMs > Math.max(BAND_MAX_AGE_MS, pollMs)) {
    const lock = (await $.store.get(storeKey.lock(p))) as string | undefined
    if (lock && Date.now() - Date.parse(lock) < 60_000) return
    await $.store.set(storeKey.lock(p), new Date().toISOString())
    return refresh($, false)
  }
  if (stored) await setBand($, () => ({ ...stored, mode: global.band, lang: global.language }))
  // Reload the current chat's title: it may have changed, even while another chat keeps the band fresh.
  if (global.statusbar) {
    try {
      const info = (await callJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Row
      selfTitle = String(info.title ?? selfTitle)
    } catch {
      // App service not connected yet: keep the old title.
    }
  }
  showStatus($, stored)
}

// Why the guard may not number chats itself in this pass, or null if it may.
function holdReason(autoFix: boolean, complete: boolean, locked: boolean): Reason | null {
  if (!autoFix) return { code: 'autoFixOff' }
  if (!complete) return { code: 'incomplete' }
  if (wantPane !== true) return { code: 'paneInactive' }
  if (locked) return { code: 'locked' }
  return null
}

async function refresh($: EngineInterface, withGuard = true): Promise<void> {
  if (busy) {
    again = again === true || withGuard
    return
  }
  busy = true
  try {
    const { project: p, error } = await currentProject($)
    const lang = global.language
    if (!p) {
      await setSnapshot($, s => ({ ...s, config: null, configError: error, lang, features: global.features, at: new Date().toISOString() }))
      return
    }
    const cfg = p.cfg
    const { chats, selfId: id, complete } = await listChats($, cfg.project, p.others)
    selfId = id
    await markStatus($, p, chats, selfId)
    const b = await publishBand($, p, chats, global.band, lang)
    selfTitle = chats.find(c => c.id === selfId)?.title ?? selfTitle
    showStatus($, b)

    // On the first pass in a chat, expand its area and sub-folder and collapse the others;
    // after that, whatever the user expands or collapses stays.
    const current = chats.find(c => c.id === selfId)
    if (current && expandedFor !== current.id) {
      expandedFor = current.id
      const sub = parse(current.title)?.sub
      const want = [areaOf(cfg, current), ...(sub ? [sub] : [])]
      await setOpen($, list => [...list.filter(k => !/^\d{2}(-\d{2})?$/.test(k)), ...want])
    }
    if (!withGuard) return

    // Show the chats first; if the guard fails (e.g. sidebar service not connected), the list stays visible.
    lastFull = Date.now()
    await setSnapshot($, s => ({ ...s, chats, selfId, config: cfg, configError: error, lang, features: global.features, at: new Date().toISOString(), error: '' }))
    try {
      const plan = planGuard(cfg, chats, await listGroups($), Date.now())
      // Number chats only when turned on, the chat list is complete, this chat surely has the pane
      // (no scheduled run, not closed) and no other chat of this project is numbering right now.
      const lock = (await $.store.get(storeKey.guard(p))) as { by: string; at: string } | undefined
      const locked = !!lock && lock.by !== selfId && Date.now() - Date.parse(lock.at) <= 50_000
      const hold = holdReason(cfg.settings.autoFix, complete, locked)
      if (!hold && plan.actions.length > 0) await $.store.set(storeKey.guard(p), { by: selfId, at: new Date().toISOString() })
      const { done, failed } = hold ? { done: [], failed: plan.actions.map(a => failedFinding(a, hold)) } : await runActions($, plan.actions)
      const added: typeof cfg.register = {}
      const renamed = new Map<string, string>()
      for (const a of done) {
        added[a.num] = { session: a.chatId, title: a.original }
        renamed.set(a.chatId, a.title)
      }
      const ownTitle = renamed.get(selfId)
      if (ownTitle) {
        selfTitle = ownTitle
        showStatus($, b)
      }
      const skipped = await addToRegister($, p, added)
      for (const num of skipped) failed.push({ kind: 'duplicateRegister', chatId: added[num]?.session ?? '', num })
      await setSnapshot($, s => ({
        ...s,
        findings: [...failed, ...plan.findings],
        fixed: done.map(a => a.title),
        chats: s.chats.map(c => (renamed.has(c.id) ? { ...c, title: renamed.get(c.id) ?? c.title } : c)),
        config: s.config ? { ...s.config, register: { ...s.config.register, ...added } } : s.config,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await setSnapshot($, s => ({ ...s, lang, error: texts(lang).checkFailed(msg) }))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setSnapshot($, s => ({ ...s, lang: global.language, at: new Date().toISOString(), error: texts(global.language).readFailed(msg) }))
  } finally {
    busy = false
    if (again !== null) {
      const g = again
      again = null
      void refresh($, g)
    }
  }
}

// «Clean up»: put the given chats into the navigator's archive, then reload.
// The list is checked again right before writing: a chat that became active or waiting meanwhile stays.
async function archiveChats($: EngineInterface, ids: string[]): Promise<number> {
  const p = (await currentProject($)).project
  if (!p) return 0
  const { chats, selfId: id } = await listChats($, p.cfg.project, p.others)
  await markStatus($, p, chats, id)
  const still = new Set(cleanupCandidates(p.cfg, chats, id, Date.now()).map(c => c.id))
  const n = await addToArchive($, p, ids.filter(x => still.has(x)))
  await refresh($, true)
  return n
}

// Opens a chat by its link with the system command `open`; only claude:// links are opened.
async function openLink($: EngineInterface, link: string): Promise<number> {
  if (!link.startsWith('claude://')) return -1
  const r = await $.process.run(['open', link])
  return r.exitCode
}

// Line above the prompt (band.tsx draws it). Draws only; anything is written in the click handler.
async function drawBand(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt'>,
  next: (e: RenderInput<'AbovePrompt'>) => Promise<RenderElement>,
): Promise<RenderElement> {
  if (e.props.hasSurvey) return next(e)
  const b = await getBand($)
  const ui = $.ui.resolve(e)
  const open = (i: BandItem) => async () => {
    if ((await openLink($, i.link)) === 0) await markSeen($, project, i.id)
  }
  return bandView(ui, b, open) ?? next(e)
}

// Click on a chat in the pane: open it, or say why it did not open.
async function openChat($: EngineInterface, chat: Chat, lang: Lang): Promise<void> {
  const t = texts(lang)
  if (!chat.link.startsWith('claude://')) {
    await setNote($, t.openFailed(t.noLink(chat.title)))
    return
  }
  try {
    const code = await openLink($, chat.link)
    if (code !== 0) {
      await setNote($, t.openFailed(t.openExit(code)))
      return
    }
    await markSeen($, project, chat.id)
    await setNote($, '')
  } catch (err) {
    await setNote($, t.openFailed((err instanceof Error ? err.message : String(err)).slice(0, 160)))
  }
}

// «+ 01-02-04»: copy the next free number to the clipboard.
async function copyNumber($: EngineInterface, surface: RenderInput<'Pane'>['surface'], num: string, lang: Lang): Promise<void> {
  await $.ui.copy({ text: `${num} · `, surface })
  await setNote($, texts(lang).copied(num))
}

// «Clean up» button: archive the chats, close the list and say how many were put away.
async function cleanUp($: EngineInterface, ids: string[], lang: Lang): Promise<void> {
  const n = await archiveChats($, ids)
  await setOpen($, list => list.filter(k => k !== '__cleanup'))
  await setNote($, texts(lang).cleanupDone(n))
}

// The pane (pane.tsx draws it). Draws only; anything is written in the click handlers.
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const snap = await getSnapshot($)
  const lang = snap.lang ?? 'en'
  const view = { snap, expanded: await getOpen($), hint: await getNote($), rawQuery: await getQuery($), columns: e.props.bodyColumns ?? 120 }
  return paneView(ui, view, {
    refresh: () => refresh($, true),
    toggle: key => () => setOpen($, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key])).then(() => undefined),
    openChat: chat => () => openChat($, chat, lang),
    copyNumber: num => () => copyNumber($, e.surface, num, lang),
    setQuery: text => void setQuery($, text),
    cleanUp: ids => () => cleanUp($, ids, lang),
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await currentProject($)
    await applyLanguage($)
    // Notes are short-lived; one left over from an earlier session or version is dropped.
    await setNote($, '')
    void tick($)
    $.clock.every(TICK_MS, () => void tick($))
    return next(e)
  })

  // Switching to this chat: open the pane or, if it is already open, reload it at once.
  // A chat that started in the background only gets its window here.
  on('session.attach', async ($, e, next) => {
    const out = await next(e)
    void (async () => {
      const wasOpen = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
      await openIfWanted($)
      if (wasOpen) await refresh($, true)
    })().catch(() => undefined)
    return out
  })

  // If the user closed the pane in a chat, it stays closed there until they type /navigator.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      wantPane = false
      if (selfId !== '') {
        const closed = await getClosed($)
        if (!closed.includes(selfId)) await $.store.set(storeKey.closed, [...closed, selfId].slice(-500))
      }
    }
    return next(e)
  })

  on('command.run', { command: 'navigator' }, async $ => {
    wantPane = true
    if (selfId !== '') {
      const closed = await getClosed($)
      if (closed.includes(selfId)) await $.store.set(storeKey.closed, closed.filter(id => id !== selfId))
    }
    const t = texts(global.language)
    await $.ui.open({ id: PANE, title: t.appName })
    void refresh($, true)
    return { text: t.commandOpened }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => drawBand($, e, next))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => drawPane($, e))
}
