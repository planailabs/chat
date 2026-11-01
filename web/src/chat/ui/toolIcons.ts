/**
 * The icon of a tool call, from its name (a connector call: its target,
 * `service.tool`). The name's words decide: a destructive verb first (it
 * matters most), then what the call is about, then any other verb.
 */
import type { IconName } from './icons';

// ponytail: word lists, first match wins; a tool that lands wrong gets its word added here.
const RULES: [IconName, string[]][] = [
  ['delete', ['delete', 'remove', 'destroy', 'purge', 'reset', 'revoke']],
  ['ask', ['ask', 'question', 'prompt', 'preference']],
  ['money', ['purchase', 'quote', 'subscription', 'subscriptions', 'billing', 'invoice', 'invoices', 'price', 'pricing', 'catalog', 'budget', 'payment', 'checkout']],
  ['web', ['firecrawl', 'scrape', 'crawl', 'browse', 'fetch', 'web', 'url', 'map', 'extract', 'interact']],
  ['docs', ['context7', 'docs', 'doc', 'skill', 'skills', 'guide', 'library', 'papers', 'paper']],
  ['search', ['search', 'find', 'query', 'research', 'lookup']],
  ['user', ['identity', 'account', 'accounts', 'user', 'users', 'member', 'members', 'idp', 'idps', 'login', 'profile', 'zitadel']],
  ['repo', ['repo', 'git', 'branch', 'commit', 'publish', 'deploy', 'clone', 'remote']],
  ['link', ['connection', 'connections', 'connect', 'ingress', 'hosts', 'host', 'domain', 'domains', 'dns']],
  ['server', ['instance', 'instances', 'machine', 'machines', 'region', 'regions', 'cluster', 'clusters', 'fleet', 'metrics', 'logs', 'mac']],
  ['plan', ['plan', 'plans', 'todo', 'task', 'tasks', 'step', 'steps']],
  ['rename', ['create', 'add', 'set', 'update', 'put', 'edit', 'rename', 'init', 'claim', 'upgrade', 'retry', 'write']],
  ['list', ['list', 'get', 'read', 'view', 'show', 'history', 'services', 'tools', 'status']],
];

export const toolIcon = (name: string): IconName => {
  const words = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return RULES.find(([, keys]) => keys.some((k) => words.has(k)))?.[0] ?? 'tool';
};
