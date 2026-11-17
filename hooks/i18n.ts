// Every text the navigator shows, in English and German. Pure data and functions, no app access.
// Adding a language: copy `en`, translate it, add the key to `LANGS` and `Lang` (types/index.d.ts).

import type { ConfigError, Finding, Lang, Reason } from '../types'

export const LANGS: Lang[] = ['en', 'de']

const en = {
  appName: 'Chat Navigator',
  commandDescription: 'Open the Chat Navigator',
  commandOpened: 'Chat Navigator opened.',

  // Ages: «now», «12 min», «3 h», «2 d»
  ageNow: 'now',
  ageMinutes: (n: number) => `${n} min`,
  ageHours: (n: number) => `${n} h`,
  ageDays: (n: number) => `${n} d`,

  // States
  working: 'working',
  waiting: 'waiting',
  waitingForYou: 'waiting for you',
  isNew: 'new',
  steering: 'Steering chat',
  nothingOpen: 'nothing open',
  countWorking: (n: number) => `${n} working`,
  countWaiting: (n: number) => `${n} waiting`,
  countNew: (n: number) => `${n} new`,
  chats: (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`,

  // Pane
  folder: 'Folder',
  folderOpen: 'Folder open',
  noProject: 'No project is set up for this folder yet.',
  setupHint: 'Type /chat-navigator:setup to organise the chats of this project.',
  reload: '↻ Reload',
  toClarify: 'To clarify',
  toClarifyCount: (n: number) => `${n} to clarify`,
  andMore: (n: number) => `… and ${n} more`,
  numbered: (titles: string[]) => `Numbered automatically: ${titles.join(' · ')}`,
  preview: (n: number) => `Preview: ${n} chats show their planned number; their titles are not renamed yet.`,
  thisChat: 'This chat',
  inGroup: (g: string) => `Folder: ${g}`,
  recent: 'Recently active',
  areas: 'Areas',
  empty: 'empty',
  noNumber: 'Without number',
  updated: (time: string) => `· Updated ${time}`,
  readFailed: (msg: string) => `Reading failed: ${msg}`,
  checkFailed: (msg: string) => `Check not possible: ${msg}`,
  openFailed: (msg: string) => `Cannot open: ${msg}`,
  noLink: (title: string) => `no app link for «${title}»`,
  openExit: (code: number) => `«open» reported error ${code}`,
  copied: (num: string) => `Number ${num} copied. Use it as the start of the new chat's title.`,

  // Search, weekly review, cleanup
  searchPlaceholder: 'Search chats by title or number',
  searchSubmit: 'search',
  searchShort: 'Search…',
  results: (n: number) => (n === 1 ? '1 result' : `${n} results`),
  noResults: 'No chat matches.',
  week: 'Review',
  weekTitle: 'Most worked on this week',
  weekTotal: (chats: number, areas: number) => `${chats} ${chats === 1 ? 'chat' : 'chats'} in ${areas} ${areas === 1 ? 'area' : 'areas'}, last 7 days`,
  weekOther: 'Without area',
  weekEmpty: 'Nothing was worked on in the last 7 days.',
  cleanup: (n: number) => `Clean up ${n}`,
  cleanupLabel: 'Clean up',
  cleanupNothing: (days: number) => `Nothing to clean up: no chat unused for more than ${days} days.`,
  cleanupTitle: (n: number, days: number) => `${n} ${n === 1 ? 'chat' : 'chats'} unused for more than ${days} days`,
  cleanupButton: (n: number) => `Move ${n} to the archive`,
  cleanupHint: 'They move to the navigator\'s archive area; in the app they stay as they are.',
  cleanupDone: (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'} moved to the archive.`,
  archiveArea: 'Archive',
  runsArea: 'Scheduled runs',

  // Line above the prompt
  bandWaiting: 'Waiting:',
  bandNew: 'New:',
  bandWorking: (n: number) => `${n} working`,
  bandNothing: 'Chat Navigator: nothing open',

  // Findings: label and text
  findingLabel: {
    noNumber: 'No number',
    numbersFull: 'Numbers full',
    missingGroup: 'Folder missing',
    unclearGroup: 'Folder unclear',
    wrongGroup: 'Wrong folder',
    duplicate: 'Duplicate number',
    duplicateRegister: 'Duplicate number',
  } as Record<Finding['kind'], string>,
  findingText: (f: Finding, reason: (r: Reason) => string): string => {
    switch (f.kind) {
      case 'noNumber':
        return f.reason ? `${f.title} (${reason(f.reason)})` : f.title
      case 'numbersFull':
        return `${f.title} (folder ${f.sub} already has 99 chats)`
      case 'missingGroup':
        return `${f.title} (no folder «${f.group}»)`
      case 'unclearGroup':
        return `${f.title} (several folders «${f.group}»)`
      case 'wrongGroup':
        return `${f.title} → move to «${f.group}»`
      case 'duplicate':
        return `«${f.other}» and «${f.title}»`
      case 'duplicateRegister':
        return `${f.num} is already taken in the register`
    }
  },
  reason: (r: Reason): string => {
    switch (r.code) {
      case 'autoFixOff':
        return 'automatic numbering off'
      case 'incomplete':
        return 'more than 300 chats, list incomplete'
      case 'paneInactive':
        return 'pane not active in this chat'
      case 'locked':
        return 'another chat is numbering right now'
      case 'error':
        return (r.message ?? 'error').slice(0, 120)
    }
  },
  config: {
    invalidJson: (file: string) => `${file}: not valid JSON`,
    broken: (details: string) => `Settings have errors: ${details}`,
    error: (e: ConfigError): string => {
      switch (e.code) {
        case 'notObject':
          return 'not a JSON object'
        case 'noProject':
          return '«project» is missing'
        case 'noAreas':
          return '«areas» is missing'
        case 'badAreaId':
          return 'an area has no valid «id» (two digits)'
        case 'dupArea':
          return `area ${e.area} appears twice`
        case 'badSubId':
          return `area ${e.area}: a sub-folder has no valid «id» (${e.area}-NN)`
        case 'dupSub':
          return `area ${e.area}: a sub-folder appears twice`
        case 'badGroup':
          return `area ${e.area}: «group» is not a group name`
        case 'badRegister':
          return '«register» is not an object'
        case 'badRegisterNum':
          return `register: «${e.num}» is not a number (NN-SS-CC)`
        case 'noSession':
          return `register ${e.num}: «session» is missing`
      }
    },
  },
}

export type Texts = typeof en

const de: Texts = {
  appName: 'Chat-Navigator',
  commandDescription: 'Chat-Navigator öffnen',
  commandOpened: 'Chat-Navigator geöffnet.',

  ageNow: 'jetzt',
  ageMinutes: n => `${n} Min.`,
  ageHours: n => `${n} Std.`,
  ageDays: n => `${n} T.`,

  working: 'arbeitet',
  waiting: 'wartet',
  waitingForYou: 'wartet auf dich',
  isNew: 'neu',
  steering: 'Steuerchat',
  nothingOpen: 'nichts offen',
  countWorking: n => `${n} arbeiten`,
  countWaiting: n => `${n} wartet`,
  countNew: n => `${n} neu`,
  chats: n => `${n} ${n === 1 ? 'Chat' : 'Chats'}`,

  folder: 'Ordner',
  folderOpen: 'Ordner offen',
  noProject: 'Für diesen Ordner ist noch kein Projekt eingerichtet.',
  setupHint: 'Tippe /chat-navigator:setup, um die Chats dieses Projekts zu ordnen.',
  reload: '↻ Neu laden',
  toClarify: 'Zu klären',
  toClarifyCount: n => `${n} zu klären`,
  andMore: n => `… und ${n} weitere`,
  numbered: titles => `Selbst nummeriert: ${titles.join(' · ')}`,
  preview: n => `Vorschau: ${n} Chats zeigen ihre geplante Nummer, die Titel sind noch nicht umbenannt.`,
  thisChat: 'Dieser Chat',
  inGroup: g => `Ordner: ${g}`,
  recent: 'Zuletzt bearbeitet',
  areas: 'Bereiche',
  empty: 'leer',
  noNumber: 'Ohne Nummer',
  updated: time => `· Stand ${time}`,
  readFailed: msg => `Lesen fehlgeschlagen: ${msg}`,
  checkFailed: msg => `Prüfung nicht möglich: ${msg}`,
  openFailed: msg => `Öffnen nicht möglich: ${msg}`,
  noLink: title => `kein App-Link für «${title}»`,
  openExit: code => `«open» meldet Fehler ${code}`,
  copied: num => `Nummer ${num} kopiert. Als Titelanfang für den neuen Chat verwenden.`,

  searchPlaceholder: 'Chats nach Titel oder Nummer suchen',
  searchSubmit: 'suchen',
  searchShort: 'Suchen…',
  results: n => (n === 1 ? '1 Treffer' : `${n} Treffer`),
  noResults: 'Kein Chat passt.',
  week: 'Rückblick',
  weekTitle: 'Am meisten bearbeitet diese Woche',
  weekTotal: (chats, areas) => `${chats} ${chats === 1 ? 'Chat' : 'Chats'} in ${areas} ${areas === 1 ? 'Bereich' : 'Bereichen'}, letzte 7 Tage`,
  weekOther: 'Ohne Bereich',
  weekEmpty: 'In den letzten 7 Tagen wurde nichts bearbeitet.',
  cleanup: n => `${n} aufräumen`,
  cleanupLabel: 'Aufräumen',
  cleanupNothing: days => `Nichts aufzuräumen: kein Chat seit über ${days} Tagen unbenutzt.`,
  cleanupTitle: (n, days) => `${n} ${n === 1 ? 'Chat' : 'Chats'} seit über ${days} Tagen unbenutzt`,
  cleanupButton: n => `${n} in die Ablage`,
  cleanupHint: 'Sie wandern in die Ablage des Navigators; in der App bleiben sie, wie sie sind.',
  cleanupDone: n => `${n} ${n === 1 ? 'Chat' : 'Chats'} in die Ablage gelegt.`,
  archiveArea: 'Ablage',
  runsArea: 'Automatische Läufe',

  bandWaiting: 'Wartet:',
  bandNew: 'Neu:',
  bandWorking: n => `${n} arbeiten`,
  bandNothing: 'Chat-Navigator: nichts offen',

  findingLabel: {
    noNumber: 'Ohne Nummer',
    numbersFull: 'Nummern voll',
    missingGroup: 'Ordner fehlt',
    unclearGroup: 'Ordner unklar',
    wrongGroup: 'Falscher Ordner',
    duplicate: 'Nummer doppelt',
    duplicateRegister: 'Nummer doppelt',
  },
  findingText: (f, reason) => {
    switch (f.kind) {
      case 'noNumber':
        return f.reason ? `${f.title} (${reason(f.reason)})` : f.title
      case 'numbersFull':
        return `${f.title} (Unterordner ${f.sub} hat schon 99 Chats)`
      case 'missingGroup':
        return `${f.title} (kein Ordner «${f.group}»)`
      case 'unclearGroup':
        return `${f.title} (mehrere Ordner «${f.group}»)`
      case 'wrongGroup':
        return `${f.title} → in «${f.group}» verschieben`
      case 'duplicate':
        return `«${f.other}» und «${f.title}»`
      case 'duplicateRegister':
        return `${f.num} ist im Register schon vergeben`
    }
  },
  reason: r => {
    switch (r.code) {
      case 'autoFixOff':
        return 'Selbst-Nummerieren aus'
      case 'incomplete':
        return 'mehr als 300 Chats, Liste unvollständig'
      case 'paneInactive':
        return 'Panel in diesem Chat nicht aktiv'
      case 'locked':
        return 'anderer Chat nummeriert gerade'
      case 'error':
        return (r.message ?? 'Fehler').slice(0, 120)
    }
  },
  config: {
    invalidJson: file => `${file}: kein gültiges JSON`,
    broken: details => `Einstellungen fehlerhaft: ${details}`,
    error: e => {
      switch (e.code) {
        case 'notObject':
          return 'kein JSON-Objekt'
        case 'noProject':
          return '«project» fehlt'
        case 'noAreas':
          return '«areas» fehlt'
        case 'badAreaId':
          return 'ein Bereich hat keine gültige «id» (zwei Ziffern)'
        case 'dupArea':
          return `Bereich ${e.area} kommt doppelt vor`
        case 'badSubId':
          return `Bereich ${e.area}: ein Unterordner hat keine gültige «id» (${e.area}-NN)`
        case 'dupSub':
          return `Bereich ${e.area}: ein Unterordner kommt doppelt vor`
        case 'badGroup':
          return `Bereich ${e.area}: «group» ist kein Ordnername`
        case 'badRegister':
          return '«register» ist kein Objekt'
        case 'badRegisterNum':
          return `Register: «${e.num}» ist keine Nummer (NN-SS-CC)`
        case 'noSession':
          return `Register ${e.num}: «session» fehlt`
      }
    },
  },
}

const TEXTS: Record<Lang, Texts> = { en, de }

export function texts(lang: Lang): Texts {
  return TEXTS[lang] ?? en
}

// A finding as one line of text in the given language.
export function findingText(lang: Lang, f: Finding): string {
  const t = texts(lang)
  return t.findingText(f, t.reason)
}

// A problem in a project file as text in the given language.
export function configErrorText(lang: Lang, e: ConfigError): string {
  return texts(lang).config.error(e)
}

// Locale for times shown in the pane.
export function locale(lang: Lang): string {
  return lang === 'de' ? 'de-CH' : 'en-GB'
}
