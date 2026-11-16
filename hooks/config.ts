import type { EngineInterface } from 'claude-code'

import type { Config, Global } from '../types'
import { configErrorText, texts } from './i18n'
import { normalizeConfig, normalizeGlobal, pickProject } from './logic'

// Settings: one file per project in ~/.claude/chat-navigator/<name>.json, plus the central
// config.json for all projects. The navigator takes the project file whose path matches the chat's folder.

export const GLOBAL_FILE = 'config.json'

// `others`: paths of all configured projects, so sub-projects keep their own chats.
export type Project = { file: string; key: string; cfg: Config; others: string[] }

export async function settingsDir($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  return `${home}/.claude/chat-navigator`
}

// Central file; without it, the defaults apply. If it is broken, the defaults apply too, with an error.
async function loadGlobal($: EngineInterface, dir: string): Promise<{ global: Global; broken: boolean }> {
  const file = `${dir}/${GLOBAL_FILE}`
  if (!(await $.fs.exists(file))) return { global: normalizeGlobal({}), broken: false }
  try {
    return { global: normalizeGlobal(JSON.parse(await $.fs.read(file))), broken: false }
  } catch {
    // Broken central file: defaults, but no automatic numbering to be safe.
    return { global: normalizeGlobal({ settings: { autoFix: false } }), broken: true }
  }
}

// Central file and all readable projects; broken files come back as errors instead of blocking everything.
export async function loadProjects($: EngineInterface): Promise<{ projects: Project[]; global: Global; errors: string[] }> {
  const dir = await settingsDir($)
  if (!(await $.fs.exists(dir))) return { projects: [], global: normalizeGlobal({}), errors: [] }
  const { global, broken } = await loadGlobal($, dir)
  const t = texts(global.language)
  const projects: Project[] = []
  const errors: string[] = broken ? [t.config.invalidJson(GLOBAL_FILE)] : []
  for (const e of await $.fs.list(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json') || e.name === GLOBAL_FILE) continue
    const file = `${dir}/${e.name}`
    let raw: unknown
    try {
      raw = JSON.parse(await $.fs.read(file))
    } catch {
      errors.push(t.config.invalidJson(e.name))
      continue
    }
    const r = normalizeConfig(raw, global.settings)
    if ('error' in r) {
      errors.push(`${e.name}: ${configErrorText(global.language, r.error)}`)
      continue
    }
    // Broken central file: automatic numbering stays off, even if the project file turns it on.
    if (broken) r.cfg.settings.autoFix = false
    projects.push({ file, key: e.name.replace(/\.json$/, ''), cfg: r.cfg, others: [] })
  }
  const all = projects.map(p => p.cfg.project)
  for (const p of projects) p.others = all
  return { projects, global, errors }
}

// The project for a folder. `error` lists broken settings files, if any.
export async function projectFor($: EngineInterface, cwd: string): Promise<{ project: Project | null; global: Global; error: string }> {
  const { projects, global, errors } = await loadProjects($)
  const project = pickProject(cwd, projects)
  const error = errors.length > 0 ? texts(global.language).config.broken(errors.join('; ')) : ''
  return { project, global, error }
}

// Write new register entries to the file. The file is read again first, so changes made by hand or from
// other chats are kept and other keys stay untouched. A number that already belongs to another chat there
// is never overwritten (the skipped numbers are returned).
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
