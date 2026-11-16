import { expect, test } from 'claude-code/testing'

import type { Chat, Config } from '../types'
import {
  age,
  areaOf,
  endsWithQuestion,
  inProjectPath,
  isSteering,
  nextNumber,
  normalizeConfig,
  normalizeGlobal,
  crabFrame,
  parse,
  pickProject,
  savedResultPath,
  normalizePath,
  planGuard,
  statusText,
  toChats,
  updateSeen,
  withPlannedTitles,
} from '../hooks/logic'

// Alle Daten hier sind erfunden.

const NOW = Date.parse('2026-03-10T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

function config(over: Record<string, unknown> = {}): Config {
  const r = normalizeConfig({
    name: 'Gartenprojekt',
    project: '/home/demo/garten',
    areas: [
      { id: '01', name: 'Planung', subs: [{ id: '01-01', name: 'Beete' }, { id: '01-02', name: 'Werkzeug' }] },
      { id: '02', name: 'Ernte', subs: [] },
    ],
    register: {},
    ...over,
  })
  if ('error' in r) throw new Error(r.error)
  return r.cfg
}

function chat(id: string, title: string, over: Partial<Chat> = {}): Chat {
  return { id, title, group: '', groupId: '', isRunning: false, last: ago(1), link: `claude://chat/${id}`, parent: '', ...over }
}

// ---------- Titel ----------

test('parse liest Nummer, Bereich, Unterordner und Titel', async () => {
  expect(parse('01-02-03 · Tomaten')).toEqual({ num: '01-02-03', area: '01', sub: '01-02', rest: 'Tomaten' })
  expect(parse('01 · Steuerung')).toEqual({ num: '01', area: '01', sub: '', rest: 'Steuerung' })
  expect(parse('01-00·Steuer')).toEqual({ num: '01-00', area: '01', sub: '01-00', rest: 'Steuer' })
  expect(parse('Tomaten')).toBe(null)
  expect(parse('1-02 · zu kurz')).toBe(null)
})

test('isSteering erkennt Steuerchats', async () => {
  expect(isSteering('01')).toBe(true)
  expect(isSteering('01-00')).toBe(true)
  expect(isSteering('01-02-00')).toBe(true)
  expect(isSteering('01-02-03')).toBe(false)
})

test('areaOf: Nummer vor Ablage vor Lauf vor Ordner', async () => {
  const cfg = config({ ablage: ['a1'], runs: { patterns: ['Nachtlauf'] } })
  expect(areaOf(cfg, chat('x', '02-01-01 · Kartoffeln', { group: '01 Planung' }))).toBe('02')
  expect(areaOf(cfg, chat('a1', 'Alt'))).toBe('99')
  expect(areaOf(cfg, chat('r', 'Nachtlauf 3'))).toBe('90')
  expect(areaOf(cfg, chat('g', 'Ohne', { group: '02 Ernte' }))).toBe('02')
  expect(areaOf(cfg, chat('n', 'Ohne'))).toBe('')
})

// ---------- Nummernvergabe ----------

test('nextNumber nimmt das Maximum aus Register und Titeln', async () => {
  const register = { '01-01-04': { session: 's4', title: 'x' } }
  const chats = [{ title: '01-01-02 · a' }, { title: '01-01-07 · b' }, { title: '01-02-09 · anderer Ordner' }]
  expect(nextNumber(register, chats, '01-01')).toBe('01-01-08')
  expect(nextNumber({}, [], '01-02')).toBe('01-02-01')
  expect(nextNumber(register, [], '01-01')).toBe('01-01-05')
  expect(nextNumber({}, [{ title: '01-01-98 · a' }], '01-01')).toBe('01-01-99')
  expect(nextNumber({}, [{ title: '01-01-99 · a' }], '01-01')).toBe('')
})

test('Wächter: voller Unterordner vergibt keine Nummer', async () => {
  const chats = [chat('p', '01-01-99 · Letzter', { group: '01 Planung' }), chat('k', 'Neu', { parent: 'p' })]
  const r = planGuard(config(), chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings.map(f => f.kind)).toEqual(['Nummern voll'])
})

// ---------- Projekt erkennen ----------

test('inProjectPath: absoluter Pfad und alter Ordnername', async () => {
  expect(inProjectPath('/home/demo/garten', '/home/demo/garten')).toBe(true)
  expect(inProjectPath('/home/demo/garten/beet', '/home/demo/garten/')).toBe(true)
  expect(inProjectPath('/home/demo/garten-alt', '/home/demo/garten')).toBe(false)
  expect(inProjectPath('/home/demo/x/garten/y', 'garten')).toBe(true)
  expect(inProjectPath('/home/demo/garten-alt', 'garten')).toBe(false)
  expect(inProjectPath('', 'garten')).toBe(false)
})

test('pickProject: der längste passende Pfad gewinnt', async () => {
  const a = { cfg: config({ project: '/home/demo' }) }
  const b = { cfg: config({ project: '/home/demo/garten' }) }
  const c = { cfg: config({ project: 'garten' }) }
  expect(pickProject('/home/demo/garten/beet', [a, b, c])).toBe(b)
  expect(pickProject('/home/demo/kueche', [a, b, c])).toBe(a)
  expect(pickProject('/srv/garten', [a, b, c])).toBe(c)
  expect(pickProject('/srv/anderes', [a, b, c])).toBe(null)
})

// ---------- Einstellungen ----------

test('normalizeConfig setzt Standardwerte und liest alte Schlüssel', async () => {
  const cfg = config({ ablage: ['a1'], laeufe: ['Nacht'] })
  expect(cfg.archive).toEqual({ area: '99', sessions: ['a1'] })
  expect(cfg.runs).toEqual({ area: '90', patterns: ['Nacht'] })
  expect(cfg.settings).toEqual({ staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true })
  expect(config({ settings: { autoFix: false } }).settings.autoFix).toBe(false)
  const custom = config({ settings: { staleDays: 30, recent: 5 }, archive: { area: '98', sessions: ['b'] } })
  expect(custom.settings.staleDays).toBe(30)
  expect(custom.settings.recent).toBe(5)
  expect(custom.archive).toEqual({ area: '98', sessions: ['b'] })
})

test('normalizeConfig meldet kaputte Dateien klar', async () => {
  expect(normalizeConfig(null)).toEqual({ error: 'kein JSON-Objekt' })
  expect('error' in normalizeConfig({ areas: [] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '1', subs: [] }] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '01', subs: [{ id: '02-01' }] }] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [], register: { '01-01-01': { title: 'x' } } })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '01', subs: [{ id: '01-bogus' }] }] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '01', subs: [] }, { id: '01', subs: [] }] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '01', subs: [{ id: '01-01' }, { id: '01-01' }] }] })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [], register: { abc: { session: 's' } } })).toBe(true)
  expect('error' in normalizeConfig({ project: '/p', areas: [{ id: '01', group: '', subs: [] }] })).toBe(true)
  expect('cfg' in normalizeConfig({ project: '/p', areas: [] })).toBe(true)
})

// ---------- Wächter ----------

const GROUPS = [
  { id: 'g1', name: '01 Planung' },
  { id: 'g2', name: '02 Ernte' },
]

test('Wächter: Unterchat erbt die nächste Nummer seines Steuerchats', async () => {
  const cfg = config()
  const chats = [
    chat('p', '01-01-03 · Beetplan', { group: '01 Planung' }),
    chat('k1', 'Kompost', { parent: 'p', group: '01 Planung' }),
    chat('k2', 'Mulch', { parent: 'p', group: '01 Planung' }),
  ]
  const r = planGuard(cfg, chats, GROUPS, NOW)
  expect(r.actions).toEqual([
    { kind: 'rename', chatId: 'k1', num: '01-01-04', title: '01-01-04 · Kompost', original: 'Kompost' },
    { kind: 'rename', chatId: 'k2', num: '01-01-05', title: '01-01-05 · Mulch', original: 'Mulch' },
  ])
  expect(r.findings).toEqual([])
})

test('Wächter: keine Nummer erben von Steuerchat NN-00, Ablage oder registrierten Chats', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'reg', title: 'Geplant' } }, ablage: ['alt'] })
  const chats = [
    chat('s', '01-00 · Steuerung', { group: '01 Planung' }),
    chat('a', 'Frage', { parent: 's' }),
    chat('p', '01-01-02 · Beet', { group: '01 Planung' }),
    chat('reg', 'Geplant', { parent: 'p' }),
    chat('alt', 'Archiv', { parent: 'p' }),
  ]
  const r = planGuard(cfg, chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings.map(f => [f.kind, f.chatId])).toEqual([
    ['Ohne Nummer', 'a'],
    ['Ohne Nummer', 'reg'],
  ])
})

test('Wächter: falscher Ordner wird mit Ziel gemeldet, fehlender gemeldet, Unterchats bleiben', async () => {
  const cfg = config()
  const chats = [
    chat('m', '02-01 · Ernteplan', { group: '01 Planung' }),
    chat('x', '03-01 · Ohne Ordner', { group: '01 Planung' }),
    chat('u', '02-02 · Unterchat', { group: '01 Planung', parent: 'm' }),
  ]
  const r = planGuard(cfg, chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings.map(f => [f.kind, f.chatId])).toEqual([['Falscher Ordner', 'm'], ['Ordner fehlt', 'x']])
  expect(r.findings[0]?.text).toBe('02-01 · Ernteplan → in «02 Ernte» verschieben')
})

test('Wächter: eigener Ordner je Bereich schlägt gleiche Nummer anderer Projekte', async () => {
  const cfg = config({ areas: [{ id: '01', name: 'Planung', group: 'Garten · Planung', subs: [] }] })
  const groups = [{ id: 'fremd', name: '01 Fremdes Projekt' }, { id: 'own', name: 'Garten · Planung' }]
  const chats = [
    chat('m', '01-01 · Plan', { group: '00 Irgendwo' }),
    chat('u', '01-03 · Unterchat', { group: '00 Irgendwo', parent: 'ausserhalb' }),
    chat('ok', '01-02 · Schon da', { group: 'Garten · Planung' }),
    chat('n', 'Ohne Nummer', { group: 'Garten · Planung' }),
  ]
  const r = planGuard(cfg, chats, groups, NOW)
  expect(r.findings.filter(f => f.kind === 'Falscher Ordner').map(f => f.text)).toEqual(['01-01 · Plan → in «Garten · Planung» verschieben'])
  expect(areaOf(cfg, chats[2] as Chat)).toBe('01')
  const missing = planGuard(cfg, [chat('m', '01-01 · Plan')], [{ id: 'fremd', name: '01 Fremdes Projekt' }], NOW)
  expect(missing.findings.map(f => f.text)).toEqual(['01-01 · Plan (kein Ordner «Garten · Planung»)'])
})

test('Wächter: mehrere Ordner mit gleicher Nummer', async () => {
  const groups = [...GROUPS, { id: 'g9', name: '02 Ernte (anderes Projekt)' }]
  const a = planGuard(config(), [chat('m', '02-01 · Plan', { group: '01 Planung' })], groups, NOW)
  expect(a.findings.map(f => f.kind)).toEqual(['Ordner unklar'])
  const chats = [chat('m', '02-01 · Plan', { group: '01 Planung' }), chat('e', 'Ohne', { group: '02 Ernte', groupId: 'g2' })]
  const b = planGuard(config(), chats, groups, NOW)
  expect(b.findings.filter(f => f.kind === 'Falscher Ordner').map(f => f.text)).toEqual(['02-01 · Plan → in «02 Ernte» verschieben'])
})

test('Wächter: doppelte Nummern und lange unbenutzte Chats', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'z', title: 'Z' } } })
  const chats = [
    chat('a', '01-01-01 · Eins', { group: '01 Planung', last: ago(20) }),
    chat('b', '01-01-01 · Zwei', { group: '01 Planung' }),
    chat('z', 'Z', { group: '01 Planung' }),
    chat('s', '01-01-00 · Steuer', { group: '01 Planung', last: ago(40) }),
  ]
  const kinds = planGuard(cfg, chats, GROUPS, NOW).findings.map(f => `${f.kind}:${f.chatId}`)
  expect(kinds).toContain('Nummer doppelt:b')
  expect(kinds).toContain('Nummer doppelt:a')
  expect(kinds).toContain('Lange unbenutzt:a')
  expect(kinds.includes('Lange unbenutzt:s')).toBe(false)
})

// ---------- Status ----------

test('endsWithQuestion erkennt Fragen und AskUserQuestion', async () => {
  expect(endsWithQuestion('[user] hallo\n[assistant] Soll ich weitermachen?')).toBe(true)
  expect(endsWithQuestion('[assistant] (called AskUserQuestion)\n[result] ok')).toBe(true)
  expect(endsWithQuestion('[assistant] Erledigt.')).toBe(false)
  expect(endsWithQuestion('[assistant] Passt das?\nGruss')).toBe(true)
  expect(endsWithQuestion('[assistant] Soll ich?\n[user] ja')).toBe(false)
  expect(endsWithQuestion('[assistant] (called AskUserQuestion)\n[result] ok\n[assistant] Erledigt.')).toBe(false)
  expect(endsWithQuestion('[assistant] (called Bash)\n[result] ok')).toBe(false)
})

test('updateSeen: neue Chats gelten als gesehen, Aktivität danach ist neu', async () => {
  const chats = [
    { id: 'a', last: ago(0), isRunning: false },
    { id: 'b', last: ago(0), isRunning: false },
    { id: 'self', last: ago(0), isRunning: false },
  ]
  const r = updateSeen(chats, { b: ago(1), weg: ago(40), kurz: ago(5) }, 'self', NOW)
  expect(r.fresh.has('b')).toBe(true)
  expect(r.fresh.has('a')).toBe(false)
  expect(r.seen.a).toBe(ago(0))
  expect('weg' in r.seen).toBe(false)
  expect('kurz' in r.seen).toBe(true)
  expect(r.changed).toBe(true)
  expect(r.seen.self).toBe(ago(0))
})

test('age in Worten', async () => {
  expect(age(new Date(NOW - 60_000).toISOString(), NOW)).toBe('jetzt')
  expect(age(new Date(NOW - 20 * 60_000).toISOString(), NOW)).toBe('20 Min.')
  expect(age(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 Std.')
  expect(age(ago(2), NOW)).toBe('2 T.')
  expect(age('kaputt', NOW)).toBe('')
})

// ---------- Chats aus der App ----------

test('toChats nimmt nur Chats des Projekts, ohne archivierte', async () => {
  const rows = [
    { sessionId: 'a', title: 'A', cwd: '/home/demo/garten', group: { id: 'g1', name: '01 Planung' }, startedBy: 'p' },
    { sessionId: 'b', title: 'B', cwd: '/home/demo/garten', isArchived: true },
    { sessionId: 'c', title: 'C', cwd: '/home/demo/kueche' },
    { sessionId: 'd', title: 'D' },
  ]
  const chats = toChats(rows, '/home/demo/garten')
  expect(chats.map(c => c.id)).toEqual(['a'])
  expect(chats[0]?.group).toBe('01 Planung')
  expect(chats[0]?.parent).toBe('p')
  const nested = [{ sessionId: 'u', cwd: '/home/demo/garten/teich' }, { sessionId: 'g', cwd: '/home/demo/garten' }]
  const all = ['/home/demo/garten', '/home/demo/garten/teich']
  expect(toChats(nested, '/home/demo/garten', all).map(c => c.id)).toEqual(['g'])
  expect(toChats(nested, '/home/demo/garten/teich', all).map(c => c.id)).toEqual(['u'])
})

test('withPlannedTitles zeigt geplante Nummern als Vorschau', async () => {
  const cfg = config({ register: { '01-01-01': { session: 'a', title: 'Alt' } } })
  const r = withPlannedTitles(cfg, [chat('a', 'Alt'), chat('b', '01-01-02 · Fertig')])
  expect(r.planned).toBe(1)
  expect(r.chats[0]?.title).toBe('01-01-01 · Alt')
  expect(r.chats[1]?.title).toBe('01-01-02 · Fertig')
})

// ---------- Zentrale Datei und Statusleiste ----------

test('normalizeGlobal: Vorgaben, Modus und Projekt-Vorrang', async () => {
  expect(normalizeGlobal(undefined)).toEqual({ statusbar: true, crab: false, band: 'offen', settings: { staleDays: 14, recent: 10, pollMinutes: 1, waitingHours: 48, autoFix: true } })
  const g = normalizeGlobal({ statusbar: false, crab: true, band: 'immer', settings: { recent: 5, staleDays: 30 } })
  expect(g.statusbar).toBe(false)
  expect(g.crab).toBe(true)
  expect(normalizeGlobal({ crab: 'ja' }).crab).toBe(false)
  expect(g.band).toBe('immer')
  expect(normalizeGlobal({ band: 'quatsch' }).band).toBe('offen')
  const r = normalizeConfig({ project: '/p', areas: [], settings: { staleDays: 7 } }, g.settings)
  expect('cfg' in r && r.cfg.settings.recent).toBe(5)
  expect('cfg' in r && r.cfg.settings.staleDays).toBe(7)
})

test('statusText: Nummer und offene Punkte anderer Chats', async () => {
  const items = [
    { id: 'a', num: '01-01-02', title: 'A', link: '', state: 'wartet' as const },
    { id: 'b', num: '', title: 'B', link: '', state: 'wartet' as const },
    { id: 'c', num: '', title: 'C', link: '', state: 'neu' as const },
    { id: 'me', num: '01-01-01', title: 'Ich', link: '', state: 'arbeitet' as const },
  ]
  expect(statusText('01-01-01 · Tomaten', 'me', items)).toBe('01-01-01 · 🟠 2 wartet · 🔵 1 neu')
  expect(statusText('01-01-01 · Tomaten', 'me', [])).toBe('01-01-01')
  expect(statusText('Ein sehr langer Titel ohne jede Nummer darin', 'me', [])).toBe('Ein sehr langer Titel ohne je…')
})

test('crabFrame: der Krebs läuft hin und zurück', async () => {
  const gap = (t: string) => t.indexOf('🦀')
  expect(crabFrame(2, 0, 3)).toBe('🦀 2···')
  expect(crabFrame(2, 2, 3)).toBe('··🦀 2·')
  expect(crabFrame(2, 2, 3).trim()).toBe(crabFrame(2, 2, 3))
  expect(new Set([0, 1, 2, 3, 4].map(s => crabFrame(7, s, 3).length)).size).toBe(1)
  expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => gap(crabFrame(1, s, 3)))).toEqual([0, 1, 2, 3, 2, 1, 0, 1])
})

// ---------- Sicherheit ----------

test('savedResultPath liest nur Hinweise auf den Ergebnisordner der App', async () => {
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

test('normalizePath und Projektgrenzen mit «..»', async () => {
  expect(normalizePath('/a//b/./c/')).toBe('/a/b/c')
  expect(normalizePath('/a/b/../c')).toBe('/a/c')
  expect(inProjectPath('/home/demo/garten/../fremd', '/home/demo/garten')).toBe(false)
  expect(inProjectPath('/home/demo/garten/beet/..', '/home/demo/garten')).toBe(true)
})

test('Wächter: keine Nummer in Unterordner, die nicht eingerichtet sind', async () => {
  const chats = [chat('p', '01-05-02 · Fremd', { group: '01 Planung' }), chat('k', 'Kind', { parent: 'p' })]
  const r = planGuard(config(), chats, GROUPS, NOW)
  expect(r.actions).toEqual([])
  expect(r.findings.map(f => [f.kind, f.chatId])).toContainEqual(['Ohne Nummer', 'k'])
})
