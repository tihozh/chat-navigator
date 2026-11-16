import { expect, test } from 'claude-code/testing'

import type { Lang, Snapshot } from '../types'
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

const snap = (lang: Lang): Snapshot => ({
  chats: [
    { id: 'me', title: '01-01-01 · Tomatoes', group: '01 Planning', groupId: 'g1', isRunning: false, last, link: 'claude://x/me', parent: '' },
    { id: 'o', title: '01-01-02 · Cucumbers', group: '01 Planning', groupId: 'g1', isRunning: true, last, link: 'claude://x/o', parent: '' },
  ],
  at: last,
  error: '',
  findings: [{ kind: 'noNumber', chatId: 'z', title: 'Loose idea' }],
  fixed: [],
  selfId: 'me',
  config: cfg,
  configError: '',
  lang,
})

// Answer to state.get: the pane gets `s`, everything else is empty.
const snapshotGet = (s: Snapshot) => (_: unknown, e: { key: string }) =>
  e.key === 'snapshot' ? { value: { value: { shape: 'snapshot-4', value: s }, version: 1 } } : { value: { value: undefined, version: 0 } }

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
