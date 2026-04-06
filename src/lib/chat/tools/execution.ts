/**
 * Tool execution — ENDPOINT_MAP, jsonSetField(), executeTool(), buildToolDefinitions().
 */

import type { EndpointSpec, ToolDef } from './registry';
import { TOOLS } from './registry';
import { ASK_QUESTION_TOOL, UPDATE_CONFIG_TOOL } from './clientTools';

// ─── Derived Lookups ─────────────────────────────────────────────────────────

const ENDPOINT_MAP = new Map<string, EndpointSpec>(
  TOOLS.map((t) => [t.tool.name, t.endpoint]),
);

/** Set a key under [section] in a JSON config string. Parses, patches, re-serializes. */
const jsonSetField = (json: string, section: string, key: string, value: string): string => {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(json);
  } catch {
    doc = {};
  }
  if (!doc[section] || typeof doc[section] !== 'object') {
    doc[section] = {};
  }
  (doc[section] as Record<string, unknown>)[key] = value;
  return JSON.stringify(doc);
};

// ─── Public API ──────────────────────────────────────────────────────────────

export const buildToolDefinitions = (): ToolDef[] => [
  ...TOOLS.map((t) => t.tool),
  ASK_QUESTION_TOOL,
  UPDATE_CONFIG_TOOL,
];

export const executeTool = async (
  name: string,
  input: Record<string, unknown>,
  customerToken: string,
  macMgmtUrl: string,
): Promise<string> => {
  // ── Custom tool: update_config (atomic read-modify-write) ───────────────
  if (name === 'update_config') {
    const { section, key, value } = input as { section: string; key: string; value: string };
    const headers = { Authorization: `Bearer ${customerToken}`, Accept: 'application/json' };

    try {
      // Read current config
      const getRes = await fetch(`${macMgmtUrl}/api/setting/config`, { headers });
      const currentJson = getRes.ok ? await getRes.text() : '{}';

      // Patch field
      const updated = jsonSetField(currentJson, section, key, value);

      // Write back (API expects the config object directly as the body)
      const putRes = await fetch(`${macMgmtUrl}/api/setting/config`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: updated,
      });

      if (!putRes.ok) {
        const detail = await putRes.text();
        return JSON.stringify({ error: `HTTP ${putRes.status}`, detail });
      }
      return updated;
    } catch (err) {
      return JSON.stringify({
        error: 'Network error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Generic endpoint-based tools ────────────────────────────────────────
  const spec = ENDPOINT_MAP.get(name);
  if (!spec) {
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  // Build URL, appending path param and suffix if needed (e.g., DELETE /skills/{id}, GET /bundles/{id}/skills)
  let url = `${macMgmtUrl}${spec.path}`;
  if (spec.pathParam && input[spec.pathParam]) {
    url += `/${input[spec.pathParam]}`;
  }
  if (spec.pathSuffix) {
    url += spec.pathSuffix;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${customerToken}`,
    Accept: 'application/json',
  };

  const fetchOptions: RequestInit = {
    method: spec.method,
    headers,
  };

  // Send JSON body for POST/PUT (exclude the pathParam field from the body)
  if (spec.jsonBody && input) {
    const body = { ...input };
    if (spec.pathParam) {
      delete body[spec.pathParam];
    }
    fetchOptions.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    if (!response.ok) {
      return JSON.stringify({
        error: `HTTP ${response.status}`,
        detail: text,
      });
    }
    return text || JSON.stringify({ success: true });
  } catch (err) {
    return JSON.stringify({
      error: 'Network error',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
};
