<script setup lang="ts">
/** The conversation: user, assistant (sanitized markdown), dismissed questions and approval records. */
import type { PropType } from 'vue';
import type { ChatMessage } from '../../app/state';
import { locale } from '../../app/locale';
import { renderMarkdown } from '../../utils/markdown';
import { formatToolArgs } from '../../utils/format';
import { store } from '../../app/store';
import ToolRun from './ToolRun.vue';

defineProps({ messages: { type: Array as PropType<ChatMessage[]>, required: true } });

const approvalStatus = (decision: 'approved' | 'denied' | null) => {
  const labels = locale.value.chat.approval;
  return decision === 'approved' ? labels.approved : decision === 'denied' ? labels.denied : labels.requested;
};
</script>

<template>
  <template v-for="(msg, i) in messages" :key="i">
    <div v-if="msg.role === 'approval'" class="flex justify-start">
      <p class="max-w-[min(100%,640px)] text-xs text-(--text-muted)">
        <span class="font-mono font-semibold">{{ msg.name }}</span>
        {{ ' ' }}
        <span v-if="formatToolArgs(msg.input, 120, false)" class="font-mono break-all opacity-80">{{ formatToolArgs(msg.input, 120, false) }}</span>
        {{ ' ' }}
        <span class="whitespace-nowrap">· {{ approvalStatus(msg.decision) }}</span>
      </p>
    </div>
    <ToolRun v-else-if="msg.role === 'tool'" :run="msg" />
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
