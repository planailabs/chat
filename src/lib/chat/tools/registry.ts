/**
 * Tool registry — shared types and the TOOLS array.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ─── Shared Types ────────────────────────────────────────────────────────────

export type ToolDef = Anthropic.Tool;

export interface EndpointSpec {
  method: string;
  path: string;
  /** Append this input field as a path segment (e.g. DELETE /skills/{id}) */
  pathParam?: string;
  /** Append a fixed suffix after the path param (e.g. /bundles/{id}/skills) */
  pathSuffix?: string;
  /** Send input as JSON body (POST / PUT) */
  jsonBody?: boolean;
}

export interface ToolEntry {
  tool: ToolDef;
  endpoint: EndpointSpec;
}

export const obj = (
  props: Record<string, { type: string; description: string }> = {},
  required?: string[],
): ToolDef['input_schema'] => ({
  type: 'object' as const,
  properties: props,
  ...(required ? { required } : {}),
});

// ─── Tool Registry ───────────────────────────────────────────────────────────

export const TOOLS: ToolEntry[] = [
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
