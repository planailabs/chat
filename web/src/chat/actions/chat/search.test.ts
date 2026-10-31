import { describe, expect, it } from 'vitest';
import type { SearchHit } from '../../api';
import { groupHits, isSearchable, snippetHtml, snippetText, titleHtml } from './search';

const O = '';
const C = '';

const hit = (conversation: string, message_id: number | null, snippet = 'x'): SearchHit => ({
  conversation,
  title: `Title ${conversation}`,
  message_id,
  role: message_id === null ? null : 'user',
  snippet,
  at: '2026-10-31T10:00:00Z',
});

describe('snippetHtml', () => {
  it('marks only the matches', () => {
    expect(snippetHtml(`a small ${O}law${C} ${O}firm${C}.`)).toBe('a small <mark>law</mark> <mark>firm</mark>.');
  });

  it('keeps markup in the snippet as text', () => {
    const html = snippetHtml(`<script>alert(1)</script> ${O}<b>x</b>${C} <img src=x onerror=alert(2)>`);
    expect(html).toBe('&lt;script&gt;alert(1)&lt;/script&gt; <mark>&lt;b&gt;x&lt;/b&gt;</mark> &lt;img src=x onerror=alert(2)&gt;');
    const el = document.createElement('div');
    el.innerHTML = html;
    expect(el.querySelector('script, img, b')).toBeNull();
    expect(el.querySelectorAll('mark')).toHaveLength(1);
  });

  it('closes an unclosed match and ignores stray closers', () => {
    expect(snippetHtml(`${C}a ${O}b`)).toBe('a <mark>b</mark>');
  });

  it('marks a cropped title snippet in the whole title (escaped)', () => {
    expect(titleHtml('In <b> an earlier law firm.', `an earlier ${O}law${C} firm`)).toBe('In &lt;b&gt; an earlier <mark>law</mark> firm.');
    expect(titleHtml('Other', `${O}x${C}`)).toBe('<mark>x</mark>');
  });

  it('gives the plain text', () => {
    expect(snippetText(`a ${O}b${C}`)).toBe('a b');
  });
});

describe('groupHits', () => {
  it('groups by conversation in order of the best hit, title separate, at most 3 messages each', () => {
    const groups = groupHits([hit('b', 1), hit('a', null), hit('b', 2), hit('a', 3), hit('b', null), hit('b', 4), hit('b', 5)]);
    expect(groups.map((g) => g.conversation)).toEqual(['b', 'a']);
    expect(groups[0].hits.map((h) => h.message_id)).toEqual([1, 2, 4]);
    expect(groups[0].titleHit?.message_id).toBeNull();
    expect(groups[1]).toMatchObject({ title: 'Title a', hits: [{ message_id: 3 }] });
  });
});

describe('isSearchable', () => {
  it('needs a letter or digit', () => {
    expect(isSearchable('  ')).toBe(false);
    expect(isSearchable('?!…')).toBe(false);
    expect(isSearchable('konf')).toBe(true);
    expect(isSearchable('Ärger')).toBe(true);
  });
});
