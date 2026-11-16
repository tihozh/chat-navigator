import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Band, BandMode, Chat, Lang, Snapshot } from '../types'
import type { Project } from './config'
import { listEvents } from './app'
import { ALL_FEATURES, endsWithQuestion, toBandItems, updateSeen } from './logic'

// Values the pane and the band draw ($.state), and markers shared across chats ($.store).

export const PANE = 'chat-navigator'

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
export function getSnapshot($: EngineInterface) {
  return read($, snapshot)
}
export function getOpen($: EngineInterface) {
  return read($, open)
}
export function getBand($: EngineInterface) {
  return read($, band)
}
export function getNote($: EngineInterface) {
  return read($, note)
}
export function getQuery($: EngineInterface) {
  return read($, query)
}
export function setSnapshot($: EngineInterface, fn: (s: Snapshot) => Snapshot) {
  return update($, snapshot, fn)
}
export function setOpen($: EngineInterface, fn: (l: string[]) => string[]) {
  return update($, open, fn)
}
export function setBand($: EngineInterface, fn: (b: Band) => Band) {
  return update($, band, fn)
}
export function setNote($: EngineInterface, text: string) {
  return update($, note, () => text)
}
export function setQuery($: EngineInterface, text: string) {
  return update($, query, () => text)
}

// Keys in the shared store, separate per project. The shared band carries no mode or language:
// each chat adds its own when it takes the band over.
export const storeKey = {
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
export async function markStatus($: EngineInterface, p: Project, chats: Chat[], selfId: string): Promise<void> {
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
export async function markSeen($: EngineInterface, p: Project | null, id: string): Promise<void> {
  if (p) {
    const seen = await getSeen($, p)
    seen[id] = new Date().toISOString()
    await $.store.set(storeKey.seen(p), seen)
  }
  await setBand($, b => ({ ...b, items: b.items.filter(i => !(i.id === id && i.state === 'new')) }))
  await setSnapshot($, s => ({ ...s, chats: s.chats.map(x => (x.id === id ? { ...x, isNew: false } : x)) }))
}

export async function publishBand($: EngineInterface, p: Project, chats: Chat[], mode: BandMode, lang: Lang): Promise<Band> {
  const b: Band = { at: new Date().toISOString(), items: toBandItems(chats) }
  await $.store.set(storeKey.band(p), b)
  await setBand($, () => ({ ...b, mode, lang }))
  return b
}

export async function getClosed($: EngineInterface): Promise<string[]> {
  return ((await $.store.get(storeKey.closed)) as string[] | undefined) ?? []
}
