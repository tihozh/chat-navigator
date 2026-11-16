import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { normalizeConfig } from '../hooks/logic'

// Erfundene Daten. Der Zustand wird so vorgegeben, wie ihn der Navigator nach einem Durchgang hält.

const PANE = {
  plugin: 'chat-navigator',
  component: 'Pane',
  requestId: 'chat-navigator',
  props: { title: 'Chat-Navigator', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const r = normalizeConfig({
  name: 'Gartenprojekt',
  project: '/home/demo/garten',
  areas: [{ id: '01', name: 'Planung', subs: [{ id: '01-01', name: 'Beete' }] }],
})
const cfg = 'cfg' in r ? r.cfg : null
const last = new Date(Date.now() - 3 * 3_600_000).toISOString()

const SNAP: Snapshot = {
  chats: [
    { id: 'me', title: '01-01-01 · Tomaten', group: '01 Planung', groupId: 'g1', isRunning: false, last, link: 'claude://x/me', parent: '' },
    { id: 'o', title: '01-01-02 · Gurken', group: '01 Planung', groupId: 'g1', isRunning: true, last, link: 'claude://x/o', parent: '' },
  ],
  at: last,
  error: '',
  findings: [{ kind: 'Ohne Nummer', text: 'Lose Idee', chatId: 'z' }],
  fixed: [],
  selfId: 'me',
  config: cfg,
  configError: '',
}

test('ohne eingerichtetes Projekt zeigt das Panel den Weg zur Einrichtung', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /chat-navigator:setup/ }))?.text).toContain('/chat-navigator:setup')
    await ui.unmount()
  }
})

test('das Panel zeigt Projekt, Dieser Chat, Zuletzt bearbeitet und Zu klären', async ($, on) => {
  on('state.get', (_, e) => (e.key === 'snapshot' ? { value: { value: { shape: 'snapshot-3', value: SNAP }, version: 1 } } : { value: { value: undefined, version: 0 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Gartenprojekt' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'Dieser Chat' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'Zuletzt bearbeitet' })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: 'arbeitet' })).toBeTruthy()
    expect(await ui.find({ key: 'findings' })).toBeTruthy()
    await ui.unmount()
  }
})
