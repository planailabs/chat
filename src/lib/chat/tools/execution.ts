/**
 * Tool execution — ENDPOINT_MAP, executeTool(), buildToolDefinitions().
 */

import type { EndpointSpec, ToolDef } from './registry';
import { TOOLS } from './registry';
import { ASK_QUESTION_TOOL } from './clientTools';

// ─── Derived Lookups ─────────────────────────────────────────────────────────

const ENDPOINT_MAP = new Map<string, EndpointSpec>(
  TOOLS.map((t) => [t.tool.name, t.endpoint]),
);

// ─── Public API ──────────────────────────────────────────────────────────────

export const buildToolDefinitions = (): ToolDef[] => [
  ...TOOLS.map((t) => t.tool),
  ASK_QUESTION_TOOL,
];

export const executeTool = async (
  name: string,
  input: Record<string, unknown>,
  customerToken: string,
  macMgmtUrl: string,
): Promise<string> => {
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

  // Send JSON body for POST/PUT/PATCH (exclude the pathParam field from the body)
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
