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
        'Get the current JSON configuration for this customer. Returns the full config object.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/config' },
  },
  {
    tool: {
      name: 'set_config',
      description:
        'Replace the entire JSON configuration for this customer. Pass the full config as a JSON object.',
      input_schema: {
        type: 'object' as const,
        description: 'The full configuration object. Its top-level keys are section names (e.g. "global", "daemon").',
        additionalProperties: true,
      },
    },
    endpoint: { method: 'PUT', path: '/api/setting/config', jsonBody: true },
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_skills',
      description:
        'List all skills currently assigned to this customer. Returns id, skill_slug, skill_name, skill_description, channel, installed, installed_bundle, and customer_skill_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/skills' },
  },
  {
    tool: {
      name: 'add_skill',
      description:
        'Add a single skill to this customer by skill channel ID (UUID). Use available_skill_channels to find the ID first. Prefer batch_add_skills when adding multiple skills.',
      input_schema: obj(
        { skill_channel_id: { type: 'string', description: 'The UUID of the skill channel to add.' } },
        ['skill_channel_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/skills', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_add_skills',
      description:
        'Add multiple skills at once by their skill channel IDs (UUIDs). Already-assigned skills are silently skipped. Prefer this over multiple add_skill calls.',
      input_schema: {
        type: 'object' as const,
        properties: {
          skill_channel_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of skill channel UUIDs to add.',
          },
        },
        required: ['skill_channel_ids'],
      },
    },
    endpoint: { method: 'POST', path: '/api/setting/skills/batch', jsonBody: true },
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
        'List all available skill channels that can be added. Returns id, skill_slug, skill_name, skill_description, channel, installed, installed_bundle, and customer_skill_id for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/skill-channels' },
  },

  // ── Bundles ──────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_bundles',
      description:
        'List all application bundles currently assigned to this customer. Returns customer_bundle_id, bundle_slug, bundle_name, and bundle_description.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/bundles' },
  },
  {
    tool: {
      name: 'add_bundle',
      description:
        'Add a single application bundle to this customer by bundle ID (UUID). Use available_bundles to find the ID first. Prefer batch_add_bundles when adding multiple bundles.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_add_bundles',
      description:
        'Add multiple application bundles at once by their bundle IDs (UUIDs). Already-assigned bundles are silently skipped. Prefer this over multiple add_bundle calls.',
      input_schema: {
        type: 'object' as const,
        properties: {
          bundle_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of bundle UUIDs to add.',
          },
        },
        required: ['bundle_ids'],
      },
    },
    endpoint: { method: 'POST', path: '/api/setting/bundles/batch', jsonBody: true },
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
        'List all available application bundles that can be added. Returns id, slug, name, description, and installed boolean for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/bundles' },
  },

  // ── MCP Servers ──────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_mcp_servers',
      description:
        'List all MCP servers currently assigned to this customer. Returns id, slug, name, description, installed, installed_bundle, installed_transitive, and customer_mcp_server_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-servers' },
  },
  {
    tool: {
      name: 'add_mcp_server',
      description:
        'Add a single MCP server to this customer by server ID (UUID). Use available_mcp_servers to find the ID first. Prefer batch_add_mcp_servers when adding multiple servers.',
      input_schema: obj(
        { mcp_server_id: { type: 'string', description: 'The UUID of the MCP server to add.' } },
        ['mcp_server_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-servers', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_add_mcp_servers',
      description:
        'Add multiple MCP servers at once by their server IDs (UUIDs). Already-assigned servers are silently skipped. Prefer this over multiple add_mcp_server calls.',
      input_schema: {
        type: 'object' as const,
        properties: {
          mcp_server_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of MCP server UUIDs to add.',
          },
        },
        required: ['mcp_server_ids'],
      },
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-servers/batch', jsonBody: true },
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
        'List all available MCP servers that can be added. Returns id, slug, name, description, installed, installed_bundle, installed_transitive, and customer_mcp_server_id for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-servers' },
  },

  // ── MCP Bundles ──────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_mcp_bundles',
      description:
        'List all MCP bundles currently assigned to this customer. Returns customer_mcp_bundle_id, bundle_slug, bundle_name, and bundle_description.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-bundles' },
  },
  {
    tool: {
      name: 'add_mcp_bundle',
      description:
        'Add a single MCP bundle to this customer by bundle ID (UUID). Use available_mcp_bundles to find the ID first. Prefer batch_add_mcp_bundles when adding multiple bundles.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the MCP bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_add_mcp_bundles',
      description:
        'Add multiple MCP bundles at once by their bundle IDs (UUIDs). Already-assigned bundles are silently skipped. Prefer this over multiple add_mcp_bundle calls.',
      input_schema: {
        type: 'object' as const,
        properties: {
          bundle_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of MCP bundle UUIDs to add.',
          },
        },
        required: ['bundle_ids'],
      },
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-bundles/batch', jsonBody: true },
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
        'List all available MCP bundles that can be added. Returns id, slug, name, description, and installed boolean for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-bundles' },
  },

  // ── Bundle Contents ────────────────────────────────────────────────
  {
    tool: {
      name: 'list_bundle_skills',
      description:
        'List the skill channels included in a specific bundle. Returns id, skill_slug, skill_name, skill_description, and channel for each skill in the bundle.',
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
        'List the MCP servers included in a specific MCP bundle. Returns id, slug, name, and description for each server in the bundle.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the MCP bundle.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-bundles', pathParam: 'bundle_id', pathSuffix: '/mcp-servers' },
  },

  // ── SSH Keys ────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_ssh_keys',
      description:
        'List all SSH keys for this customer. Returns id, fingerprint (SHA256), comment, and created_at for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/ssh-keys' },
  },
  {
    tool: {
      name: 'add_ssh_key',
      description:
        'Add an SSH public key for this customer. The API parses the key to extract the fingerprint and comment.',
      input_schema: obj(
        { public_key: { type: 'string', description: 'The full SSH public key string.' } },
        ['public_key'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/ssh-keys', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_ssh_key',
      description:
        'Remove an SSH key by its ID (UUID). Use list_ssh_keys to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The UUID of the SSH key to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/ssh-keys', pathParam: 'id' },
  },

  // ── Catalog (combined view) ─────────────────────────────────────────
  {
    tool: {
      name: 'list_catalog',
      description:
        'List ALL available bundles, skills, MCP bundles, and MCP servers in a single call. Returns { skill_channels, bundles, mcp_servers, mcp_bundles }. Bundles and MCP bundles include their nested skills/servers with full details. Items include installed, installed_bundle, and installed_transitive flags where applicable.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/catalog' },
  },
];
