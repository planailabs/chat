import { describe, expect, it } from 'vitest';
import { toolIcon } from './toolIcons';

describe('toolIcon', () => {
  it('picks by the words of the name', () => {
    expect(toolIcon('plan-ai-cloud.instances_delete')).toBe('delete');
    expect(toolIcon('plan-ai-cloud.instances_create')).toBe('server');
    expect(toolIcon('plan-ai-cloud.repo_deploy')).toBe('repo');
    expect(toolIcon('plan-ai-cloud.connections_connect')).toBe('link');
    expect(toolIcon('plan-ai-cloud.subscriptions_catalog')).toBe('money');
    expect(toolIcon('plan-ai-cloud.organizations_identity_account')).toBe('user');
    expect(toolIcon('firecrawl.firecrawl_search')).toBe('web');
    expect(toolIcon('context7.query-docs')).toBe('docs');
    expect(toolIcon('chat.skill_get')).toBe('docs');
    expect(toolIcon('chat.conversations_search')).toBe('search');
    expect(toolIcon('ask_question')).toBe('ask');
    expect(toolIcon('connector.list_services')).toBe('list');
    expect(toolIcon('chat.product_get')).toBe('list');
    expect(toolIcon('something.frobnicate')).toBe('tool');
  });
});
