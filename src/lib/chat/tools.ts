/**
 * mac-mgmt Setting API Tool Definitions + Executor
 *
 * Each tool is defined once as a single record combining its Claude tool
 * definition with the HTTP endpoint spec. `buildToolDefinitions()` and
 * `executeTool()` derive what they need from this shared source of truth.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { parse, stringify } from 'smol-toml';

// ─── Shared Types ────────────────────────────────────────────────────────────

type ToolDef = Anthropic.Tool;

interface EndpointSpec {
  method: string;
  path: string;
  /** Append this input field as a path segment (e.g. DELETE /skills/{id}) */
  pathParam?: string;
  /** Append a fixed suffix after the path param (e.g. /bundles/{id}/skills) */
  pathSuffix?: string;
  /** Send input as JSON body (POST / PUT) */
  jsonBody?: boolean;
}

interface ToolEntry {
  tool: ToolDef;
  endpoint: EndpointSpec;
}

const obj = (
  props: Record<string, { type: string; description: string }> = {},
  required?: string[],
): ToolDef['input_schema'] => ({
  type: 'object' as const,
  properties: props,
  ...(required ? { required } : {}),
});

// ─── Tool Registry ───────────────────────────────────────────────────────────

const TOOLS: ToolEntry[] = [
  // ── Identity ─────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'get_identity',
      description:
        'Get the identity of the current customer associated with this token. Returns customer_id, customer_name, and token_kind.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/self' },
  },

  // ── Config ───────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'get_config',
      description:
        'Get the current TOML configuration for this customer. Returns the full config file contents.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/config' },
  },
  {
    tool: {
      name: 'set_config',
      description:
        'Replace the entire TOML configuration for this customer. Pass the full TOML string.',
      input_schema: obj(
        { config_toml: { type: 'string', description: 'The full TOML configuration to set.' } },
        ['config_toml'],
      ),
    },
    endpoint: { method: 'PUT', path: '/api/setting/config', jsonBody: true },
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_skills',
      description:
        'List all skills currently assigned to this customer. Returns id, skill_slug, channel, installed, installed_bundle, and customer_skill_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/skills' },
  },
  {
    tool: {
      name: 'add_skill',
      description:
        'Add a skill to this customer by skill channel ID (UUID). Use available_skill_channels to find the ID first.',
      input_schema: obj(
        { skill_channel_id: { type: 'string', description: 'The UUID of the skill channel to add.' } },
        ['skill_channel_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/skills', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_skill',
      description:
        'Remove a skill assignment from this customer by its customer_skill_id (UUID). Use list_skills to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The customer_skill_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/skills', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_skill_channels',
      description:
        'List all available skill channels that can be added. Returns id, skill_slug, channel, installed, and installed_bundle for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/skill-channels' },
  },

  // ── Bundles ──────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_bundles',
      description:
        'List all application bundles currently assigned to this customer. Returns customer_bundle_id, bundle_slug, and bundle_name.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/bundles' },
  },
  {
    tool: {
      name: 'add_bundle',
      description:
        'Add an application bundle to this customer by bundle ID (UUID). Use available_bundles to find the ID first.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_bundle',
      description:
        'Remove a bundle assignment from this customer by its customer_bundle_id (UUID). Use list_bundles to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The customer_bundle_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/bundles', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_bundles',
      description:
        'List all available application bundles that can be added. Returns id, slug, name, and installed boolean for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/bundles' },
  },

  // ── MCP Servers ──────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_mcp_servers',
      description:
        'List all MCP servers currently assigned to this customer. Returns id, slug, name, installed, installed_bundle, installed_transitive, and customer_mcp_server_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-servers' },
  },
  {
    tool: {
      name: 'add_mcp_server',
      description:
        'Add an MCP server to this customer by server ID (UUID). Use available_mcp_servers to find the ID first.',
      input_schema: obj(
        { mcp_server_id: { type: 'string', description: 'The UUID of the MCP server to add.' } },
        ['mcp_server_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-servers', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_mcp_server',
      description:
        'Remove an MCP server assignment from this customer by its customer_mcp_server_id (UUID). Use list_mcp_servers to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The customer_mcp_server_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/mcp-servers', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_mcp_servers',
      description:
        'List all available MCP servers that can be added. Returns id, slug, name, installed, installed_bundle, and installed_transitive for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-servers' },
  },

  // ── MCP Bundles ──────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_mcp_bundles',
      description:
        'List all MCP bundles currently assigned to this customer. Returns customer_mcp_bundle_id, bundle_slug, and bundle_name.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-bundles' },
  },
  {
    tool: {
      name: 'add_mcp_bundle',
      description:
        'Add an MCP bundle to this customer by bundle ID (UUID). Use available_mcp_bundles to find the ID first.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the MCP bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_mcp_bundle',
      description:
        'Remove an MCP bundle assignment from this customer by its customer_mcp_bundle_id (UUID). Use list_mcp_bundles to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The customer_mcp_bundle_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/mcp-bundles', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_mcp_bundles',
      description:
        'List all available MCP bundles that can be added. Returns id, slug, name, and installed boolean for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-bundles' },
  },

  // ── Bundle Contents ────────────────────────────────────────────────
  {
    tool: {
      name: 'list_bundle_skills',
      description:
        'List the skill channels included in a specific bundle. Returns id, skill_slug, and channel for each skill in the bundle.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the bundle.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/bundles', pathParam: 'bundle_id', pathSuffix: '/skills' },
  },
  {
    tool: {
      name: 'list_mcp_bundle_servers',
      description:
        'List the MCP servers included in a specific MCP bundle. Returns id, slug, and name for each server in the bundle.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the MCP bundle.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-bundles', pathParam: 'bundle_id', pathSuffix: '/mcp-servers' },
  },

  // ── Catalog (combined view) ─────────────────────────────────────────
  {
    tool: {
      name: 'list_catalog',
      description:
        'List ALL available bundles, skills, MCP bundles, and MCP servers in a single call. Returns { skill_channels, bundles, mcp_servers, mcp_bundles }. Bundles and MCP bundles include their nested skills/servers. Items include installed, installed_bundle, and installed_transitive flags where applicable.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/catalog' },
  },
];

// ─── Client-Side Tools (no endpoint — intercepted on the server) ────────────

export const ASK_QUESTION_TOOL: ToolDef = {
  name: 'ask_question',
  description:
    'Ask the user a structured question. Use "multiple_choice" for picking from options, "text" for free-form input.',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['multiple_choice', 'text'],
        description: 'Question type.',
      },
      question: { type: 'string', description: 'The question text.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Options for multiple_choice. Omit for text.',
      },
    },
    required: ['type', 'question'],
  },
};

export const PROMPT_PREFERENCE_TOOL: ToolDef = {
  name: 'prompt_preference',
  description:
    'Prompt the user about a preference (e.g. newsletter subscription). The client renders the question and Yes/No buttons. Returns "subscribed" or "declined".',
  input_schema: {
    type: 'object',
    properties: {
      preference_id: {
        type: 'string',
        enum: ['newsletter'],
        description: 'Which preference to prompt for.',
      },
    },
    required: ['preference_id'],
  },
};

import { DOC_IDS } from './content';

export const GET_PRODUCT_INFO_TOOL: ToolDef = {
  name: 'get_product_info',
  description:
    'Retrieve product documentation about plan.ai. Use this to answer questions about the product, its features, architecture, use cases, pricing, or how to get started. Always call this tool before answering product-related questions.',
  input_schema: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        enum: DOC_IDS,
        description: 'The documentation topic to retrieve.',
      },
    },
    required: ['topic'],
  },
};

const UPDATE_CONFIG_TOOL: ToolDef = {
  name: 'update_config',
  description:
    'Update a single field in the TOML configuration. Atomically reads the current config, sets the field under the given section, and saves it back. Use this instead of get_config + set_config when you need to change individual fields.',
  input_schema: {
    type: 'object',
    properties: {
      section: { type: 'string', description: 'The TOML section name (e.g. "global").' },
      key: { type: 'string', description: 'The key to set within the section.' },
      value: { type: 'string', description: 'The value to set.' },
    },
    required: ['section', 'key', 'value'],
  },
};

const CLIENT_SIDE_TOOLS = new Set(['ask_question', 'prompt_preference']);

/** Returns true if the tool is handled client-side (no API call). */
export const isClientSideTool = (name: string): boolean =>
  CLIENT_SIDE_TOOLS.has(name);

// ─── Derived Lookups ─────────────────────────────────────────────────────────

const ENDPOINT_MAP = new Map<string, EndpointSpec>(
  TOOLS.map((t) => [t.tool.name, t.endpoint]),
);

/** Set a key under [section] in a TOML string. Parses, patches, re-serializes. */
const tomlSetField = (toml: string, section: string, key: string, value: string): string => {
  let doc: Record<string, unknown>;
  try {
    doc = parse(toml);
  } catch {
    doc = {};
  }
  if (!doc[section] || typeof doc[section] !== 'object') {
    doc[section] = {};
  }
  (doc[section] as Record<string, unknown>)[key] = value;
  return stringify(doc);
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
      const currentToml = getRes.ok ? await getRes.text() : '';

      // Patch field
      const updated = tomlSetField(currentToml, section, key, value);

      // Write back
      const putRes = await fetch(`${macMgmtUrl}/api/setting/config`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_toml: updated }),
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
