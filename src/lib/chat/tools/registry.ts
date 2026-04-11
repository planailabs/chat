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
  /** Send input as JSON body (POST / PUT / PATCH) */
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
        'Get the identity of the current cluster associated with this token. Returns cluster_id, cluster_name, organization_id, token_kind, and cluster_ids (all cluster IDs this token can access).',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/self' },
  },

  // ── Config ───────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'get_config_schema',
      description:
        'Get the JSON Schema describing all valid configuration fields and their types. Use this to understand what config keys exist and their constraints before reading or updating the config.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/config/schema' },
  },
  {
    tool: {
      name: 'get_config',
      description:
        'Get the current JSON configuration for this cluster. Returns the full config object.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/config' },
  },
  {
    tool: {
      name: 'set_config',
      description:
        'Replace the entire JSON configuration for this cluster. Pass the full config as a JSON object.',
      input_schema: {
        type: 'object' as const,
        description: 'The full configuration object. Its top-level keys are section names (e.g. "global", "daemon").',
        additionalProperties: true,
      },
    },
    endpoint: { method: 'PUT', path: '/api/setting/config', jsonBody: true },
  },
  {
    tool: {
      name: 'update_config',
      description:
        'Update a single field in the JSON configuration. Atomically reads the current config, sets the field under the given section, and saves it back. Use this instead of get_config + set_config when you need to change individual fields.',
      input_schema: {
        type: 'object' as const,
        properties: {
          section: { type: 'string', description: 'The config section name (e.g. "global").' },
          key: { type: 'string', description: 'The key to set within the section.' },
          value: { description: 'The value to set (any JSON value: string, number, boolean, array, or object).' },
        },
        required: ['section', 'key', 'value'],
      },
    },
    endpoint: { method: 'PATCH', path: '/api/setting/config', jsonBody: true },
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_skills',
      description:
        'List all skills currently assigned to this cluster. Returns id, skill_slug, skill_name, skill_description, channel, installed, installed_bundle, and cluster_skill_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/skills' },
  },
  {
    tool: {
      name: 'add_skill',
      description:
        'Add a single skill to this cluster by skill channel ID (UUID). Use available_skill_channels to find the ID first. Prefer batch_skills when adding multiple skills.',
      input_schema: obj(
        { skill_channel_id: { type: 'string', description: 'The UUID of the skill channel to add.' } },
        ['skill_channel_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/skills', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_skills',
      description:
        'Batch add and/or remove skill assignments in a single call. `add` contains skill_channel_ids to assign (duplicates skipped). `remove` contains cluster_skill_ids to delete. Both fields are optional and default to empty.',
      input_schema: {
        type: 'object' as const,
        properties: {
          add: {
            type: 'array',
            items: { type: 'string' },
            description: 'Skill channel UUIDs to add.',
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cluster skill assignment UUIDs to remove.',
          },
        },
      },
    },
    endpoint: { method: 'PATCH', path: '/api/setting/skills/batch', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_skill',
      description:
        'Remove a skill assignment from this cluster by its cluster_skill_id (UUID). Use list_skills to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The cluster_skill_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/skills', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_skill_channels',
      description:
        'List all available skill channels that can be added. Returns id, skill_slug, skill_name, skill_description, channel, installed, installed_bundle, and cluster_skill_id for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/skill-channels' },
  },

  // ── Bundles ──────────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_bundles',
      description:
        'List all application bundles currently assigned to this cluster. Returns cluster_bundle_id, bundle_slug, bundle_name, and bundle_description.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/bundles' },
  },
  {
    tool: {
      name: 'add_bundle',
      description:
        'Add a single application bundle to this cluster by bundle ID (UUID). Use available_bundles to find the ID first. Prefer batch_bundles when adding multiple bundles.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_bundles',
      description:
        'Batch add and/or remove bundle assignments in a single call. `add` contains bundle_ids to assign (duplicates skipped). `remove` contains cluster_bundle_ids to delete. Both fields are optional and default to empty.',
      input_schema: {
        type: 'object' as const,
        properties: {
          add: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bundle UUIDs to add.',
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cluster bundle assignment UUIDs to remove.',
          },
        },
      },
    },
    endpoint: { method: 'PATCH', path: '/api/setting/bundles/batch', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_bundle',
      description:
        'Remove a bundle assignment from this cluster by its cluster_bundle_id (UUID). Use list_bundles to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The cluster_bundle_id (UUID) of the assignment to remove.' } },
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
        'List all MCP servers currently assigned to this cluster. Returns id, slug, name, description, installed, installed_bundle, installed_transitive, and cluster_mcp_server_id (only present for direct assignments) for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-servers' },
  },
  {
    tool: {
      name: 'add_mcp_server',
      description:
        'Add a single MCP server to this cluster by server ID (UUID). Use available_mcp_servers to find the ID first. Prefer batch_mcp_servers when adding multiple servers.',
      input_schema: obj(
        { mcp_server_id: { type: 'string', description: 'The UUID of the MCP server to add.' } },
        ['mcp_server_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-servers', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_mcp_servers',
      description:
        'Batch add and/or remove MCP server assignments in a single call. `add` contains mcp_server_ids to assign (duplicates skipped). `remove` contains cluster_mcp_server_ids to delete. Both fields are optional and default to empty.',
      input_schema: {
        type: 'object' as const,
        properties: {
          add: {
            type: 'array',
            items: { type: 'string' },
            description: 'MCP server UUIDs to add.',
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cluster MCP server assignment UUIDs to remove.',
          },
        },
      },
    },
    endpoint: { method: 'PATCH', path: '/api/setting/mcp-servers/batch', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_mcp_server',
      description:
        'Remove an MCP server assignment from this cluster by its cluster_mcp_server_id (UUID). Use list_mcp_servers to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The cluster_mcp_server_id (UUID) of the assignment to remove.' } },
        ['id'],
      ),
    },
    endpoint: { method: 'DELETE', path: '/api/setting/mcp-servers', pathParam: 'id' },
  },
  {
    tool: {
      name: 'available_mcp_servers',
      description:
        'List all available MCP servers that can be added. Returns id, slug, name, description, installed, installed_bundle, installed_transitive, and cluster_mcp_server_id for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/available/mcp-servers' },
  },

  // ── MCP Bundles ──────────────────────────────────────────────────────────
  {
    tool: {
      name: 'list_mcp_bundles',
      description:
        'List all MCP bundles currently assigned to this cluster. Returns cluster_mcp_bundle_id, bundle_slug, bundle_name, and bundle_description.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/mcp-bundles' },
  },
  {
    tool: {
      name: 'add_mcp_bundle',
      description:
        'Add a single MCP bundle to this cluster by bundle ID (UUID). Use available_mcp_bundles to find the ID first. Prefer batch_mcp_bundles when adding multiple bundles.',
      input_schema: obj(
        { bundle_id: { type: 'string', description: 'The UUID of the MCP bundle to add.' } },
        ['bundle_id'],
      ),
    },
    endpoint: { method: 'POST', path: '/api/setting/mcp-bundles', jsonBody: true },
  },
  {
    tool: {
      name: 'batch_mcp_bundles',
      description:
        'Batch add and/or remove MCP bundle assignments in a single call. `add` contains bundle_ids to assign (duplicates skipped). `remove` contains cluster_mcp_bundle_ids to delete. Both fields are optional and default to empty.',
      input_schema: {
        type: 'object' as const,
        properties: {
          add: {
            type: 'array',
            items: { type: 'string' },
            description: 'MCP bundle UUIDs to add.',
          },
          remove: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cluster MCP bundle assignment UUIDs to remove.',
          },
        },
      },
    },
    endpoint: { method: 'PATCH', path: '/api/setting/mcp-bundles/batch', jsonBody: true },
  },
  {
    tool: {
      name: 'remove_mcp_bundle',
      description:
        'Remove an MCP bundle assignment from this cluster by its cluster_mcp_bundle_id (UUID). Use list_mcp_bundles to find the ID.',
      input_schema: obj(
        { id: { type: 'string', description: 'The cluster_mcp_bundle_id (UUID) of the assignment to remove.' } },
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
        'List all SSH keys for this cluster. Returns id, fingerprint (SHA256), comment, and created_at for each.',
      input_schema: obj(),
    },
    endpoint: { method: 'GET', path: '/api/setting/ssh-keys' },
  },
  {
    tool: {
      name: 'add_ssh_key',
      description:
        'Add an SSH public key for this cluster. The API parses the key to extract the fingerprint and comment.',
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
