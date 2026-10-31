<script setup lang="ts">
/** A tool call waiting for the user: Approve / Deny / Approve all. */
import { computed, type PropType } from 'vue';
import type { PendingApproval } from '../../app/state';
import { locale } from '../../app/locale';
import { formatToolArgs } from '../../utils/format';
import { decideApproval, type ApprovalAction } from '../../actions/chat';

const props = defineProps({ approval: { type: Object as PropType<PendingApproval>, required: true } });

const labels = computed(() => locale.value.chat.approval);
const args = computed(() => formatToolArgs(props.approval.input, 1200, true));

const decide = (action: ApprovalAction) => void decideApproval(props.approval.callId, action);
</script>

<template>
  <div class="flex justify-start">
    <div class="flex w-full max-w-[min(100%,640px)] flex-col gap-3 rounded-3xl bg-(--surface-elevated) px-5 py-4 text-(--text-primary)">
      <p class="text-[0.65rem] tracking-[0.25em] text-(--text-muted) uppercase">{{ labels.title }}</p>
      <p class="font-mono text-sm font-semibold">{{ approval.name }}</p>
      <pre v-if="args" class="max-h-60 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-(--text-muted)">{{ args }}</pre>
      <p v-if="approval.reason" class="text-sm leading-relaxed">{{ approval.reason }}</p>
      <div class="flex flex-wrap gap-3 text-sm">
        <button type="button" class="chat-cta-button" @click.stop="decide('approve')">{{ labels.approve }}</button>
        <button type="button" class="chat-cta-button chat-cta-button--cancel" @click.stop="decide('deny')">{{ labels.deny }}</button>
        <button type="button" class="chat-cta-button" @click.stop="decide('approve_all')">{{ labels.approveAll }}</button>
      </div>
    </div>
  </div>
</template>
