import type { EngineInterface, Register } from 'claude-code'

import type { Band, Global } from '../types'
import { listChats, listGroups, getSelf, runActions } from './app'
import { addToRegister, projectFor } from './config'
import type { Project } from './config'
import { areaOf, countOthers, crabFrame, failedFinding, isRun, normalizeGlobal, parse, planGuard, statusText } from './logic'
import { renderBand } from './band'
import { renderPane } from './pane'
import { PANE, getClosed, markStatus, publishBand, setBand, setOpen, setSnapshot, storeKey } from './state'

// Chat-Navigator: zeigt die Chats eines Projekts als nummerierten Baum
// (Bereich 06 › Unterordner 06-04 › Chat 06-04-01), prüft die Ordnung (Wächter)
// und öffnet Chats per Klick. Einstellungen: ~/.claude/chat-navigator/<name>.json.

const TICK_MS = 60_000
const BAND_MAX_AGE_MS = 300_000
const TITLE = 'Chat-Navigator'

// Zustand dieses Chats (geht bei einem Neuladen des Moduls verloren, das ist gewollt).
let project: Project | null = null // Projekt dieses Chats, beim letzten Blick
let selfId = '' // der Chat, in dem dieses Panel läuft
let expandedFor = '' // für welchen Chat der Baum zuletzt aufgeklappt wurde
let wantPane: boolean | null = null // null: noch offen, ob dieser Chat das Panel bekommt
let checkTries = 0
let busy = false
let again: boolean | null = null // Auftrag während eines Durchgangs: danach genau einer mehr
let lastFull = 0 // letzter vollständiger Durchgang dieses Panels (ms)
let global: Global = normalizeGlobal({}) // zentrale Einstellungen, beim letzten Blick
let selfTitle = '' // Titel dieses Chats, für die Statusleiste

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

// Eintrag in der Statusleiste unten: nur in Projektchats und nur, wenn eingeschaltet.
// Mit `crab` läuft ein Krebs darüber, solange ein anderer Chat wartet.
const CRAB_MS = 600
let crab: { cancel: () => void } | null = null
let crabStep = 0
let crabWaiting = 0

function stopCrab() {
  crab?.cancel()
  crab = null
}

function showStatus($: EngineInterface, b: Band | undefined) {
  if (!project || !global.statusbar || selfTitle === '') {
    stopCrab()
    return $.ui.status(undefined)
  }
  const items = b?.items ?? []
  crabWaiting = countOthers(selfId, items).wartet
  if (global.crab && crabWaiting > 0) {
    if (!crab) crab = $.clock.every(CRAB_MS, () => $.ui.status(crabFrame(crabWaiting, ++crabStep)))
    $.ui.status(crabFrame(crabWaiting, crabStep))
  } else {
    stopCrab()
    $.ui.status(statusText(selfTitle, selfId, items))
  }
}

// Automatisches Öffnen: zuerst öffnen (braucht nur den Ordner), danach die Chat-Angaben
// nachladen; ist der Chat ein automatischer Lauf oder hat der Nutzer das Panel hier
// geschlossen, wird es wieder zugemacht. Der App-Dienst ist beim Start oft noch nicht
// verbunden, darum versucht tick() das Nachladen jede Minute erneut (höchstens 5-mal).
async function openIfWanted($: EngineInterface) {
  if (wantPane === false || !(await currentProject($)).project) return
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (pane?.isPlaced) return
  const opened = await $.ui.open({ id: PANE, title: TITLE })
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
    const isRunChat = Boolean(self.scheduledTaskId) || isRun(p.cfg, String(self.title ?? ''))
    wantPane = !isRunChat && !(await getClosed($)).includes(selfId)
    if (!wantPane && (await $.ui.panes()).some(x => x.id === PANE)) await $.ui.close({ id: PANE })
  } catch {
    // App-Dienst noch nicht verbunden: der nächste Takt versucht es erneut.
  }
}

// Takt in jedem Chat: gemeinsamen Stand aus dem Speicher übernehmen; ist er alt, selbst auffrischen.
// Der Wächter läuft nur bei offenem Panel.
async function tick($: EngineInterface) {
  if (wantPane === null) await autoOpen($)
  const had = project
  const p = (await currentProject($)).project
  if (!p) {
    // Einstellungsdatei entfernt oder kaputt: alten Stand nicht stehen lassen.
    if (had) {
      await setBand($, () => ({ at: '', items: [] }))
      await refresh($, true)
    }
    showStatus($, undefined)
    return
  }
  // Schalter aus der zentralen Datei sofort anwenden, unabhängig davon, ob die Abfragen danach gelingen.
  await setBand($, b => ({ ...b, mode: global.band }))
  if (!global.statusbar) showStatus($, undefined)
  const pollMs = p.cfg.settings.pollMinutes * 60_000
  const paneOpen = (await $.ui.panes()).some(x => x.id === PANE)
  const stored = (await $.store.get(storeKey.band(p))) as Band | undefined
  const ageMs = stored?.at ? Date.now() - Date.parse(stored.at) : Infinity
  // Das Panel richtet sich nach seinem eigenen letzten Durchgang, nicht nach der gemeinsamen Statuszeile.
  if (paneOpen && Date.now() - lastFull > pollMs - 10_000) return refresh($, true)
  if (ageMs > Math.max(BAND_MAX_AGE_MS, pollMs)) {
    const lock = (await $.store.get(storeKey.lock(p))) as string | undefined
    if (lock && Date.now() - Date.parse(lock) < 60_000) return
    await $.store.set(storeKey.lock(p), new Date().toISOString())
    return refresh($, false)
  }
  if (stored) await setBand($, () => ({ ...stored, mode: global.band }))
  // Eigenen Titel nachladen: er kann sich geändert haben, auch wenn ein anderer Chat die Zeile frisch hält.
  if (global.statusbar) {
    try {
      selfTitle = String((await getSelf($)).title ?? selfTitle)
    } catch {
      // App-Dienst noch nicht verbunden: alten Titel behalten.
    }
  }
  showStatus($, stored)
}

async function refresh($: EngineInterface, withGuard = true): Promise<void> {
  if (busy) {
    again = again === true || withGuard
    return
  }
  busy = true
  try {
    const { project: p, error } = await currentProject($)
    if (!p) {
      await setSnapshot($, s => ({ ...s, config: null, configError: error, at: new Date().toISOString() }))
      return
    }
    const cfg = p.cfg
    const { chats, selfId: id, complete } = await listChats($, cfg.project, p.others)
    selfId = id
    await markStatus($, p, chats, selfId)
    const b = await publishBand($, p, chats, global.band)
    selfTitle = chats.find(c => c.id === selfId)?.title ?? selfTitle
    showStatus($, b)

    // Beim ersten Stand in einem Chat dessen Bereich und Unterordner aufklappen, die anderen zu;
    // danach gilt, was der Nutzer selbst auf- und zuklappt.
    const current = chats.find(c => c.id === selfId)
    if (current && expandedFor !== current.id) {
      expandedFor = current.id
      const sub = parse(current.title)?.sub
      const want = [areaOf(cfg, current), ...(sub ? [sub] : [])]
      await setOpen($, list => [...list.filter(k => !/^\d{2}(-\d{2})?$/.test(k)), ...want])
    }
    if (!withGuard) return

    // Chats zuerst zeigen; fällt der Wächter aus (z. B. Ordnerdienst nicht verbunden), bleibt die Liste sichtbar.
    lastFull = Date.now()
    await setSnapshot($, s => ({ ...s, chats, selfId, config: cfg, configError: error, at: new Date().toISOString(), error: '' }))
    try {
      const plan = planGuard(cfg, chats, await listGroups($), Date.now())
      // Selbst ordnen nur, wenn es eingeschaltet ist, dieser Chat das Panel sicher bekommt (kein geplanter Lauf,
      // nicht geschlossen), die Chatliste vollständig ist und gerade kein anderer Chat dieses Projekts ordnet.
      const lock = (await $.store.get(storeKey.guard(p))) as { by: string; at: string } | undefined
      const free = !lock || lock.by === selfId || Date.now() - Date.parse(lock.at) > 50_000
      const mayFix = cfg.settings.autoFix && wantPane === true && complete && free
      if (mayFix && plan.actions.length > 0) await $.store.set(storeKey.guard(p), { by: selfId, at: new Date().toISOString() })
      const why = !cfg.settings.autoFix
        ? 'Selbst-Ordnen aus'
        : !complete
          ? 'mehr als 300 Chats, Liste unvollständig'
          : wantPane !== true
            ? 'Panel in diesem Chat nicht aktiv'
            : 'anderer Chat ordnet gerade'
      const { done, fixed, failed } = mayFix
        ? await runActions($, plan.actions)
        : { done: [], fixed: [], failed: plan.actions.map(a => failedFinding(a, why)) }
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
      for (const num of skipped) failed.push({ kind: 'Nummer doppelt', text: `${num} ist im Register schon vergeben`, chatId: added[num]?.session ?? '' })
      await setSnapshot($, s => ({
        ...s,
        findings: [...failed, ...plan.findings],
        fixed,
        chats: s.chats.map(c => (renamed.has(c.id) ? { ...c, title: renamed.get(c.id) ?? c.title } : c)),
        config: s.config ? { ...s.config, register: { ...s.config.register, ...added } } : s.config,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await setSnapshot($, s => ({ ...s, error: `Prüfung nicht möglich: ${msg}` }))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await setSnapshot($, s => ({ ...s, at: new Date().toISOString(), error: msg }))
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
    await $.command.register({ name: 'navigator', description: 'Chat-Navigator öffnen' })
    void tick($)
    $.clock.every(TICK_MS, () => void tick($))
    return next(e)
  })

  // Beim Wechsel in diesen Chat: Panel öffnen oder, wenn es schon offen ist, sofort neu laden.
  // Ein Chat, der im Hintergrund startete, bekommt sein Fenster erst hier.
  on('session.attach', async ($, e, next) => {
    const out = await next(e)
    void (async () => {
      const wasOpen = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
      await openIfWanted($)
      if (wasOpen) await refresh($, true)
    })().catch(() => undefined)
    return out
  })

  // Hat der Nutzer das Panel in einem Chat geschlossen, bleibt es dort zu, bis er /navigator tippt.
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
    await $.ui.open({ id: PANE, title: TITLE })
    void refresh($, true)
    return { text: 'Chat-Navigator geöffnet.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => renderBand($, e, next, () => project))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => renderPane($, e, { refresh: () => refresh($, true), project: () => project }))
}
