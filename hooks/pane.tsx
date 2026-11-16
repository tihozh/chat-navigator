import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Area, Chat } from '../types'
import type { Project } from './config'
import { findingText, locale, texts } from './i18n'
import { ALL_FEATURES, age, areaOf, SMALL_TEXT_BELOW, cleanupCandidates, isSteering, nextNumber, paneSize, parse, searchChats, weekBar, weekSummary, withPlannedTitles } from './logic'
import { getNote, getOpen, getQuery, getSnapshot, markSeen, setNote, setOpen, setQuery } from './state'

// The pane: this chat, recently active, areas with sub-folders, to clarify.
// Draws only; anything is written in the click handlers.

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICONS = {
  folder: (c: string) => svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="${c}" fill-opacity="0.25" stroke="${c}"/>`),
  open: (c: string) =>
    svg(`<path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" stroke="${c}"/><path d="M3 17l2.5-6.2A1.5 1.5 0 0 1 6.9 10H21l-3 7.2a1.5 1.5 0 0 1-1.4.8H4.5A1.5 1.5 0 0 1 3 17z" fill="${c}" fill-opacity="0.35" stroke="${c}"/>`),
}
// Colours (work in light and dark mode)
const C = {
  card: 'rgba(128,128,128,0.08)',
  cardOpen: 'rgba(55,138,221,0.10)',
  badge: 'rgba(128,128,128,0.16)',
  badgeOpen: 'rgba(55,138,221,0.22)',
  blue: '#378ADD',
  green: '#1D9E75',
  greenBg: 'rgba(29,158,117,0.18)',
  amber: '#EF9F27',
  amberBg: 'rgba(239,159,39,0.18)',
  gray: '#888780',
  violet: '#7F77DD',
  newBg: 'rgba(55,138,221,0.18)',
}

export async function renderPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  deps: { refresh: () => Promise<void>; project: () => Project | null; archive: (ids: string[]) => Promise<number> },
): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button, Input } = ui
  const Svg = 'Svg' in ui ? ui.Svg : null
  const snap = await getSnapshot($)
  const expanded = await getOpen($)
  const hint = await getNote($)
  const rawQuery = await getQuery($)
  const query = rawQuery.trim()
  const cfg = snap.config
  const selfId = snap.selfId
  const lang = snap.lang ?? 'en'
  const features = snap.features ?? ALL_FEATURES
  const t = texts(lang)
  const now = Date.now()
  // Three stages by width (see `paneSize`): standard, small, mini.
  const cols = e.props.bodyColumns ?? 120
  const size = paneSize(cols)
  const mini = size === 'mini'
  const narrow = size !== 'standard'
  const compact = mini
  const py = narrow ? 0 : 1
  const smallText = cols < SMALL_TEXT_BELOW
  const fs = smallText ? 'footnote' : 'body'
  const fsMeta = smallText ? 'caption' : 'body'
  const barWidth = mini ? 0 : narrow ? 6 : 12

  // A pressable text whose size follows the width (a Button has no size of its own, its Text child has).
  // Titles never wrap: they are cut at the end with «…».
  const link = (key: string, onPress: () => unknown, text: string) => (
    <Button key={key} plain onPress={onPress}>
      <Text size={fs} wrap="truncate-end">{text}</Text>
    </Button>
  )

  const toggle = (key: string) => () => setOpen($, list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]))

  const openChat = (chat: Chat) => async () => {
    if (!chat.link.startsWith('claude://')) {
      await setNote($, t.openFailed(t.noLink(chat.title)))
      return
    }
    try {
      const r = await $.process.run(['open', chat.link])
      if (r.exitCode !== 0) {
        await setNote($, t.openFailed(t.openExit(r.exitCode)))
        return
      }
      await markSeen($, deps.project(), chat.id)
      await setNote($, '')
    } catch (err) {
      await setNote($, t.openFailed((err instanceof Error ? err.message : String(err)).slice(0, 160)))
    }
  }

  const copyNumber = (num: string) => async () => {
    await $.ui.copy({ text: `${num} · `, surface: e.surface })
    await setNote($, t.copied(num))
  }

  const icon = (kind: 'folder' | 'open', color: string, size = 16) =>
    Svg ? <Svg source={ICONS[kind](color)} alt={kind === 'open' ? t.folderOpen : t.folder} width={size} height={size} /> : <Text color={color}>{kind === 'open' ? '▾' : '▸'}</Text>

  const chip = (text: string, fg: string, bg: string) => (
    <Box backgroundColor={bg} paddingX={1}>
      <Text color={fg} size={fsMeta}>{text}</Text>
    </Box>
  )

  // No matching project: point to the setup instead of showing an empty pane.
  if (!cfg) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        <Text weight="semibold" size="title">{t.appName}</Text>
        {snap.configError !== '' && <Text color="error">{snap.configError}</Text>}
        <Text>{t.noProject}</Text>
        <Text color={C.gray} size={fsMeta}>{t.setupHint}</Text>
        <Button key="refresh" plain onPress={deps.refresh} label={t.reload} />
      </Box>
    )
  }

  const { chats, planned } = withPlannedTitles(cfg, snap.chats)

  // One chat row: dot, number, title (clickable), time on the right.
  const chatRow = (c: Chat, indent: number, showNum = true) => {
    const p = parse(c.title)
    const steer = p ? isSteering(p.num) : false
    const dotColor = c.isRunning ? C.green : c.isWaiting ? C.amber : c.isNew ? C.blue : steer ? C.violet : C.gray
    return (
      <Box key={`r:${c.id}:${indent}`} flexDirection="row" alignItems="center" paddingLeft={indent} paddingY={py} gap={1} backgroundColor={c.id === selfId ? C.cardOpen : undefined}>
        <Text color={dotColor}>{steer ? '◆ ' : '● '}</Text>
        {showNum && !mini && p && <Text mono color={C.gray} size={fsMeta}>{p.num}</Text>}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {link(`chat:${c.id}`, openChat(c), p ? p.rest : c.title)}
        </Box>
        {/* Time and state never wrap and never shrink: the title in front of them is cut instead.
            In mini the dot colour shows the state, so only the time stays. */}
        {mini ? (
          <Box flexShrink={0}>
            <Text color={c.isRunning ? C.green : c.isWaiting ? C.amber : c.isNew ? C.blue : C.gray} size={fsMeta} wrap="truncate-end">
              {c.isRunning ? '…' : age(c.last, now, lang)}
            </Text>
          </Box>
        ) : (
          <Box flexShrink={0}>
            {c.isRunning ? (
              <Text color={C.green} size={fsMeta} wrap="truncate-end">{t.working}</Text>
            ) : c.isWaiting ? (
              <Text color={C.amber} size={fsMeta} wrap="truncate-end">{t.waiting}  {age(c.last, now, lang)}</Text>
            ) : c.isNew ? (
              <Text color={C.blue} size={fsMeta} wrap="truncate-end">{t.isNew}  {age(c.last, now, lang)}</Text>
            ) : (
              <Text color={C.gray} size={fsMeta} wrap="truncate-end">{age(c.last, now, lang)}</Text>
            )}
          </Box>
        )}
      </Box>
    )
  }

  const recent = [...chats].sort((a, b) => b.last.localeCompare(a.last)).slice(0, cfg.settings.recent)
  const current = chats.find(c => c.id === selfId)
  // Archive and runs show as areas of their own when chats are there, even if they are not configured.
  const extra: Area[] = [
    { id: cfg.archive.area, name: t.archiveArea, subs: [] },
    { id: cfg.runs.area, name: t.runsArea, subs: [] },
  ].filter(x => !cfg.areas.some(a => a.id === x.id) && chats.some(c => areaOf(cfg, c) === x.id))
  const areas = [...cfg.areas, ...extra]
  const results = features.search && query !== '' ? searchChats(chats, query) : null
  const candidates = features.cleanup ? cleanupCandidates(cfg, chats, selfId, now) : []
  const week = features.week && expanded.includes('__week') ? weekSummary(cfg, chats, now) : null

  const archiveAll = async () => {
    const n = await deps.archive(candidates.map(c => c.id))
    await setOpen($, list => list.filter(k => k !== '__cleanup'))
    await setNote($, t.cleanupDone(n))
  }
  const inArea = (a: Area) => chats.filter(c => areaOf(cfg, c) === a.id)
  const unplaced = chats.filter(c => !areas.some(a => areaOf(cfg, c) === a.id))

  const areaCard = (a: Area) => {
    const list = inArea(a)
    const isOpen = expanded.includes(a.id)
    const running = list.filter(c => c.isRunning).length
    const waitingN = list.filter(c => c.isWaiting).length
    const newN = list.filter(c => c.isNew && !c.isWaiting).length
    const steering = list.filter(c => parse(c.title)?.num === `${a.id}-00`)
    const loose = list
      .filter(c => {
        const p = parse(c.title)
        // Without a sub-folder, or with one that is not configured: show it loose in the area.
        return (!p || !p.sub || !a.subs.some(s => s.id === p.sub)) && !steering.includes(c)
      })
      .sort((x, y) => y.last.localeCompare(x.last))
    return (
      <Box key={`a:${a.id}`} flexDirection="column" marginBottom={compact ? 0 : 1}>
        <Box
          flexDirection="row"
          alignItems="center"
          backgroundColor={isOpen ? C.cardOpen : C.card}
          borderStyle={compact ? undefined : 'round'}
          borderColor={isOpen ? C.blue : 'subtle'}
          paddingX={compact ? 0 : 2}
          paddingY={py}
          gap={compact ? 1 : 2}
        >
          <Box backgroundColor={isOpen ? C.badgeOpen : C.badge} paddingX={1}>
            <Text mono weight="semibold" color={isOpen ? C.blue : undefined}>{a.id}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {link(`area:${a.id}`, toggle(a.id), a.name)}
          </Box>
          {!mini && running > 0 && chip(t.countWorking(running), C.green, C.greenBg)}
          {!mini && waitingN > 0 && chip(t.countWaiting(waitingN), C.amber, C.amberBg)}
          {!mini && newN > 0 && chip(t.countNew(newN), C.blue, C.newBg)}
          <Box flexShrink={0}>
            <Text color={C.gray} size={fsMeta} wrap="truncate-end">{compact ? list.length : t.chats(list.length)}</Text>
          </Box>
          <Text color={C.gray}>{isOpen ? '⌄' : '›'}</Text>
        </Box>
        {isOpen && (
          <Box flexDirection="column" marginLeft={compact ? 2 : 4} marginTop={py} marginBottom={py}>
            {steering.map(c => chatRow(c, 1))}
            {a.subs.map(s => {
              const subChats = list.filter(c => parse(c.title)?.sub === s.id).sort((x, y) => x.title.localeCompare(y.title, locale(lang)))
              const subOpen = expanded.includes(s.id)
              const next = nextNumber(cfg.register, chats, s.id)
              return (
                <Box key={`s:${s.id}`} flexDirection="column">
                  <Box flexDirection="row" alignItems="center" gap={1} paddingY={py}>
                    {icon(subOpen ? 'open' : 'folder', subOpen ? C.blue : C.gray, 20)}
                    <Text mono color={C.gray} size={fsMeta}>{s.id}</Text>
                    <Box flexGrow={1} flexShrink={1} minWidth={0}>
                      {link(`sub:${s.id}`, toggle(s.id), s.name)}
                    </Box>
                    <Text color={C.gray} size={fsMeta}>{subChats.length}</Text>
                    {subOpen && next !== '' && link(`new:${s.id}`, copyNumber(next), `+ ${next}`)}
                  </Box>
                  {subOpen && (
                    <Box flexDirection="column" marginLeft={compact ? 2 : 4}>
                      {subChats.length === 0 && <Text color={C.gray} size={fsMeta}>{t.empty}</Text>}
                      {subChats.map(c => chatRow(c, 1))}
                    </Box>
                  )}
                </Box>
              )
            })}
            {loose.map(c => chatRow(c, 1))}
          </Box>
        )}
      </Box>
    )
  }

  const p = current ? parse(current.title) : null

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" rowGap={0} marginBottom={1}>
        <Box flexGrow={1}>
          <Text weight="semibold" size={smallText ? 'heading' : 'title'} wrap="truncate-end">{cfg.name}</Text>
        </Box>
        {features.week && (
          <Box marginRight={1}>
            {link('week', toggle('__week'), mini ? '📊' : t.week)}
          </Box>
        )}
        {features.cleanup && (
          <Box marginRight={1}>
            {link('cleanup', toggle('__cleanup'), mini ? (candidates.length > 0 ? `🧹 ${candidates.length}` : '🧹') : candidates.length > 0 ? t.cleanup(candidates.length) : t.cleanupLabel)}
          </Box>
        )}
        {snap.findings.length > 0 && (
          <Box backgroundColor={C.amberBg} paddingX={1} marginRight={1}>
            {link('findings', toggle('__findings'), mini ? `⚠ ${snap.findings.length}` : t.toClarifyCount(snap.findings.length))}
          </Box>
        )}
        <Button key="refresh" plain onPress={deps.refresh} label="↻" />
      </Box>

      {snap.error !== '' && <Text color="error">{snap.error}</Text>}
      {snap.configError !== '' && <Text color="error">{snap.configError}</Text>}
      {hint !== '' && <Text color={C.gray} size={fsMeta}>{hint}</Text>}

      {features.search && (
        <Box marginBottom={1}>
          <Input key="search" placeholder={mini ? t.searchShort : t.searchPlaceholder} submitLabel={t.searchSubmit} value={rawQuery} onInput={v => void setQuery($, v)} onSubmit={v => void setQuery($, v)} />
        </Box>
      )}

      {week && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.blue} paddingX={1} marginBottom={1}>
          <Text weight="semibold" color={C.blue}>{t.weekTitle}</Text>
          {week.length === 0 ? (
            <Text color={C.gray} size={fsMeta}>{t.weekEmpty}</Text>
          ) : (
            <Text color={C.gray} size={fsMeta}>{t.weekTotal(week.reduce((n, r) => n + r.chats.length, 0), week.length)}</Text>
          )}
          {week.map(r => {
            const key = `__week:${r.area || 'none'}`
            const isOpen = expanded.includes(key)
            const max = week[0]?.chats.length ?? 0
            return (
              <Box key={`w:${r.area || 'none'}`} flexDirection="column">
                <Box flexDirection="row" alignItems="center" gap={1}>
                  <Box width={4}>
                    <Text mono color={C.gray} size={fsMeta}>{r.area || '··'}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    {link(`wb:${r.area || 'none'}`, toggle(key), r.area ? r.name : t.weekOther)}
                  </Box>
                  {barWidth > 0 && (
                    <Box width={barWidth + 1} flexShrink={0}>
                      <Text color={C.blue} size={fsMeta}>{weekBar(r.chats.length, max, barWidth)}</Text>
                    </Box>
                  )}
                  <Box width={3} flexShrink={0}>
                    <Text color={C.gray} size={fsMeta}>{String(r.chats.length)}</Text>
                  </Box>
                  <Text color={C.gray}>{isOpen ? '⌄' : '›'}</Text>
                </Box>
                {isOpen && (
                  <Box flexDirection="column" marginLeft={2}>
                    {r.chats.map(id => chats.find(c => c.id === id)).filter((c): c is Chat => !!c).map(c => chatRow(c, 1))}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {features.cleanup && expanded.includes('__cleanup') && candidates.length === 0 && (
        <Box borderStyle="round" borderColor={C.gray} paddingX={1} marginBottom={1}>
          <Text color={C.gray} size={fsMeta}>{t.cleanupNothing(cfg.settings.staleDays)}</Text>
        </Box>
      )}

      {features.cleanup && expanded.includes('__cleanup') && candidates.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.gray} paddingX={1} marginBottom={1}>
          <Text weight="semibold">{t.cleanupTitle(candidates.length, cfg.settings.staleDays)}</Text>
          {candidates.slice(0, 20).map(c => chatRow(c, 0))}
          {candidates.length > 20 && <Text color={C.gray} size={fsMeta}>{t.andMore(candidates.length - 20)}</Text>}
          {!mini && <Text color={C.gray} size={fsMeta}>{t.cleanupHint}</Text>}
          <Box marginTop={1}>
            <Button key="cleanup-go" onPress={archiveAll} label={t.cleanupButton(candidates.length)} />
          </Box>
        </Box>
      )}

      {expanded.includes('__findings') && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.amber} backgroundColor={C.amberBg} paddingX={1} marginBottom={1}>
          <Text weight="semibold" color={C.amber}>{t.toClarify}</Text>
          {snap.findings.slice(0, 30).map((f, i) => {
            const c = chats.find(x => x.id === f.chatId)
            return (
              <Box key={`f:${i}`} flexDirection="row" gap={1}>
                <Box width={16}>
                  <Text color={C.gray} size={fsMeta}>{t.findingLabel[f.kind]}</Text>
                </Box>
                {c ? link(`fb:${i}`, openChat(c), findingText(lang, f)) : <Text size={fs}>{findingText(lang, f)}</Text>}
              </Box>
            )
          })}
          {snap.findings.length > 30 && <Text color={C.gray} size={fsMeta}>{t.andMore(snap.findings.length - 30)}</Text>}
          {snap.fixed.length > 0 && <Text color={C.gray} size={fsMeta}>{t.numbered(snap.fixed)}</Text>}
        </Box>
      )}

      {planned > 0 && (
        <Box backgroundColor={C.amberBg} paddingX={1} marginBottom={1}>
          <Text color={C.amber} size={fsMeta}>{t.preview(planned)}</Text>
        </Box>
      )}

      {current && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.blue} backgroundColor={C.cardOpen} paddingX={1} marginBottom={1}>
          <Text color={C.blue} weight="semibold" size={fsMeta}>{t.thisChat}</Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            {p && <Text mono weight="semibold">{p.num}</Text>}
            <Text weight="semibold">{p ? p.rest : current.title}</Text>
          </Box>
          {current.group !== '' && <Text color={C.gray} size={fsMeta}>{t.inGroup(current.group)}</Text>}
        </Box>
      )}

      {results ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box marginTop={py} marginBottom={py}>
            <Text color={C.gray} weight="semibold" size={fsMeta}>{t.results(results.length)}</Text>
          </Box>
          {results.length === 0 && <Text color={C.gray} size={fsMeta}>{t.noResults}</Text>}
          {results.slice(0, 50).map(c => chatRow(c, 0))}
          {results.length > 50 && <Text color={C.gray} size={fsMeta}>{t.andMore(results.length - 50)}</Text>}
        </Box>
      ) : (
        <Box flexDirection="column">
        <Box marginTop={py} marginBottom={py}>
          <Text color={C.gray} weight="semibold" size={fsMeta}>{t.recent}</Text>
        </Box>
        <Box flexDirection="column" marginBottom={1} marginTop={0}>
          {recent.map(c => chatRow(c, 0))}
        </Box>

        <Box marginTop={py} marginBottom={py}>
          <Text color={C.gray} weight="semibold" size={fsMeta}>{t.areas}</Text>
        </Box>
        {areas.map(a => areaCard(a))}

        {unplaced.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" alignItems="center" borderStyle="round" borderColor={C.amber} paddingX={1} gap={1}>
              <Box flexGrow={1}>
                {link('area:__none', toggle('__none'), t.noNumber)}
              </Box>
              {chip(String(unplaced.length), C.amber, C.amberBg)}
            </Box>
            {expanded.includes('__none') && (
              <Box flexDirection="column" marginLeft={2}>
                {[...unplaced].sort((x, y) => y.last.localeCompare(x.last)).map(c => chatRow(c, 1, false))}
              </Box>
            )}
          </Box>
        )}
        </Box>
      )}

      {!mini && <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
        <Text color={C.green} size={fsMeta}>● {t.working}</Text>
        <Text color={C.amber} size={fsMeta}>● {t.waitingForYou}</Text>
        <Text color={C.blue} size={fsMeta}>● {t.isNew}</Text>
        <Text color={C.violet} size={fsMeta}>◆ {t.steering}</Text>
        <Text color={C.gray} size={fsMeta}>● {t.nothingOpen}</Text>
        <Text color={C.gray} size={fsMeta}>
          {t.updated(snap.at ? new Date(snap.at).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' }) : '–')}
        </Text>
      </Box>}
    </Box>
  )
}
