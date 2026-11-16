import type { EngineInterface, Register } from 'claude-code'

import type { Band, Global, Lang, Reason } from '../types'
import { getSelf, listChats, listGroups, runActions } from './app'
import { addToRegister, projectFor } from './config'
import type { Project } from './config'
import { texts } from './i18n'
import { areaOf, countOthers, crabFrame, failedFinding, isRun, normalizeGlobal, parse, planGuard, statusText } from './logic'
import { renderBand } from './band'
import { renderPane } from './pane'
import { PANE, getClosed, markStatus, publishBand, setBand, setNote, setOpen, setSnapshot, storeKey } from './state'

// Chat Navigator: shows the chats of a project as a numbered tree
// (area 06 › sub-folder 06-04 › chat 06-04-01), checks the order (guard)
// and opens chats on click. Settings: ~/.claude/chat-navigator/<name>.json and config.json.

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
    const self = await getSelf($)
    selfId = String(self.sessionId ?? '')
    if (selfId === '') return
    selfTitle = String(self.title ?? '')
    const isRunChat = Boolean(self.scheduledTaskId) || isRun(p.cfg, selfTitle)
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
      selfTitle = String((await getSelf($)).title ?? selfTitle)
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
      await setSnapshot($, s => ({ ...s, config: null, configError: error, lang, at: new Date().toISOString() }))
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
    await setSnapshot($, s => ({ ...s, chats, selfId, config: cfg, configError: error, lang, at: new Date().toISOString(), error: '' }))
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => renderBand($, e, next, () => project))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderPane($, e, { refresh: () => refresh($, true), project: () => project }),
  )
}
