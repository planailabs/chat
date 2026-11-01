import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { Plan } from '../chat/api';
import { formatNumber, limitText, parseTokens, planToForm, validatePlanForm } from './plans';
import PlanForm from './components/PlanForm.vue';

const standard: Plan = {
  id: 'standard',
  name: 'Standard',
  price_cents: 0,
  currency: 'EUR',
  window_days: 30,
  limits: { hourly_input_tokens: 2_000_000, hourly_output_tokens: 0 },
  users: 3,
};

describe('numbers', () => {
  it('are readable, 0 is unlimited', () => {
    expect(formatNumber(1_000_000)).toBe('1,000,000');
    expect(limitText(2_000_000)).toBe('2,000,000');
    expect(limitText(0)).toBe('unlimited');
    expect(limitText(undefined)).toBe('unlimited');
  });

  it('parse with separators, not otherwise', () => {
    expect(parseTokens('1,000,000')).toBe(1_000_000);
    expect(parseTokens(' 1 000 000 ')).toBe(1_000_000);
    expect(parseTokens('1.000.000')).toBe(1_000_000);
    expect(parseTokens('0')).toBe(0);
    expect(parseTokens('')).toBeNull();
    expect(parseTokens('-5')).toBeNull();
    expect(parseTokens('1e6')).toBeNull();
    expect(parseTokens('2.5k')).toBeNull();
  });
});

describe('validatePlanForm', () => {
  it('turns an edited plan back into its input (id fixed)', () => {
    const form = { ...planToForm(standard), name: ' Standard+ ', input: '3,000,000' };
    expect(form.output).toBe('0');
    expect(validatePlanForm(form, { editing: true, existingIds: ['standard'] })).toEqual({
      input: { id: 'standard', name: 'Standard+', hourly_input_tokens: 3_000_000, hourly_output_tokens: 0 },
      errors: null,
    });
  });

  it('needs a new, well-formed id, a name and whole numbers', () => {
    const result = validatePlanForm({ id: 'Pro Plan', name: ' ', input: 'lots', output: '1,0' }, { editing: false, existingIds: [] });
    expect(result.input).toBeNull();
    expect(Object.keys(result.errors ?? {}).sort()).toEqual(['id', 'input', 'name']);
    expect(validatePlanForm({ id: 'standard', name: 'X', input: '0', output: '0' }, { editing: false, existingIds: ['standard'] }).errors?.id).toMatch(/exists/);
  });
});

describe('PlanForm', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves an edited plan with readable numbers parsed', async () => {
    const w = mount(PlanForm, { props: { plan: standard, existingIds: ['standard'] } });
    expect(w.find<HTMLInputElement>('input[name="id"]').element.readOnly).toBe(true);
    expect(w.find<HTMLInputElement>('input[name="input"]').element.value).toBe('2,000,000');
    await w.find('input[name="output"]').setValue('500,000');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/plan/put');
    expect(JSON.parse(init.body)).toEqual({ id: 'standard', name: 'Standard', hourly_input_tokens: 2_000_000, hourly_output_tokens: 500_000 });
    expect(w.emitted('saved')).toHaveLength(1);
  });

  it('shows what is wrong and sends nothing', async () => {
    const w = mount(PlanForm, { props: { plan: null, existingIds: ['standard'] } });
    await w.find('input[name="id"]').setValue('standard');
    await w.find('input[name="input"]').setValue('many');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(w.text()).toContain('A plan with this id exists');
    expect(w.text()).toContain('Required');
    expect(w.text()).toContain('A whole number');
  });
});
