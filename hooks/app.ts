import type { EngineInterface } from 'claude-code'

import type { Chat, Finding } from '../types'
import type { Action, Group } from './logic'
import { failedFinding, savedResultPath, toChats } from './logic'

// Calls to the services of the desktop app (ccd_session_mgmt, ccd_sidebar).

type Res = { content: Array<{ type: string; text?: string }>; isError?: boolean }

async function call($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<Res> {
  try {
    return (await $.mcp.call(server, tool, args)) as Res
  } catch {
    // When a chat starts, the app service is often not connected yet: connect and try again.
    await $.mcp.connect(server)
    return (await $.mcp.call(server, tool, args)) as Res
  }
}

export async function callText($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const res = await call($, server, tool, args)
  let text = res.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  // The app saves large responses to a file and only names the path. Only such a notice is followed
  // (short, file in the app's results folder), never a path that appears somewhere in a title.
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

// All chats of the project, the current chat always included. list_sessions returns at most 300 chats;
// `complete` is false when the list is full and older chats may be missing.
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

// Carry out the planned renames; whatever fails becomes a finding.
export async function runActions($: EngineInterface, actions: Action[]): Promise<{ done: Action[]; failed: Finding[] }> {
  const done: Action[] = []
  const failed: Finding[] = []
  for (const a of actions) {
    try {
      await callText($, 'ccd_session_mgmt', 'set_session_title', { session_id: a.chatId, title: a.title })
      done.push(a)
    } catch (err) {
      failed.push(failedFinding(a, { code: 'error', message: err instanceof Error ? err.message : String(err) }))
    }
  }
  return { done, failed }
}
