import type { RenderElement } from 'claude-code'

import type { Band, BandItem } from '../types'
import { texts } from './i18n'
import type { UI } from './pane'

// Line above the prompt: who waits, what is new, how many are working.
// Draws only, from the band it is given; `open` comes from register.tsx, which does all the work with the app.
// Returns null when the line stays empty, so the app draws its own.

const AMBER = '#EF9F27'
const BLUE = '#378ADD'
const GREEN = '#1D9E75'

export function bandView(ui: UI, b: Band, open: (i: BandItem) => () => Promise<void>): RenderElement | null {
  const t = texts(b.lang ?? 'en')
  // Mode from the central file: off, only while something is open (default), always.
  const mode = b.mode ?? 'active'
  if (mode === 'off' || b.at === '') return null
  const waiting = b.items.filter(i => i.state === 'waiting')
  const fresh = b.items.filter(i => i.state === 'new')
  const working = b.items.filter(i => i.state === 'working')
  const empty = waiting.length + fresh.length + working.length === 0
  if (empty && mode === 'active') return null
  const { Box, Text, Button } = ui
  if (empty) return <Text dimColor>{t.bandNothing}</Text>
  const chip = (i: BandItem, color: string) => (
    <Box key={`bx:${i.id}:${i.state}`} flexDirection="row" alignItems="center">
      <Text color={color}>●</Text>
      <Button key={`band:${i.id}:${i.state}`} plain onPress={open(i)} label={i.num || i.title.slice(0, 24)} />
    </Box>
  )
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
      {waiting.length > 0 && <Text color={AMBER}>{t.bandWaiting}</Text>}
      {waiting.slice(0, 5).map(i => chip(i, AMBER))}
      {fresh.length > 0 && <Text color={BLUE}>{t.bandNew}</Text>}
      {fresh.slice(0, 5).map(i => chip(i, BLUE))}
      {fresh.length > 5 && <Text dimColor>+{fresh.length - 5}</Text>}
      {working.length > 0 && <Text color={GREEN}>{t.bandWorking(working.length)}</Text>}
    </Box>
  )
}
