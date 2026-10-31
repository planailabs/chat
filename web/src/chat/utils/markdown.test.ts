// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders markdown', () => {
    const html = renderMarkdown('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips script, event handlers and javascript: links', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src="x" onerror="alert(2)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');

    const link = renderMarkdown('[click](javascript:alert(3)) <a href="javascript:alert(4)">raw</a>');
    expect(link).not.toContain('javascript:');
  });

  it('opens links in a new tab without opener access', () => {
    const html = renderMarkdown('[plan.ai](https://plan.ai)');
    expect(html).toContain('href="https://plan.ai"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
