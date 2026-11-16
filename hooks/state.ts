import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Band, BandMode, Chat, Snapshot } from '../types'
import { endsWithQuestion, toBandItems, updateSeen } from './logic'
import type { Project } from './config'
import { listEvents } from './app'

// Werte, die Panel und Statuszeile zeichnen ($.state), und Merker über Chats hinweg ($.store).

export const PANE = 'chat-navigator'

const EMPTY: Snapshot = { chats: [], at: '', error: '', findings: [], fixed: [], selfId: '', config: null, configError: '' }

const snapshot = atom({ plugin: 'chat-navigator', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-3' })
const open = atom({ plugin: 'chat-navigator', key: 'open' } as const, [] as string[], { shape: 'open-3' })
const band = atom({ plugin: 'chat-navigator', key: 'band' } as const, { at: '', items: [] } as Band, { shape: 'band-1' })
const note = atom({ plugin: 'chat-navigator', key: 'note' } as const, '')

// Lesen (auch beim Zeichnen) und Schreiben (nur aus Klicks und Ereignissen, nie beim Zeichnen).
// Die Prüfung der App verlangt, dass read/update ihre Werte in derselben Datei sehen: darum hier gebündelt.
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

// Schlüssel im gemeinsamen Speicher, je Projekt getrennt.
export const storeKey = {
  band: (p: Project) => `band:${p.key}`,
  lock: (p: Project) => `band-lock:${p.key}`,
  seen: (p: Project) => `seen:${p.key}`,
  guard: (p: Project) => `guard-lock:${p.key}`,
  closed: 'closed',
}

async function getSeen($: EngineInterface, p: Project): Promise<Record<string, string>> {
  return ((await $.store.get(storeKey.seen(p))) as Record<string, string> | undefined) ?? {}
}

// «Wartet auf dich» je Chat nur neu prüfen, wenn sich etwas getan hat.
const waitCache = new Map<string, { last: string; waiting: boolean }>()

async function isWaiting($: EngineInterface, c: Chat): Promise<boolean> {
  const hit = waitCache.get(c.id)
  if (hit && hit.last === c.last) return hit.waiting
  const waiting = endsWithQuestion(await listEvents($, c.id))
  waitCache.set(c.id, { last: c.last, waiting })
  return waiting
}

// Setzt `isNew` und `isWaiting` an den Chats und führt die Merkliste nach.
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

// Ein Chat wurde geöffnet: nicht mehr «neu».
export async function markSeen($: EngineInterface, p: Project | null, id: string): Promise<void> {
  if (p) {
    const seen = await getSeen($, p)
    seen[id] = new Date().toISOString()
    await $.store.set(storeKey.seen(p), seen)
  }
  await setBand($, b => ({ ...b, items: b.items.filter(i => !(i.id === id && i.state === 'neu')) }))
  await setSnapshot($, s => ({ ...s, chats: s.chats.map(x => (x.id === id ? { ...x, isNew: false } : x)) }))
}

export async function publishBand($: EngineInterface, p: Project, chats: Chat[], mode: BandMode): Promise<Band> {
  const b: Band = { at: new Date().toISOString(), items: toBandItems(chats) }
  await $.store.set(storeKey.band(p), b)
  await setBand($, () => ({ ...b, mode }))
  return b
}

export async function getClosed($: EngineInterface): Promise<string[]> {
  return ((await $.store.get(storeKey.closed)) as string[] | undefined) ?? []
}
