<script setup lang="ts">
/** A tool call waiting for the user: Approve / Deny / Approve all. */
import { computed, type PropType } from 'vue';
import type { PendingApproval } from '../../app/state';
import { locale } from '../../app/locale';
import { formatToolArgs } from '../../utils/format';
import { decideApproval, type ApprovalAction } from '../../actions/chat';
import SafetyBadge from './SafetyBadge.vue';
import LongText from './LongText.vue';

const props = defineProps({ approval: { type: Object as PropType<PendingApproval>, required: true } });

const labels = computed(() => locale.value.chat.approval);
const toolLabels = computed(() => locale.value.chat.tool);
const args = computed(() => formatToolArgs(props.approval.input, 1200, true));

const decide = (action: ApprovalAction) => void decideApproval(props.approval.callId, action);
</script>

<template>
  <div class="flex justify-start">
    <div class="flex w-full min-w-0 max-w-[min(100%,640px)] flex-col gap-3 rounded-3xl bg-(--surface-elevated) px-5 py-4 text-(--text-primary)">
      <p class="text-[0.65rem] tracking-[0.25em] text-(--text-muted) uppercase">{{ labels.title }}</p>
      <p class="font-mono text-sm font-semibold">{{ approval.name }}</p>
      <div v-if="approval.agentReason" class="approval-field">
        <p class="approval-field__label">{{ labels.agentReason }}</p>
        <p class="text-sm leading-relaxed"><LongText :text="approval.agentReason" /></p>
      </div>
      <div v-if="approval.check" class="approval-field">
        <p class="approval-field__label">{{ toolLabels.safetyCheck }}</p>
        <p><SafetyBadge :check="approval.check" /></p>
        <p class="text-sm leading-relaxed text-(--text-muted)"><LongText :text="approval.check.reasoning || toolLabels.noReasoning" /></p>
      </div>
      <div v-if="approval.reason" class="approval-field">
        <p class="approval-field__label">{{ labels.hookMessage }}</p>
        <p class="text-sm leading-relaxed"><LongText :text="approval.reason" /></p>
      </div>
      <div v-if="args" class="approval-field">
        <p class="approval-field__label">{{ labels.arguments }}</p>
        <pre class="max-h-60 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-(--text-muted)">{{ args }}</pre>
      </div>
      <div class="flex flex-wrap gap-3 text-sm">
        <button type="button" class="chat-cta-button" @click.stop="decide('approve')">{{ labels.approve }}</button>
        <button type="button" class="chat-cta-button chat-cta-button--cancel" @click.stop="decide('deny')">{{ labels.deny }}</button>
        <button type="button" class="chat-cta-button" @click.stop="decide('approve_all')">{{ labels.approveAll }}</button>
      </div>
    </div>
  </div>
</template>
