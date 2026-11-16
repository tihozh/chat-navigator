import type { EngineInterface } from 'claude-code'

import type { Config, Global } from '../types'
import { normalizeConfig, normalizeGlobal, pickProject } from './logic'

// Einstellungen: eine Datei je Projekt in ~/.claude/chat-navigator/<name>.json, dazu die zentrale
// config.json für alle Projekte. Der Navigator nimmt die Projektdatei, deren Pfad zum Ordner des Chats passt.

export const GLOBAL_FILE = 'config.json'

// `others`: Projektpfade aller eingerichteten Projekte, damit Unterprojekte ihre Chats behalten.
export type Project = { file: string; key: string; cfg: Config; others: string[] }

export async function settingsDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/chat-navigator`
}

// Zentrale Datei; fehlt sie, gelten die Vorgaben. Ist sie kaputt, gelten auch die Vorgaben, mit Fehlertext.
async function loadGlobal($: EngineInterface, dir: string): Promise<{ global: Global; error: string }> {
  const file = `${dir}/${GLOBAL_FILE}`
  if (!(await $.fs.exists(file))) return { global: normalizeGlobal({}), error: '' }
  try {
    return { global: normalizeGlobal(JSON.parse(await $.fs.read(file))), error: '' }
  } catch {
    // Kaputte zentrale Datei: Vorgaben, aber sicherheitshalber ohne Selbst-Ordnen.
    return { global: normalizeGlobal({ settings: { autoFix: false } }), error: `${GLOBAL_FILE}: kein gültiges JSON` }
  }
}

// Zentrale Datei und alle lesbaren Projekte; kaputte Dateien kommen als Fehler zurück, statt alles zu blockieren.
export async function loadProjects($: EngineInterface): Promise<{ projects: Project[]; global: Global; errors: string[] }> {
  const dir = await settingsDir($)
  if (!(await $.fs.exists(dir))) return { projects: [], global: normalizeGlobal({}), errors: [] }
  const { global, error } = await loadGlobal($, dir)
  const projects: Project[] = []
  const errors: string[] = error !== '' ? [error] : []
  for (const e of await $.fs.list(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === GLOBAL_FILE) continue
    const file = `${dir}/${e.name}`
    let raw: unknown
    try {
      raw = JSON.parse(await $.fs.read(file))
    } catch {
      errors.push(`${e.name}: kein gültiges JSON`)
      continue
    }
    const r = normalizeConfig(raw, global.settings)
    if ('error' in r) errors.push(`${e.name}: ${r.error}`)
    else {
      // Kaputte zentrale Datei: Selbst-Ordnen bleibt aus, auch wenn die Projektdatei es einschaltet.
      if (error !== '') r.cfg.settings.autoFix = false
      projects.push({ file, key: e.name.replace(/\.json$/, ''), cfg: r.cfg, others: [] })
    }
  }
  const all = projects.map(p => p.cfg.project)
  for (const p of projects) p.others = all
  return { projects, global, errors }
}

// Das Projekt für einen Ordner. `error` erklärt, warum keins passt.
export async function projectFor($: EngineInterface, cwd: string): Promise<{ project: Project | null; global: Global; error: string }> {
  const { projects, global, errors } = await loadProjects($)
  const project = pickProject(cwd, projects)
  const error = errors.length > 0 ? `Einstellungen fehlerhaft: ${errors.join('; ')}` : ''
  return { project, global, error }
}

// Neue Register-Einträge in die Datei schreiben. Die Datei wird frisch gelesen, damit Änderungen von Hand
// oder aus anderen Chats erhalten bleiben; andere Schlüssel bleiben unberührt. Eine Nummer, die dort schon
// für einen anderen Chat steht, wird nicht überschrieben (zurück kommen die übersprungenen Nummern).
export async function addToRegister($: EngineInterface, p: Project, add: Config['register']): Promise<string[]> {
  if (Object.keys(add).length === 0) return []
  const raw = JSON.parse(await $.fs.read(p.file)) as Record<string, unknown>
  const reg = (raw.register && typeof raw.register === 'object' ? raw.register : {}) as Config['register']
  const skipped: string[] = []
  const merged = { ...reg }
  for (const [num, v] of Object.entries(add)) {
    const had = reg[num]
    if (had && had.session !== v.session) skipped.push(num)
    else merged[num] = v
  }
  raw.register = merged
  await $.fs.write(p.file, `${JSON.stringify(raw, null, 2)}\n`)
  return skipped
}
