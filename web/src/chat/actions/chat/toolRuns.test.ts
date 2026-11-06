import { describe, expect, it } from 'vitest';
import { locales } from '../../content';
import { checkBadge, pageOf, pendingApprovalOf, safetyCheckOf, toolRunOf } from './toolRuns';

const en = locales.en;
const de = locales.de;

describe('tool runs', () => {
  it('map a tool_end with reason and check', () => {
    expect(toolRunOf('run_command', { call_id: 'c1', is_error: null, reason: ' Why not ', check: { decision: 'allowed', verdict: 'approved', reasoning: 'ok' } })).toEqual({
      callId: 'c1',
      name: 'run_command',
      isError: false,
      reason: 'Why not',
      target: null,
      check: { agent_reason: null, decision: 'allowed', verdict: 'approved', reasoning: 'ok' },
      page: null,
    });
  });

  it('ignore malformed checks and empty reasons', () => {
    expect(safetyCheckOf({ verdict: 'approved' })).toBeNull();
    expect(safetyCheckOf('nope')).toBeNull();
    expect(safetyCheckOf({ decision: 'asked', verdict: 'maybe' })).toMatchObject({ verdict: null });
    expect(toolRunOf('x', { reason: '  ' }).reason).toBeNull();
  });

  it('map an approval with the assistant\'s reason and the check', () => {
    expect(pendingApprovalOf({ call_id: 'a', name: 'n', input: 1, reason: null, agent_reason: 'because', check: null })).toEqual({
      callId: 'a',
      name: 'n',
      input: 1,
      reason: null,
      agentReason: 'because',
      check: null,
      purchase: null,
    });
  });
});

describe('a run allowed without a verdict', () => {
  it('shows no safety check (none ran), but keeps the reason it carried', () => {
    const run = toolRunOf('x', { check: { decision: 'allowed', verdict: null, agent_reason: 'read it' } });
    expect(run.check).toBeNull();
    expect(run.reason).toBe('read it');
    expect(toolRunOf('x', { check: { decision: 'asked', verdict: null } }).check).not.toBeNull();
  });
});

describe('checkBadge', () => {
  const check = (decision: 'allowed' | 'denied' | 'asked', verdict: 'approved' | 'rejected' | 'failed' | null) => ({ decision, verdict });

  it('says the verdict, and what was done when stopped or asked', () => {
    expect(checkBadge(check('allowed', 'approved'), en)).toEqual({ label: 'Safety check: approved', tone: 'ok' });
    expect(checkBadge(check('denied', 'rejected'), en)).toEqual({ label: 'Safety check: rejected · denied', tone: 'bad' });
    expect(checkBadge(check('asked', 'failed'), en)).toEqual({ label: 'Safety check: couldn’t run · asked you', tone: 'warn' });
    expect(checkBadge(check('asked', null), en).label).toBe('Safety check: couldn’t run · asked you');
    expect(checkBadge(check('asked', 'rejected'), de).label).toBe('Sicherheitsprüfung: abgelehnt · bei dir nachgefragt');
  });
});

describe('pages of tool runs', () => {
  it('a run that made a page carries it; malformed ones are dropped', () => {
    const page = { id: 'p1', kind: 'artifact', title: ' Load ', version: 2 };
    expect(toolRunOf('chat.artifact_publish', { artifact: page as never }).page).toEqual({ id: 'p1', kind: 'artifact', title: 'Load', version: 2 });
    expect(pageOf({ id: 'v', kind: 'mcp_app', title: '', version: null })).toEqual({ id: 'v', kind: 'mcp_app', title: 'mcp_app', version: null });
    expect(pageOf({ id: 'x', kind: 'other' })).toBeNull();
    expect(pageOf([])).toBeNull();
    expect(pageOf(null)).toBeNull();
  });
});
