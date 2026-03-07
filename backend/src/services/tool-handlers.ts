/**
 * Execute tool by type. Handlers for webhook, http_request, database_lookup, human_handoff.
 */

import { prisma } from '../db/prisma.js';
import { publishAsync } from './event-bus.js';

export type ToolConfig = Record<string, unknown>;

export type ToolResult = { success: true; data: unknown } | { success: false; error: string };

/** Webhook: POST/GET to config.url. Config: { url: string, method?: 'POST'|'GET', headers?: Record<string,string> }. Args: { payload?: string } */
async function runWebhook(config: ToolConfig, args: Record<string, unknown>): Promise<ToolResult> {
  const url = config['url'] as string;
  if (!url) return { success: false, error: 'Missing url in tool config' };
  const method = ((config['method'] as string) || 'POST').toUpperCase();
  const headers = (config['headers'] as Record<string, string>) || {};
  const body = args['payload'] ?? args['body'] ?? (method === 'POST' ? {} : undefined);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** HTTP request: fetch config.url. Config: { url: string, method?: string, headers?: Record<string,string> }. Args: { body?: string } */
async function runHttpRequest(config: ToolConfig, args: Record<string, unknown>): Promise<ToolResult> {
  const url = config['url'] as string;
  if (!url) return { success: false, error: 'Missing url in tool config' };
  const method = ((config['method'] as string) || 'GET').toUpperCase();
  const headers = (config['headers'] as Record<string, string>) || {};
  let body: string | undefined;
  const b = args['body'] ?? args['payload'];
  if (b != null) body = typeof b === 'string' ? b : JSON.stringify(b);
  try {
    const res = await fetch(url, {
      method,
      headers: { ...headers },
      body,
    });
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Database lookup: simple lookup. Config: { table: string, column?: string }. Args: { key: string } or { query: string }. Uses raw query for safety with allowlisted table. */
async function runDatabaseLookup(config: ToolConfig, args: Record<string, unknown>): Promise<ToolResult> {
  const table = config['table'] as string;
  if (!table) return { success: false, error: 'Missing table in tool config' };
  const allowlist = ['agents', 'documents', 'knowledge_bases', 'tools', 'call_sessions'];
  const safeTable = table.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!allowlist.includes(safeTable)) return { success: false, error: 'Table not allowed for lookup' };
  const key = args['key'] ?? args['query'] ?? args['id'];
  if (key == null || String(key).trim() === '') return { success: false, error: 'Missing key/query argument' };
  const column = (config['column'] as string) || 'id';
  const safeColumn = column.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!safeColumn) return { success: false, error: 'Invalid column' };
  try {
    const value = String(key).trim();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${safeTable}" WHERE "${safeColumn}" = $1 LIMIT 10`,
      value
    );
    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type ToolType = 'WEBHOOK' | 'HTTP_REQUEST' | 'DATABASE_LOOKUP' | 'HUMAN_HANDOFF';

/** HUMAN_HANDOFF: publish call.handoff_requested. Config: { dashboardUrl?, notifyChannel? }. Args: callSessionId (required when passed from pipeline). */
async function runHumanHandoff(
  config: ToolConfig,
  args: Record<string, unknown>,
  callSessionId?: string
): Promise<ToolResult> {
  const sid = (args['callSessionId'] as string) ?? callSessionId;
  if (!sid) return { success: false, error: 'callSessionId required for handoff' };
  publishAsync(sid, 'call.handoff_requested', {
    dashboardUrl: config['dashboardUrl'],
    notifyChannel: config['notifyChannel'],
  });
  return { success: true, data: { message: 'Human handoff requested', callSessionId: sid } };
}

export async function executeTool(
  type: ToolType,
  config: ToolConfig,
  args: Record<string, unknown>,
  options?: { callSessionId?: string }
): Promise<ToolResult> {
  switch (type) {
    case 'WEBHOOK':
      return runWebhook(config, args);
    case 'HTTP_REQUEST':
      return runHttpRequest(config, args);
    case 'DATABASE_LOOKUP':
      return runDatabaseLookup(config, args);
    case 'HUMAN_HANDOFF':
      return runHumanHandoff(config, args, options?.callSessionId);
    default:
      return { success: false, error: `Unknown tool type: ${type}` };
  }
}
