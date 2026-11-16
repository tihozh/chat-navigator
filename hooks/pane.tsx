import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { Area, Chat } from '../types'
import type { Project } from './config'
import { findingText, locale, texts } from './i18n'
import { age, areaOf, isSteering, nextNumber, parse, withPlannedTitles } from './logic'
import { getNote, getOpen, getSnapshot, markSeen, setNote, setOpen } from './state'

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
  deps: { refresh: () => Promise<void>; project: () => Project | null },
): Promise<RenderElement> {
  const ui = $.ui.resolve(e)
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : null
  const snap = await getSnapshot($)
  const expanded = await getOpen($)
  const hint = await getNote($)
  const cfg = snap.config
  const selfId = snap.selfId
  const lang = snap.lang ?? 'en'
  const t = texts(lang)
  const now = Date.now()
  // Narrow pane: compact list without borders and with little spacing.
  const compact = (e.props.bodyColumns ?? 120) < 70
  const py = compact ? 0 : 1

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
      <Text color={fg} size="body">{text}</Text>
    </Box>
  )

  // No matching project: point to the setup instead of showing an empty pane.
  if (!cfg) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        <Text weight="semibold" size="title">{t.appName}</Text>
        {snap.configError !== '' && <Text color="error">{snap.configError}</Text>}
        <Text>{t.noProject}</Text>
        <Text color={C.gray} size="body">{t.setupHint}</Text>
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
        {showNum && p && <Text mono color={C.gray} size="body">{p.num}</Text>}
        <Box flexGrow={1}>
          <Button key={`chat:${c.id}`} plain onPress={openChat(c)} label={p ? p.rest : c.title} />
        </Box>
        {c.isRunning ? (
          <Text color={C.green} size="body">{t.working}</Text>
        ) : c.isWaiting ? (
          <Text color={C.amber} size="body">{t.waiting}  {age(c.last, now, lang)}</Text>
        ) : c.isNew ? (
          <Text color={C.blue} size="body">{t.isNew}  {age(c.last, now, lang)}</Text>
        ) : (
          <Text color={C.gray} size="body">{age(c.last, now, lang)}</Text>
        )}
      </Box>
    )
  }

  const recent = [...chats].sort((a, b) => b.last.localeCompare(a.last)).slice(0, cfg.settings.recent)
  const current = chats.find(c => c.id === selfId)
  const areas = cfg.areas
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
          <Box flexGrow={1}>
            <Button key={`area:${a.id}`} plain onPress={toggle(a.id)} label={a.name} />
          </Box>
          {running > 0 && chip(t.countWorking(running), C.green, C.greenBg)}
          {waitingN > 0 && chip(t.countWaiting(waitingN), C.amber, C.amberBg)}
          {newN > 0 && chip(t.countNew(newN), C.blue, C.newBg)}
          <Text color={C.gray} size="body">{compact ? list.length : t.chats(list.length)}</Text>
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
                    <Text mono color={C.gray} size="body">{s.id}</Text>
                    <Box flexGrow={1}>
                      <Button key={`sub:${s.id}`} plain onPress={toggle(s.id)} label={s.name} />
                    </Box>
                    <Text color={C.gray} size="body">{subChats.length}</Text>
                    {subOpen && next !== '' && <Button key={`new:${s.id}`} plain onPress={copyNumber(next)} label={`+ ${next}`} />}
                  </Box>
                  {subOpen && (
                    <Box flexDirection="column" marginLeft={compact ? 2 : 4}>
                      {subChats.length === 0 && <Text color={C.gray} size="body">{t.empty}</Text>}
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
      <Box flexDirection="row" alignItems="center" marginBottom={1}>
        <Box flexGrow={1}>
          <Text weight="semibold" size={compact ? 'heading' : 'title'}>{cfg.name}</Text>
        </Box>
        {snap.findings.length > 0 && (
          <Box backgroundColor={C.amberBg} paddingX={1} marginRight={1}>
            <Button key="findings" plain onPress={toggle('__findings')} label={t.toClarifyCount(snap.findings.length)} />
          </Box>
        )}
        <Button key="refresh" plain onPress={deps.refresh} label="↻" />
      </Box>

      {snap.error !== '' && <Text color="error">{snap.error}</Text>}
      {snap.configError !== '' && <Text color="error">{snap.configError}</Text>}
      {hint !== '' && <Text color={C.gray} size="body">{hint}</Text>}

      {expanded.includes('__findings') && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.amber} backgroundColor={C.amberBg} paddingX={1} marginBottom={1}>
          <Text weight="semibold" color={C.amber}>{t.toClarify}</Text>
          {snap.findings.slice(0, 30).map((f, i) => {
            const c = chats.find(x => x.id === f.chatId)
            return (
              <Box key={`f:${i}`} flexDirection="row" gap={1}>
                <Box width={16}>
                  <Text color={C.gray} size="body">{t.findingLabel[f.kind]}</Text>
                </Box>
                {c ? <Button key={`fb:${i}`} plain onPress={openChat(c)} label={findingText(lang, f)} /> : <Text>{findingText(lang, f)}</Text>}
              </Box>
            )
          })}
          {snap.findings.length > 30 && <Text color={C.gray} size="body">{t.andMore(snap.findings.length - 30)}</Text>}
          {snap.fixed.length > 0 && <Text color={C.gray} size="body">{t.numbered(snap.fixed)}</Text>}
        </Box>
      )}

      {planned > 0 && (
        <Box backgroundColor={C.amberBg} paddingX={1} marginBottom={1}>
          <Text color={C.amber} size="body">{t.preview(planned)}</Text>
        </Box>
      )}

      {current && (
        <Box flexDirection="column" borderStyle="round" borderColor={C.blue} backgroundColor={C.cardOpen} paddingX={1} marginBottom={1}>
          <Text color={C.blue} weight="semibold" size="body">{t.thisChat}</Text>
          <Box flexDirection="row" gap={1} alignItems="center">
            {p && <Text mono weight="semibold">{p.num}</Text>}
            <Text weight="semibold">{p ? p.rest : current.title}</Text>
          </Box>
          {current.group !== '' && <Text color={C.gray} size="body">{t.inGroup(current.group)}</Text>}
        </Box>
      )}

      <Box marginTop={py} marginBottom={py}>
        <Text color={C.gray} weight="semibold" size="body">{t.recent}</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1} marginTop={0}>
        {recent.map(c => chatRow(c, 0))}
      </Box>

      <Box marginTop={py} marginBottom={py}>
        <Text color={C.gray} weight="semibold" size="body">{t.areas}</Text>
      </Box>
      {areas.map(a => areaCard(a))}

      {unplaced.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row" alignItems="center" borderStyle="round" borderColor={C.amber} paddingX={1} gap={1}>
            <Box flexGrow={1}>
              <Button key="area:__none" plain onPress={toggle('__none')} label={t.noNumber} />
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

      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
        <Text color={C.green} size="body">● {t.working}</Text>
        <Text color={C.amber} size="body">● {t.waitingForYou}</Text>
        <Text color={C.blue} size="body">● {t.isNew}</Text>
        <Text color={C.violet} size="body">◆ {t.steering}</Text>
        <Text color={C.gray} size="body">● {t.nothingOpen}</Text>
        <Text color={C.gray} size="body">
          {t.updated(snap.at ? new Date(snap.at).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' }) : '–')}
        </Text>
      </Box>
    </Box>
  )
}
