import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { BandItem } from '../types'
import type { Project } from './config'
import { getBand, markSeen } from './state'

// Statuszeile über dem Eingabefeld: wer wartet, was ist neu, wie viele arbeiten.
// Zeichnet nur; geschrieben wird erst im Klick.

const AMBER = '#EF9F27'
const BLUE = '#378ADD'
const GREEN = '#1D9E75'

export async function renderBand(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt'>,
  next: (e: RenderInput<'AbovePrompt'>) => Promise<RenderElement>,
  project: () => Project | null,
): Promise<RenderElement> {
  if (e.props.hasSurvey) return next(e)
  const b = await getBand($)
  // Modus aus der zentralen Datei: aus, nur wenn etwas offen ist (Standard), immer.
  const mode = b.mode ?? 'offen'
  if (mode === 'aus' || b.at === '') return next(e)
  const waiting = b.items.filter(i => i.state === 'wartet')
  const fresh = b.items.filter(i => i.state === 'neu')
  const working = b.items.filter(i => i.state === 'arbeitet')
  const empty = waiting.length + fresh.length + working.length === 0
  if (empty && mode === 'offen') return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  if (empty) return <Text dimColor>Chat-Navigator: nichts offen</Text>
  const go = (i: BandItem) => async () => {
    if (!i.link.startsWith('claude://')) return
    const r = await $.process.run(['open', i.link])
    if (r.exitCode === 0) await markSeen($, project(), i.id)
  }
  const chip = (i: BandItem, color: string) => (
    <Box key={`bx:${i.id}:${i.state}`} flexDirection="row" alignItems="center">
      <Text color={color}>●</Text>
      <Button key={`band:${i.id}:${i.state}`} plain onPress={go(i)} label={i.num || i.title.slice(0, 24)} />
    </Box>
  )
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
      {waiting.length > 0 && <Text color={AMBER}>Wartet:</Text>}
      {waiting.slice(0, 5).map(i => chip(i, AMBER))}
      {fresh.length > 0 && <Text color={BLUE}>Neu:</Text>}
      {fresh.slice(0, 5).map(i => chip(i, BLUE))}
      {fresh.length > 5 && <Text dimColor>+{fresh.length - 5}</Text>}
      {working.length > 0 && <Text color={GREEN}>{working.length} arbeiten</Text>}
    </Box>
  )
}
