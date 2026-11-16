import { expect, test } from 'claude-code/testing'

import type { Features, Lang, Snapshot } from '../types'
import { normalizeConfig } from '../hooks/logic'

// Made-up data. The state is given as the navigator holds it after a pass.

const PANE = {
  plugin: 'chat-navigator',
  component: 'Pane',
  requestId: 'chat-navigator',
  props: { title: 'Chat Navigator', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const r = normalizeConfig({
  name: 'Garden',
  project: '/home/demo/garden',
  areas: [{ id: '01', name: 'Planning', subs: [{ id: '01-01', name: 'Beds' }] }],
})
const cfg = 'cfg' in r ? r.cfg : null
const last = new Date(Date.now() - 3 * 3_600_000).toISOString()

const ALL: Features = { search: true, week: true, cleanup: true }
const old = new Date(Date.now() - 40 * 86_400_000).toISOString()

const snap = (lang: Lang, features: Features = ALL): Snapshot => ({
  chats: [
    { id: 'me', title: '01-01-01 · Tomatoes', group: '01 Planning', groupId: 'g1', isRunning: false, last, link: 'claude://x/me', parent: '' },
    { id: 'o', title: '01-01-02 · Cucumbers', group: '01 Planning', groupId: 'g1', isRunning: true, last, link: 'claude://x/o', parent: '' },
    { id: 'z', title: '01-01-03 · Old idea', group: '01 Planning', groupId: 'g1', isRunning: false, last: old, link: 'claude://x/z', parent: '' },
  ],
  at: last,
  error: '',
  findings: [{ kind: 'noNumber', chatId: 'z', title: 'Loose idea' }],
  fixed: [],
  selfId: 'me',
  config: cfg,
  configError: '',
  lang,
  features,
})

// Answer to state.get: the pane gets `s`, everything else is empty.
const snapshotGet = (s: Snapshot) => (_: unknown, e: { key: string }) =>
  e.key === 'snapshot' ? { value: { value: { shape: 'snapshot-5', value: s }, version: 1 } } : { value: { value: undefined, version: 0 } }

test('without a configured project the pane points to the setup', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /chat-navigator:setup/ }))?.text).toContain('/chat-navigator:setup')
    await ui.unmount()
  }
})

test('the pane shows project, this chat, recently active and to clarify, in English', async ($, on) => {
  on('state.get', snapshotGet(snap('en')))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Garden' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'This chat' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'Recently active' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'working' })).toBeTruthy()
    expect((await ui.find({ key: 'findings' }))?.text).toBe('1 to clarify')
    await ui.unmount()
  }
})

test('the pane speaks German when configured', async ($, on) => {
  on('state.get', snapshotGet(snap('de')))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Dieser Chat' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: 'Zuletzt bearbeitet' })).toBeTruthy()
  expect((await ui.find({ key: 'findings' }))?.text).toBe('1 zu klären')
  await ui.unmount()
})

// Answer to state.get with a pane snapshot, a search text and the expanded parts.
const stateGet = (s: Snapshot, query = '', open: string[] = []) => (_: unknown, e: { key: string }) => {
  if (e.key === 'snapshot') return { value: { value: { shape: 'snapshot-5', value: s }, version: 1 } }
  if (e.key === 'query') return { value: { value: query, version: 1 } }
  if (e.key === 'open') return { value: { value: { shape: 'open-3', value: open }, version: 1 } }
  return { value: { value: undefined, version: 0 } }
}

test('search, week and cleanup are there by default', async ($, on) => {
  on('state.get', stateGet(snap('en')))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'search' })).toBeTruthy()
  expect((await ui.find({ key: 'week' }))?.text).toBe('Review')
  expect((await ui.find({ key: 'cleanup' }))?.text).toBe('Clean up 1')
  await ui.unmount()
})

test('each part can be switched off', async ($, on) => {
  on('state.get', stateGet(snap('en', { search: false, week: false, cleanup: false })))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'search' })).toBe(undefined)
  expect(await ui.find({ key: 'week' })).toBe(undefined)
  expect(await ui.find({ key: 'cleanup' })).toBe(undefined)
  await ui.unmount()
})

test('a search shows only matching chats', async ($, on) => {
  on('state.get', stateGet(snap('en'), 'cucu'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '1 result' })).toBeTruthy()
  expect(await ui.find({ key: 'chat:o' })).toBeTruthy()
  expect(await ui.find({ key: 'chat:me' })).toBe(undefined)
  await ui.unmount()
})

test('week and cleanup sections open', async ($, on) => {
  on('state.get', stateGet(snap('de'), '', ['__week', '__cleanup']))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Am meisten bearbeitet diese Woche' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /2 Chats in 1 Bereich/ })).toBeTruthy()
  expect((await ui.find({ key: 'wb:01' }))?.text).toBe('Planning')
  expect((await ui.find({ key: 'cleanup-go' }))?.text).toBe('1 in die Ablage')
  await ui.unmount()
})

test('clean up stays visible when there is nothing to do', async ($, on) => {
  const s = snap('de')
  on('state.get', stateGet({ ...s, chats: s.chats.filter(c => c.id !== 'z') }, '', ['__cleanup']))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'cleanup' }))?.text).toBe('Aufräumen')
  expect(await ui.find({ type: 'Text', text: /Nichts aufzuräumen/ })).toBeTruthy()
  expect(await ui.find({ key: 'cleanup-go' })).toBe(undefined)
  await ui.unmount()
})

test('a review row opens its chats of the week', async ($, on) => {
  on('state.get', stateGet(snap('en'), '', ['__week', '__week:01']))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Most worked on this week' })).toBeTruthy()
  expect((await ui.findAll({ key: 'chat:o' })).length).toBeGreaterThan(0)
  await ui.unmount()
})
