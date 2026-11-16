import { expect, test } from 'claude-code/testing'

import type { Band } from '../types'

// Made-up data: the line above the prompt in its three modes.

const BAND = {
  plugin: 'chat-navigator',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const at = new Date().toISOString()
const waiting: Band = { at, items: [{ id: 'x', num: '01-01-02', title: 'Gurken', link: 'claude://x', state: 'waiting' }] }

// Answer to state.get: the band gets `b`, everything else is empty.
const bandGet = (b: Band) => (_: unknown, e: { key: string }) =>
  e.key === 'band' ? { value: { value: { shape: 'band-2', value: b }, version: 1 } } : { value: { value: undefined, version: 0 } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: mode «active» shows waiting chats`, async ($, on) => {
    on('state.get', bandGet({ ...waiting, mode: 'active' }))
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Waiting:' })).toBeTruthy()
    await ui.unmount()
  })

  test(`${surface}: mode «off» leaves the line to the app`, async ($, on) => {
    on('state.get', bandGet({ ...waiting, mode: 'off' }))
    // Stands for the app: what it draws without the navigator.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>App</Text>
    })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Waiting:' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'App' })).toBeTruthy()
    await ui.unmount()
  })

  test(`${surface}: mode «always» also shows when nothing is open`, async ($, on) => {
    on('state.get', bandGet({ at, items: [], mode: 'always' }))
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /nothing open/ })).toBeTruthy()
    await ui.unmount()
  })
}

test('the line speaks German when configured', async ($, on) => {
  on('state.get', bandGet({ ...waiting, mode: 'active', lang: 'de' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Wartet:' })).toBeTruthy()
  await ui.unmount()
})
