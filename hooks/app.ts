import type { EngineInterface } from 'claude-code'

import type { Chat, Finding } from '../types'
import type { Action, Group } from './logic'
import { doneText, failedFinding, savedResultPath, toChats } from './logic'

// Aufrufe an die App-Dienste der Desktop-App (ccd_session_mgmt, ccd_sidebar).

type Res = { content: Array<{ type: string; text?: string }>; isError?: boolean }

async function call($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<Res> {
  try {
    return (await $.mcp.call(server, tool, args)) as Res
  } catch {
    // Beim Chatstart ist der App-Dienst oft noch nicht verbunden: verbinden und erneut versuchen.
    await $.mcp.connect(server)
    return (await $.mcp.call(server, tool, args)) as Res
  }
}

export async function callText($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const res = await call($, server, tool, args)
  let text = res.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  // Grosse Antworten legt die App in einer Datei ab und nennt nur den Pfad. Gelesen wird nur ein solcher
  // Hinweis (kurze Antwort, Datei im Ergebnisordner der App), nie ein Pfad, der irgendwo in Titeln steht.
  const saved = savedResultPath(text, (await $.env.get('HOME')) ?? '')
  if (saved) text = await $.fs.read(saved)
  if (res.isError) throw new Error(text.slice(0, 200))
  return text
}

export async function callJson($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await callText($, server, tool, args))
}

type Row = Record<string, unknown>

export async function getSelf($: EngineInterface): Promise<Row> {
  return (await callJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Row
}

// Alle Chats des Projekts, der eigene Chat immer dabei. list_sessions liefert höchstens 300 Chats;
// `complete` ist false, wenn die Liste voll ist und ältere Chats fehlen können.
export const MAX_SESSIONS = 300
export async function listChats(
  $: EngineInterface,
  project: string,
  others: string[],
): Promise<{ chats: Chat[]; selfId: string; self: Row; complete: boolean }> {
  const rows = (await callJson($, 'ccd_session_mgmt', 'list_sessions', { limit: MAX_SESSIONS })) as Row[]
  const self = await getSelf($)
  const selfId = String(self.sessionId ?? '')
  const all = [...rows.filter(r => String(r.sessionId) !== selfId), self]
  return { chats: toChats(all, project, others), selfId, self, complete: rows.length < MAX_SESSIONS }
}

export async function listGroups($: EngineInterface): Promise<Group[]> {
  return (await callJson($, 'ccd_sidebar', 'list_groups', {})) as Group[]
}

export async function listEvents($: EngineInterface, sessionId: string): Promise<string> {
  return callText($, 'ccd_session_mgmt', 'list_events', { session_id: sessionId, limit: 8 })
}

// Geplante Schritte ausführen; was scheitert, wird zum Befund.
export async function runActions($: EngineInterface, actions: Action[]): Promise<{ done: Action[]; fixed: string[]; failed: Finding[] }> {
  const done: Action[] = []
  const fixed: string[] = []
  const failed: Finding[] = []
  for (const a of actions) {
    try {
      await callText($, 'ccd_session_mgmt', 'set_session_title', { session_id: a.chatId, title: a.title })
      done.push(a)
      fixed.push(doneText(a))
    } catch (err) {
      failed.push(failedFinding(a, err instanceof Error ? err.message : String(err)))
    }
  }
  return { done, fixed, failed }
}
