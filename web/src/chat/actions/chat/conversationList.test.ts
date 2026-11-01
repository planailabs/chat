import { describe, expect, it } from 'vitest';
import {
  backgroundActivity,
  eventDestination,
  groupConversations,
  mergeConversations,
  titleFrom,
  updateConversation,
  type ConversationItem,
} from './conversationList';

// Local time: grouping is by the user's calendar days.
const now = new Date(2026, 10, 1, 15, 0);
const at = (daysAgo: number, hour = 12) => new Date(2026, 10, 1 - daysAgo, hour).toISOString();
const conv = (id: string, updated: string): ConversationItem => ({ id, title: id, created_at: updated, updated_at: updated });

describe('groupConversations', () => {
  it('groups by calendar: today, yesterday, this week, last week, this month, older', () => {
    // Thursday 19 November 2026: the week began Monday the 16th.
    const thu = new Date(2026, 10, 19, 15, 0);
    const on = (date: number, month = 10) => new Date(2026, month, date, 12).toISOString();
    const groups = groupConversations(
      [
        conv('october', on(31, 9)),
        conv('today', on(19)),
        conv('monday', on(16)),
        conv('yesterday', on(18)),
        conv('lastMonday', on(9)),
        conv('lastSunday', on(15)),
        conv('month', on(2)),
      ],
      thu,
    );
    expect(groups.map((g) => [g.key, g.items.map((c) => c.id)])).toEqual([
      ['today', ['today']],
      ['yesterday', ['yesterday']],
      ['thisWeek', ['monday']],
      ['lastWeek', ['lastSunday', 'lastMonday']],
      ['thisMonth', ['month']],
      ['older', ['october']],
    ]);
  });

  it('on a Monday, yesterday is yesterday and last week starts a week ago', () => {
    const mon = new Date(2026, 10, 16, 9, 0);
    const on = (date: number) => new Date(2026, 10, date, 12).toISOString();
    const groups = groupConversations([conv('sun', on(15)), conv('sat', on(14)), conv('prevMon', on(9)), conv('sun8', on(8))], mon);
    expect(groups.map((g) => [g.key, g.items.map((c) => c.id)])).toEqual([
      ['yesterday', ['sun']],
      ['lastWeek', ['sat', 'prevMon']],
      ['thisMonth', ['sun8']],
    ]);
  });

  it('puts midnight into the new day and sorts each group newest first', () => {
    const groups = groupConversations([conv('a', at(0, 0)), conv('b', at(0, 14)), conv('c', at(1, 0))], now);
    expect(groups.map((g) => [g.key, g.items.map((c) => c.id)])).toEqual([
      ['today', ['b', 'a']],
      ['yesterday', ['c']],
    ]);
  });

  it('leaves out empty groups', () => {
    expect(groupConversations([], now)).toEqual([]);
    expect(groupConversations([conv('x', at(100))], now).map((g) => g.key)).toEqual(['older']);
  });
});

describe('updateConversation', () => {
  const list = [conv('a', at(0)), conv('b', at(1)), conv('c', at(2))];

  it('moves a conversation with activity to the top', () => {
    const moved = updateConversation(list, 'c', { busy: true }, now);
    expect(moved.map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(moved[0]).toMatchObject({ busy: true, updated_at: now.toISOString() });
  });

  it('changes a conversation in place without activity', () => {
    const renamed = updateConversation(list, 'b', { title: 'Fleet' });
    expect(renamed.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(renamed[1].title).toBe('Fleet');
    expect(renamed[1].updated_at).toBe(list[1].updated_at);
  });

  it('ignores unknown conversations', () => {
    expect(updateConversation(list, 'zzz', { unread: true }, now)).toBe(list);
  });
});

describe('mergeConversations', () => {
  it('takes the server list and keeps what this tab knows', () => {
    const known: ConversationItem[] = [{ ...conv('a', at(1)), busy: true, unread: true }, conv('gone', at(0))];
    const merged = mergeConversations([{ ...conv('a', at(0)), title: 'Server title' }, conv('new', at(2))], known);
    expect(merged).toEqual([
      { ...conv('a', at(0)), title: 'Server title', busy: true, unread: true },
      conv('new', at(2)),
    ]);
  });
});

describe('event routing', () => {
  const known = [conv('a', at(0)), conv('b', at(0))];

  it('sends the open conversation\'s events to the chat', () => {
    expect(eventDestination('text_delta', 'a', 'a', known)).toBe('open');
  });

  it('marks other known conversations in the sidebar', () => {
    expect(eventDestination('done', 'b', 'a', known)).toBe('background');
    expect(eventDestination('thinking', 'b', null, known)).toBe('background');
  });

  it('refetches for conversations it does not know', () => {
    expect(eventDestination('thinking', 'elsewhere', 'a', known)).toBe('unknown');
    expect(eventDestination('thinking', 'elsewhere', null, [])).toBe('unknown');
  });

  it('resyncs on resync and on events without a conversation', () => {
    expect(eventDestination('resync', undefined, 'a', known)).toBe('resync');
    expect(eventDestination('done', undefined, 'a', known)).toBe('resync');
  });

  it('shows working while the assistant works and news once it needs or has something', () => {
    expect(backgroundActivity('thinking')).toEqual({ busy: true });
    expect(backgroundActivity('text_delta')).toEqual({ busy: true });
    expect(backgroundActivity('text_done')).toEqual({ busy: true, unread: true });
    expect(backgroundActivity('question')).toEqual({ busy: false, unread: true });
    expect(backgroundActivity('approval')).toEqual({ busy: false, unread: true });
    expect(backgroundActivity('done')).toEqual({ busy: false, unread: true });
    expect(backgroundActivity('error')).toEqual({ busy: false, unread: true });
    expect(backgroundActivity('resync')).toBeNull();
  });
});

describe('titleFrom', () => {
  it('derives a title like the server: first line, at most 60 characters, cut at a word', () => {
    expect(titleFrom('\n  Hello there  \nsecond line')).toBe('Hello there');
    const t = titleFrom('Please help me configure the skills on my plan.ai machine for a law firm');
    expect(t.endsWith('…')).toBe(true);
    expect(Array.from(t).length).toBeLessThanOrEqual(61);
    expect(t).not.toContain('law');
  });
});
