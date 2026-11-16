import { expect, test } from 'claude-code/testing'

import type { Band } from '../types'

// Erfundene Daten: die Zeile über dem Eingabefeld in ihren drei Modi.

const BAND = {
  plugin: 'chat-navigator',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const at = new Date().toISOString()
const waiting: Band = { at, items: [{ id: 'x', num: '01-01-02', title: 'Gurken', link: 'claude://x', state: 'wartet' }] }

// Antwort auf state.get: die Zeile bekommt `b`, alles andere ist leer.
const bandGet = (b: Band) => (_: unknown, e: { key: string }) =>
  e.key === 'band' ? { value: { value: { shape: 'band-1', value: b }, version: 1 } } : { value: { value: undefined, version: 0 } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Modus «offen» zeigt Wartende`, async ($, on) => {
    on('state.get', bandGet({ ...waiting, mode: 'offen' }))
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Wartet:' })).toBeTruthy()
    await ui.unmount()
  })

  test(`${surface}: Modus «aus» zeigt nichts vom Navigator`, async ($, on) => {
    on('state.get', bandGet({ ...waiting, mode: 'aus' }))
    // Steht für die App: was sie ohne den Navigator zeichnen würde.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>App</Text>
    })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'Wartet:' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: 'App' })).toBeTruthy()
    await ui.unmount()
  })

  test(`${surface}: Modus «immer» meldet auch, wenn nichts offen ist`, async ($, on) => {
    on('state.get', bandGet({ at, items: [], mode: 'immer' }))
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /nichts offen/ })).toBeTruthy()
    await ui.unmount()
  })
}
