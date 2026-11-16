import { expect, test } from 'claude-code/testing'

import type { BandItem, Chat, Config } from '../types'
import { configErrorText, findingText, texts } from '../hooks/i18n'
import {
  age,
  areaOf,
  cleanupCandidates,
  crabFrame,
  endsWithQuestion,
  failedFinding,
  inProjectPath,
  isSteering,
  matchesQuery,
  nextNumber,
  normalizeConfig,
  normalizeGlobal,
  normalizePath,
  parse,
  paneSize,
  pickProject,
  planGuard,
  savedResultPath,
  searchChats,
  statusText,
  toChats,
  updateSeen,
  weekBar,
  weekSummary,
  withPlannedTitles,
} from '../hooks/logic'

// All data here is made up.

const NOW = Date.parse('2026-03-10T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

function config(over: Record<string, unknown> = {}): Config {
  const r = normalizeConfig({
    name: 'Garden',
    project: '/home/demo/garden',
    areas: [
      { id: '01', name: 'Planning', subs: [{ id: '01-01', name: 'Beds' }, { id: '01-02', name: 'Tools' }] },
      { id: '02', name: 'Harvest', subs: [] },
    ],
    register: {},
    ...over,
  })
  if ('error' in r) throw new Error(JSON.stringify(r.error))
  return r.cfg
}

function chat(id: string, title: string, over: Partial<Chat> = {}): Chat {
  return { id, title, group: '', groupId: '', isRunning: false, last: ago(1), link: `claude://chat/${id}`, parent: '', ...over }
}

const GROUPS = [
  { id: 'g1', name: '01 Planning' },
  { id: 'g2', name: '02 Harvest' },
]

// ---------- Titles and numbers ----------

test('parse reads number, area, sub-folder and title', async () => {
  expect(parse('01-02-03 · Tomatoes')).toEqual({ num: '01-02-03', area: '01', sub: '01-02', rest: 'Tomatoes' })
  expect(parse('01 · Steering')).toEqual({ num: '01', area: '01', sub: '', rest: 'Steering' })
  expect(parse('01-00·Steer')).toEqual({ num: '01-00', area: '01', sub: '01-00', rest: 'Steer' })
  expect(parse('Tomatoes')).toBe(null)
  expect(parse('1-02 · too short')).toBe(null)
})

test('isSteering recognises steering chats', async () => {
  expect(isSteering('01')).toBe(true)
  expect(isSteering('01-00')).toBe(true)
  expect(isSteering('01-02-00')).toBe(true)
  expect(isSteering('01-02-03')).toBe(false)
})

test('areaOf: number before archive before run before group', async () => {
  const cfg = config({ ablage: ['a1'], runs: { patterns: ['Nightly'] } })
  expect(areaOf(cfg, chat('x', '02-01-01 · Potatoes', { group: '01 Planning' }))).toBe('02')
  expect(areaOf(cfg, chat('a1', 'Old'))).toBe('99')
  expect(areaOf(cfg, chat('r', 'Nightly 3'))).toBe('90')
  expect(areaOf(cfg, chat('g', 'Loose', { group: '02 Harvest' }))).toBe('02')
  expect(areaOf(cfg, chat('n', 'Loose'))).toBe('')
})

test('nextNumber takes the maximum of register and titles', async () => {
  const register = { '01-01-04': { session: 's4', title: 'x' } }
  const chats = [{ title: '01-01-02 · a' }, { title: '01-01-07 · b' }, { title: '01-02-09 · other folder' }]
  expect(nextNumber(register, chats, '01-01')).toBe('01-01-08')
  expect(nextNumber({}, [], '01-02')).toBe('01-02-01')
  expect(nextNumber(register, [], '01-01')).toBe('01-01-05')
  expect(nextNumber({}, [{ title: '01-01-98 · a' }], '01-01')).toBe('01-01-99')
  expect(nextNumber({}, [{ title: '01-01-99 · a' }], '01-01')).toBe('')
})

// ---------- Which project a folder belongs to ----------

test('inProjectPath: absolute path and bare folder name', async () => {
  expect(inProjectPath('/home/demo/garden', '/home/demo/garden')).toBe(true)
  expect(inProjectPath('/home/demo/garden/beds', '/home/demo/garden/')).toBe(true)
  expect(inProjectPath('/home/demo/garden-old', '/home/demo/garden')).toBe(false)
  expect(inProjectPath('/home/demo/x/garden/y', 'garden')).toBe(true)
  expect(inProjectPath('/home/demo/garden-old', 'garden')).toBe(false)
  expect(inProjectPath('', 'garden')).toBe(false)
})

test('normalizePath and project borders with «..»', async () => {
  expect(normalizePath('/a//b/./c/')).toBe('/a/b/c')
  expect(normalizePath('/a/b/../c')).toBe('/a/c')
  expect(inProjectPath('/home/demo/garden/../other', '/home/demo/garden')).toBe(false)
  expect(inProjectPath('/home/demo/garden/beds/..', '/home/demo/garden')).toBe(true)
})

test('pickProject: the longest matching path wins', async () => {
  const a = { cfg: config({ project: '/home/demo' }) }
  const b = { cfg: config({ project: '/home/demo/garden' }) }
  const c = { cfg: config({ project: 'garden' }) }
  expect(pickProject('/home/demo/garden/beds', [a, b, c])).toBe(b)
  expect(pickProject('/home/demo/kitchen', [a, b, c])).toBe(a)
  expect(pickProject('/srv/garden', [a, b, c])).toBe(c)
  expect(pickProject('/srv/other', [a, b, c])).toBe(null)
})

// ---------- Settings ----------

test('normalizeConfig sets defaults and reads older keys', async () => {
  const cfg = config({ ablage: ['a1'], laeufe: ['Nightly'] })
  expect(cfg.archive).toEqual({ area: '99', sessions: ['a1'] })
  expect(cfg.runs).toEqual({ area: '90', patterns: ['Nightly'] })
  expect(cfg.settings).toEqual({ staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true })
  expect(config({ settings: { autoFix: false } }).settings.autoFix).toBe(false)
  const custom = config({ settings: { staleDays: 30, recent: 5 }, archive: { area: '98', sessions: ['b'] } })
  expect(custom.settings.staleDays).toBe(30)
  expect(custom.settings.recent).toBe(5)
  expect(custom.archive).toEqual({ area: '98', sessions: ['b'] })
})

test('normalizeConfig reports broken files clearly', async () => {
  expect(normalizeConfig(null)).toEqual({ error: { code: 'notObject' } })
  expect(normalizeConfig({ project: '/p', areas: [{ id: '01', subs: [] }, { id: '01', subs: [] }] })).toEqual({ error: { code: 'dupArea', area: '01' } })
  const broken = [
    { areas: [] },
    { project: '/p', areas: [{ id: '1', subs: [] }] },
    { project: '/p', areas: [{ id: '01', subs: [{ id: '02-01' }] }] },
    { project: '/p', areas: [{ id: '01', subs: [{ id: '01-bogus' }] }] },
    { project: '/p', areas: [{ id: '01', subs: [] }, { id: '01', subs: [] }] },
    { project: '/p', areas: [{ id: '01', subs: [{ id: '01-01' }, { id: '01-01' }] }] },
    { project: '/p', areas: [{ id: '01', group: '', subs: [] }] },
    { project: '/p', areas: [], register: { '01-01-01': { title: 'x' } } },
    { project: '/p', areas: [], register: { abc: { session: 's' } } },
  ]
  for (const raw of broken) expect('error' in normalizeConfig(raw)).toBe(true)
  expect('cfg' in normalizeConfig({ project: '/p', areas: [] })).toBe(true)
})

test('normalizeGlobal: defaults, language, modes and project precedence', async () => {
  expect(normalizeGlobal(undefined)).toEqual({
    language: 'en',
    statusbar: true,
    crab: false,
    band: 'active',
    features: { search: true, week: true, cleanup: true },
    settings: { staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true },
  })
  const g = normalizeGlobal({ language: 'de', statusbar: false, crab: true, band: 'always', settings: { recent: 5, staleDays: 30 } })
  expect(g.language).toBe('de')
  expect(g.statusbar).toBe(false)
  expect(g.crab).toBe(true)
  expect(g.band).toBe('always')
  expect(normalizeGlobal({ language: 'fr' }).language).toBe('en')
  expect(normalizeGlobal({ crab: 'yes' }).crab).toBe(false)
  expect(normalizeGlobal({ band: 'nonsense' }).band).toBe('active')
  // German values of earlier versions still work.
  expect(normalizeGlobal({ band: 'aus' }).band).toBe('off')
  expect(normalizeGlobal({ band: 'immer' }).band).toBe('always')
  const r = normalizeConfig({ project: '/p', areas: [], settings: { staleDays: 7 } }, g.settings)
  expect('cfg' in r && r.cfg.settings.recent).toBe(5)
  expect('cfg' in r && r.cfg.settings.staleDays).toBe(7)
})

// ---------- Guard ----------

test('guard: a sub-chat inherits the next number of its parent', async () => {
  const chats = [
    chat('p', '01-01-03 · Bed plan', { group: '01 Planning' }),
    chat('k1', 'Compost', { parent: 'p', group: '01 Planning' }),
    chat('k2', 'Mulch', { parent: 'p', group: '01 Planning' }),
  ]
  const r = planGuard(config(), chats, GROUPS, NOW)
  expect(r.actions).toEqual([
    { kind: 'rename', chatId: 'k1', num: '01-01-04', title: '01-01-04 · Compost', original: 'Compost' },
    { kind: 'rename', chatId: 'k2', num: '01-01-05', title: '01-01-05 · Mulch', original: 'Mulch' },
  ])
  expect(r.findings).toEqual([])
})

test('guard: no number from steering chats NN-00, archive, registered chats or unknown sub-folders', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'reg', title: 'Planned' } }, ablage: ['old'] })
  const chats = [
    chat('s', '01-00 · Steering', { group: '01 Planning' }),
    chat('a', 'Question', { parent: 's' }),
    chat('p', '01-01-02 · Bed', { group: '01 Planning' }),
    chat('reg', 'Planned', { parent: 'p' }),
    chat('old', 'Archive', { parent: 'p' }),
    chat('f', '01-05-02 · Unknown folder', { group: '01 Planning' }),
    chat('k', 'Child', { parent: 'f' }),
  ]
  const r = planGuard(cfg, chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings.filter(f => f.kind === 'noNumber').map(f => f.chatId)).toEqual(['a', 'reg', 'k'])
})

test('guard: a full sub-folder gets no number', async () => {
  const chats = [chat('p', '01-01-99 · Last', { group: '01 Planning' }), chat('k', 'New', { parent: 'p' })]
  const r = planGuard(config(), chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings).toEqual([{ kind: 'numbersFull', chatId: 'k', title: 'New', sub: '01-01' }])
})

test('guard: wrong group reported with target, missing group reported, sub-chats left alone', async () => {
  const chats = [
    chat('m', '02-01 · Harvest plan', { group: '01 Planning' }),
    chat('x', '03-01 · No group', { group: '01 Planning' }),
    chat('u', '02-02 · Sub-chat', { group: '01 Planning', parent: 'm' }),
  ]
  const r = planGuard(config(), chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings).toEqual([
    { kind: 'wrongGroup', chatId: 'm', title: '02-01 · Harvest plan', group: '02 Harvest' },
    { kind: 'missingGroup', chatId: 'x', title: '03-01 · No group', group: '03 …' },
  ])
})

test('guard: an area with its own group beats the same number of another project', async () => {
  const cfg = config({ areas: [{ id: '01', name: 'Planning', group: 'Garden · Planning', subs: [] }] })
  const groups = [
    { id: 'other', name: '01 Other project' },
    { id: 'own', name: 'Garden · Planning' },
  ]
  const chats = [
    chat('m', '01-01 · Plan', { group: '00 Somewhere' }),
    chat('u', '01-03 · Sub-chat', { group: '00 Somewhere', parent: 'outside' }),
    chat('ok', '01-02 · Already there', { group: 'Garden · Planning' }),
    chat('n', 'No number', { group: 'Garden · Planning' }),
  ]
  const r = planGuard(cfg, chats, groups, NOW)
  expect(r.findings.filter(f => f.kind === 'wrongGroup')).toEqual([{ kind: 'wrongGroup', chatId: 'm', title: '01-01 · Plan', group: 'Garden · Planning' }])
  expect(areaOf(cfg, chats[3] as Chat)).toBe('01')
  const missing = planGuard(cfg, [chat('m', '01-01 · Plan')], [{ id: 'other', name: '01 Other project' }], NOW)
  expect(missing.findings).toEqual([{ kind: 'missingGroup', chatId: 'm', title: '01-01 · Plan', group: 'Garden · Planning' }])
})

test('guard: several groups with the same number', async () => {
  const groups = [...GROUPS, { id: 'g9', name: '02 Harvest (other project)' }]
  const a = planGuard(config(), [chat('m', '02-01 · Plan', { group: '01 Planning' })], groups, NOW)
  expect(a.findings.map(f => f.kind)).toEqual(['unclearGroup'])
  const chats = [chat('m', '02-01 · Plan', { group: '01 Planning' }), chat('e', 'Loose', { group: '02 Harvest', groupId: 'g2' })]
  const b = planGuard(config(), chats, groups, NOW)
  expect(b.findings.filter(f => f.kind === 'wrongGroup').map(f => (f.kind === 'wrongGroup' ? f.group : ''))).toEqual(['02 Harvest'])
})

test('guard: duplicate numbers and chats unused for long', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'z', title: 'Z' } } })
  const chats = [
    chat('a', '01-01-01 · One', { group: '01 Planning', last: ago(20) }),
    chat('b', '01-01-01 · Two', { group: '01 Planning' }),
    chat('z', 'Z', { group: '01 Planning' }),
    chat('s', '01-01-00 · Steer', { group: '01 Planning', last: ago(40) }),
  ]
  const kinds = planGuard(cfg, chats, GROUPS, NOW).findings.map(f => `${f.kind}:${f.chatId}`)
  expect(kinds).toContain('duplicate:b')
  expect(kinds).toContain('duplicateRegister:a')
  expect(kinds).toContain('stale:a')
  expect(kinds.includes('stale:s')).toBe(false)
})

// ---------- Texts in both languages ----------

test('findings read well in English and German', async () => {
  const wrong = { kind: 'wrongGroup' as const, chatId: 'm', title: '02-01 · Plan', group: '02 Harvest' }
  expect(findingText('en', wrong)).toBe('02-01 · Plan → move to «02 Harvest»')
  expect(findingText('de', wrong)).toBe('02-01 · Plan → in «02 Harvest» verschieben')
  const held = failedFinding({ kind: 'rename', chatId: 'k', num: '01-01-04', title: '01-01-04 · K', original: 'K' }, { code: 'autoFixOff' })
  expect(findingText('en', held)).toBe('K (automatic numbering off)')
  expect(findingText('de', held)).toBe('K (Selbst-Nummerieren aus)')
  expect(texts('de').findingLabel.stale).toBe('Lange unbenutzt')
})

test('every German text exists in English and the other way round', async () => {
  const keys = (o: object) => Object.keys(o).sort()
  expect(keys(texts('de'))).toEqual(keys(texts('en')))
  expect(keys(texts('de').findingLabel)).toEqual(keys(texts('en').findingLabel))
})

test('age in words', async () => {
  expect(age(new Date(NOW - 60_000).toISOString(), NOW)).toBe('now')
  expect(age(new Date(NOW - 20 * 60_000).toISOString(), NOW)).toBe('20 min')
  expect(age(new Date(NOW - 3 * 3_600_000).toISOString(), NOW, 'de')).toBe('3 Std.')
  expect(age(ago(2), NOW)).toBe('2 d')
  expect(age('broken', NOW)).toBe('')
})

// ---------- Status ----------

test('endsWithQuestion recognises open questions and AskUserQuestion', async () => {
  expect(endsWithQuestion('[user] hello\n[assistant] Shall I go on?')).toBe(true)
  expect(endsWithQuestion('[assistant] (called AskUserQuestion)\n[result] ok')).toBe(true)
  expect(endsWithQuestion('[assistant] Done.')).toBe(false)
  expect(endsWithQuestion('[assistant] Is that fine?\nCheers')).toBe(true)
  expect(endsWithQuestion('[assistant] Shall I?\n[user] yes')).toBe(false)
  expect(endsWithQuestion('[assistant] (called AskUserQuestion)\n[result] ok\n[assistant] Done.')).toBe(false)
  expect(endsWithQuestion('[assistant] (called Bash)\n[result] ok')).toBe(false)
})

test('updateSeen: unknown chats count as seen, later activity is new', async () => {
  const chats = [
    { id: 'a', last: ago(0), isRunning: false },
    { id: 'b', last: ago(0), isRunning: false },
    { id: 'self', last: ago(0), isRunning: false },
  ]
  const r = updateSeen(chats, { b: ago(1), gone: ago(40), recent: ago(5) }, 'self', NOW)
  expect(r.fresh.has('b')).toBe(true)
  expect(r.fresh.has('a')).toBe(false)
  expect(r.seen.a).toBe(ago(0))
  expect('gone' in r.seen).toBe(false)
  expect('recent' in r.seen).toBe(true)
  expect(r.changed).toBe(true)
  expect(r.seen.self).toBe(ago(0))
})

// ---------- Chats from the app ----------

test('toChats keeps only the project chats, without archived ones or sub-projects', async () => {
  const rows = [
    { sessionId: 'a', title: 'A', cwd: '/home/demo/garden', group: { id: 'g1', name: '01 Planning' }, startedBy: 'p' },
    { sessionId: 'b', title: 'B', cwd: '/home/demo/garden', isArchived: true },
    { sessionId: 'c', title: 'C', cwd: '/home/demo/kitchen' },
    { sessionId: 'd', title: 'D' },
  ]
  const chats = toChats(rows, '/home/demo/garden')
  expect(chats.map(c => c.id)).toEqual(['a'])
  expect(chats[0]?.group).toBe('01 Planning')
  expect(chats[0]?.parent).toBe('p')
  const nested = [
    { sessionId: 'u', cwd: '/home/demo/garden/pond' },
    { sessionId: 'g', cwd: '/home/demo/garden' },
  ]
  const all = ['/home/demo/garden', '/home/demo/garden/pond']
  expect(toChats(nested, '/home/demo/garden', all).map(c => c.id)).toEqual(['g'])
  expect(toChats(nested, '/home/demo/garden/pond', all).map(c => c.id)).toEqual(['u'])
})

test('withPlannedTitles shows planned numbers as a preview', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'a', title: 'Old' } } })
  const r = withPlannedTitles(cfg, [chat('a', 'Old'), chat('b', '01-01-02 · Done')])
  expect(r.planned).toBe(1)
  expect(r.chats[0]?.title).toBe('01-01-01 · Old')
  expect(r.chats[1]?.title).toBe('01-01-02 · Done')
})

// ---------- Status bar ----------

test('statusText: own number and open items of other chats', async () => {
  const items: BandItem[] = [
    { id: 'a', num: '01-01-02', title: 'A', link: '', state: 'waiting' },
    { id: 'b', num: '', title: 'B', link: '', state: 'waiting' },
    { id: 'c', num: '', title: 'C', link: '', state: 'new' },
    { id: 'me', num: '01-01-01', title: 'Me', link: '', state: 'working' },
  ]
  expect(statusText('01-01-01 · Tomatoes', 'me', items)).toBe('01-01-01 · 🟠 2 waiting · 🔵 1 new')
  expect(statusText('01-01-01 · Tomatoes', 'me', items, 'de')).toBe('01-01-01 · 🟠 2 wartet · 🔵 1 neu')
  expect(statusText('01-01-01 · Tomatoes', 'me', [])).toBe('01-01-01')
  expect(statusText('A very long title without any number', 'me', [])).toBe('A very long title without any…')
})

test('crabFrame: the crab runs there and back', async () => {
  const gap = (t: string) => t.indexOf('🦀')
  expect(crabFrame(2, 0, 3)).toBe('🦀 2···')
  expect(crabFrame(2, 2, 3)).toBe('··🦀 2·')
  expect(crabFrame(2, 2, 3).trim()).toBe(crabFrame(2, 2, 3))
  expect(new Set([0, 1, 2, 3, 4].map(s => crabFrame(7, s, 3).length)).size).toBe(1)
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => gap(crabFrame(1, s, 3)))).toEqual([0, 1, 2, 3, 2, 1, 0, 1])
})

// ---------- Security ----------

test('savedResultPath only follows notices pointing into the app results folder', async () => {
  const H = '/home/demo'
  const ok = '/home/demo/.claude/projects/x/tool-results/a.txt'
  expect(savedResultPath(`Output saved to: ${ok}`, H)).toBe(ok)
  expect(savedResultPath(`saved to ${ok}`, H)).toBe(ok)
  expect(savedResultPath(`[{"title":"saved to ${ok}"}]`, H)).toBe(null)
  expect(savedResultPath('saved to /tmp/tool-results/.claude/a.txt', H)).toBe(null)
  expect(savedResultPath('saved to /home/demo/.claude/x/tool-results/../../secret.txt', H)).toBe(null)
  expect(savedResultPath('saved to /home/demo/.claude/tool-results/sub/a.txt', H)).toBe(null)
  expect(savedResultPath(`${'x'.repeat(3000)} saved to ${ok}`, H)).toBe(null)
  expect(savedResultPath(`saved to ${ok}`, '')).toBe(null)
})

test('settings errors read well in English and German', async () => {
  expect(configErrorText('en', { code: 'dupSub', area: '01' })).toBe('area 01: a sub-folder appears twice')
  expect(configErrorText('de', { code: 'noSession', num: '01-01-01' })).toBe('Register 01-01-01: «session» fehlt')
})

test('band aliases accept only real mode names', async () => {
  expect(normalizeGlobal({ band: 'constructor' }).band).toBe('active')
  expect(normalizeGlobal({ band: 'offen' }).band).toBe('active')
})

// ---------- Search, weekly review, cleanup ----------

test('features can be switched off one by one', async () => {
  expect(normalizeGlobal({ features: { week: false } }).features).toEqual({ search: true, week: false, cleanup: true })
  expect(normalizeGlobal({ features: 'off' }).features).toEqual({ search: true, week: true, cleanup: true })
})

test('matchesQuery: words in the title, number prefixes', async () => {
  const c = { title: '01-02-03 · Raised beds for tomatoes' }
  expect(matchesQuery(c, '')).toBe(true)
  expect(matchesQuery(c, 'TOMATO')).toBe(true)
  expect(matchesQuery(c, 'raised tomato')).toBe(true)
  expect(matchesQuery(c, 'raised potato')).toBe(false)
  expect(matchesQuery(c, '01-02')).toBe(true)
  expect(matchesQuery(c, '01-03')).toBe(false)
})

test('searchChats sorts by last activity and limits', async () => {
  const chats = [chat('a', 'Bed one', { last: ago(3) }), chat('b', 'Bed two', { last: ago(1) }), chat('c', 'Other')]
  expect(searchChats(chats, 'bed').map(c => c.id)).toEqual(['b', 'a'])
})

test('weekSummary: areas worked on most this week, with their chats newest first', async () => {
  const chats = [
    chat('a', '01-01-01 · A', { last: ago(1) }),
    chat('b', '01-01-02 · B', { last: ago(10) }),
    chat('c', '02-01 · C', { last: ago(2) }),
    chat('c2', '02-02 · C2', { last: ago(0.5) }),
    chat('d', 'Loose', { last: ago(3) }),
  ]
  expect(weekSummary(config(), chats, NOW)).toEqual([
    { area: '02', name: 'Harvest', chats: ['c2', 'c'] },
    { area: '01', name: 'Planning', chats: ['a'] },
    { area: '', name: '', chats: ['d'] },
  ])
  expect(weekSummary(config(), [chat('x', '01-01 · X', { last: ago(30) })], NOW)).toEqual([])
})

test('weekBar scales to the busiest area', async () => {
  expect(weekBar(17, 17)).toBe('████████████')
  expect(weekBar(8, 17)).toBe('██████')
  expect(weekBar(1, 17)).toBe('█')
  expect(weekBar(0, 17)).toBe('')
})

test('cleanupCandidates: stale chats only, oldest first', async () => {
  const cfg = config({ ablage: ['arch'], runs: { patterns: ['Nightly'] } })
  const chats = [
    chat('a', '01-01-01 · Old', { last: ago(20) }),
    chat('b', 'Older loose', { last: ago(40) }),
    chat('fresh', '01-01-02 · Fresh', { last: ago(2) }),
    chat('steer', '01-00 · Steering', { last: ago(50) }),
    chat('arch', 'Archived', { last: ago(50) }),
    chat('run', 'Nightly 4', { last: ago(50) }),
    chat('wait', '01-01-03 · Waits', { last: ago(30), isWaiting: true }),
    chat('me', '01-01-04 · Me', { last: ago(30) }),
  ]
  expect(cleanupCandidates(cfg, chats, 'me', NOW).map(c => c.id)).toEqual(['b', 'a'])
})

test('the archive beats the number, and archived chats are not reported in the wrong group', async () => {
  const cfg = config({ archive: { sessions: ['a'] } })
  const c = chat('a', '02-01 · Done', { group: '01 Planning' })
  expect(areaOf(cfg, c)).toBe('99')
  expect(planGuard(cfg, [c], GROUPS, NOW).findings).toEqual([])
})

test('paneSize: standard, small and mini by width', async () => {
  expect(paneSize(120)).toBe('standard')
  expect(paneSize(50)).toBe('standard')
  expect(paneSize(49)).toBe('small')
  expect(paneSize(32)).toBe('small')
  expect(paneSize(31)).toBe('mini')
})
