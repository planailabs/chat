<script setup lang="ts">
/**
 * An approval that buys something: product, organization, price and trial,
 * the summary; Buy only after the explicit "I understand this costs …"
 * checkbox. No "approve all": every purchase is confirmed on its own.
 */
import { computed, ref, useId, type PropType } from 'vue';
import type { PendingApproval } from '../../app/state';
import type { Purchase } from '../../api';
import { store } from '../../app/store';
import { locale } from '../../app/locale';
import { priceLabel } from '../../utils/price';
import { decideApproval } from '../../actions/chat';
import LongText from './LongText.vue';

const props = defineProps({ approval: { type: Object as PropType<PendingApproval>, required: true } });

const t = computed(() => locale.value.chat.purchase);
/** Only rendered for approvals with a purchase. */
const p = computed(() => props.approval.purchase as Purchase);
const price = computed(() => priceLabel(p.value, t.value.prices, store.state.localeKey));
const trialText = computed(() => (p.value.trial_days ? t.value.trial.replace('{{days}}', String(p.value.trial_days)) : ''));
const confirmText = computed(() => t.value.understand.replace('{{price}}', price.value));
const understood = ref(false);
const sending = ref(false);
const checkboxId = `purchase-${useId()}`;

const decide = (buy: boolean) => {
  if (sending.value || (buy && !understood.value)) return;
  sending.value = true;
  void decideApproval(props.approval.callId, buy ? 'approve' : 'deny');
};
</script>

<template>
  <div class="flex justify-start">
    <section class="purchase-card" :aria-label="t.title">
      <p class="text-[0.65rem] tracking-[0.25em] text-(--text-muted) uppercase">{{ t.title }}</p>
      <dl class="purchase-card__facts">
        <div>
          <dt>{{ t.product }}</dt>
          <dd class="font-semibold">{{ p.product_name || p.product || '—' }}</dd>
        </div>
        <div v-if="p.organization_name">
          <dt>{{ t.organization }}</dt>
          <dd>{{ p.organization_name }}</dd>
        </div>
        <div>
          <dt>{{ t.price }}</dt>
          <dd class="purchase-card__price">{{ price }}</dd>
        </div>
      </dl>
      <p v-if="trialText" class="purchase-card__trial">{{ trialText }}</p>
      <p v-if="p.summary" class="text-sm leading-relaxed"><LongText :text="p.summary" /></p>
      <label class="purchase-card__confirm" :for="checkboxId">
        <input :id="checkboxId" v-model="understood" type="checkbox" :disabled="sending" />
        <span>{{ confirmText }}</span>
      </label>
      <div class="flex flex-wrap gap-3 text-sm">
        <button type="button" class="chat-cta-button purchase-card__buy" :disabled="!understood || sending" :aria-disabled="!understood || sending" @click.stop="decide(true)">
          {{ t.buy }}
        </button>
        <button type="button" class="chat-cta-button chat-cta-button--cancel" :disabled="sending" @click.stop="decide(false)">{{ t.deny }}</button>
      </div>
    </section>
  </div>
</template>
