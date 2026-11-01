import { describe, expect, it } from 'vitest';
import { locales } from '../../content';
import { checkBadge, pendingApprovalOf, safetyCheckOf, toolRunOf } from './toolRuns';

const en = locales.en;
const de = locales.de;

describe('tool runs', () => {
  it('map a tool_end with reason and check', () => {
    expect(toolRunOf('run_command', { call_id: 'c1', is_error: null, reason: ' Why not ', check: { decision: 'allowed', verdict: 'approved', reasoning: 'ok' } })).toEqual({
      callId: 'c1',
      name: 'run_command',
      isError: false,
      reason: 'Why not',
      check: { agent_reason: null, decision: 'allowed', verdict: 'approved', reasoning: 'ok' },
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
