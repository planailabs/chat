<script setup lang="ts">
/** The conversation: user, assistant (sanitized markdown), dismissed questions and approval records. */
import type { PropType } from 'vue';
import type { ChatMessage } from '../../app/state';
import { locale } from '../../app/locale';
import { renderMarkdown } from '../../utils/markdown';
import { formatToolArgs } from '../../utils/format';
import { store } from '../../app/store';
import type { Purchase } from '../../api';
import { priceLabel } from '../../utils/price';
import ToolRun from './ToolRun.vue';
import PageCard from './PageCard.vue';

defineProps({ messages: { type: Array as PropType<ChatMessage[]>, required: true } });

const approvalStatus = (decision: 'approved' | 'denied' | null, purchase: boolean) => {
  const labels = locale.value.chat.approval;
  const bought = locale.value.chat.purchase;
  if (decision === 'approved') return purchase ? bought.confirmed : labels.approved;
  if (decision === 'denied') return purchase ? bought.declined : labels.denied;
  return labels.requested;
};

/** A purchase's record: product and price instead of the raw arguments. */
const purchaseText = (purchase: Purchase) =>
  `${purchase.product_name || purchase.product} · ${priceLabel(purchase, locale.value.chat.purchase.prices, store.state.localeKey)}`;
</script>

<template>
  <template v-for="(msg, i) in messages" :key="i">
    <div v-if="msg.role === 'approval'" class="flex justify-start">
      <p class="max-w-[min(100%,640px)] text-xs text-(--text-muted)">
        <span class="font-mono font-semibold">{{ msg.name }}</span>
        {{ ' ' }}
        <span v-if="msg.purchase">{{ purchaseText(msg.purchase) }}</span>
        <span v-else-if="formatToolArgs(msg.input, 120, false)" class="font-mono break-all opacity-80">{{ formatToolArgs(msg.input, 120, false) }}</span>
        {{ ' ' }}
        <span class="whitespace-nowrap">· {{ approvalStatus(msg.decision, Boolean(msg.purchase)) }}</span>
      </p>
    </div>
    <template v-else-if="msg.role === 'tool'">
      <ToolRun :run="msg" />
      <PageCard v-if="msg.page" :page="msg.page" />
    </template>
    <div v-else-if="msg.role === 'qa'" class="flex justify-start">
      <p class="chat-qa max-w-[min(100%,640px)] text-sm leading-relaxed text-(--text-muted)">
        <span>{{ msg.question }}</span>
        <span class="mx-1.5" aria-hidden="true">→</span>
        <span v-if="msg.answer !== null" class="font-medium text-(--text-primary)">{{ msg.answer }}</span>
        <span v-else class="italic">{{ locale.chat.skipLabel }}</span>
      </p>
    </div>
    <div v-else-if="msg.role === 'cancel'" class="flex justify-end">
      <p class="max-w-[min(100%,640px)] rounded-3xl px-5 py-3 text-sm text-(--text-muted) italic">{{ msg.content }}</p>
    </div>
    <div v-else-if="msg.role === 'user'" class="flex justify-end">
      <p
        :class="['chat-message', { 'is-highlighted': msg.id !== undefined && msg.id === store.state.highlightMessageId }]"
        :data-message-id="msg.id"
        class="max-w-[min(100%,640px)] rounded-3xl bg-(--surface-elevated) px-5 py-3 text-base text-(--text-primary)">{{ msg.content }}</p>
    </div>
    <div v-else class="flex justify-start">
      <div
        :class="['chat-message', { 'is-highlighted': msg.id !== undefined && msg.id === store.state.highlightMessageId }]"
        :data-message-id="msg.id"
        class="chat-markdown max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)"
        v-html="renderMarkdown(msg.content)"
      />
    </div>
  </template>
</template>
