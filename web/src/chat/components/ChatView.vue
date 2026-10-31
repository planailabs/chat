<script setup lang="ts">
/**
 * The conversation on screen. Empty (a new chat), it is the hero: the
 * heading above the composer, centered. With messages, it scrolls and keeps
 * the newest part in view.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { renderMarkdown } from '../utils/markdown';
import ChatMessages from './chat/ChatMessages.vue';
import QuestionPrompt from './chat/QuestionPrompt.vue';
import PreferencePrompt from './chat/PreferencePrompt.vue';
import ApprovalCard from './chat/ApprovalCard.vue';
import LoginInvite from './chat/LoginInvite.vue';
import ChatComposer from './chat/ChatComposer.vue';

const chat = computed(() => store.state.chat);
const isEmpty = computed(() => !chat.value || chat.value.messages.length === 0);
const prompt = computed(() => (chat.value?.phase === 'question' ? chat.value.clientPrompt : undefined));

const main = ref<HTMLElement | null>(null);

// Keep the newest part of the conversation in view (not while an error or a
// running tool is shown: the user may be reading back).
watch(
  () => {
    const mc = chat.value;
    if (!mc) return '';
    const pref = mc.clientPrompt?.preference;
    return [mc.messages.length, mc.phase, mc.streamingText?.length, mc.approvals.length, pref?.visibleQuestionText.length, pref?.visibleFollowupText?.length, mc.loginInvite?.visibleText.length].join('|');
  },
  async () => {
    const mc = chat.value;
    if (!mc || mc.phase === 'error' || mc.phase === 'tool' || store.state.highlightMessageId !== null) return;
    await nextTick();
    if (main.value) main.value.scrollTop = main.value.scrollHeight;
  },
  { immediate: true },
);

// A search hit: scroll to its message once it is shown, highlight it for a
// moment. Gives up when it doesn't show up (e.g. the history failed).
const HIGHLIGHT_MS = 2500;
const GIVE_UP_MS = 8000;
let highlightTimer: ReturnType<typeof setTimeout> | null = null;
const clearHighlightLater = (id: number, ms: number) => {
  if (highlightTimer) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    if (store.state.highlightMessageId === id) store.state.highlightMessageId = null;
  }, ms);
};
let found: number | null = null;
watch(
  () => [store.state.highlightMessageId, chat.value?.messages.length] as const,
  async ([id], previous) => {
    if (id === null) {
      found = null;
      return;
    }
    if (id !== previous?.[0]) {
      found = null;
      clearHighlightLater(id, GIVE_UP_MS);
    }
    if (found === id) return;
    await nextTick();
    const el = main.value?.querySelector(`[data-message-id="${id}"]`);
    if (!el) return;
    found = id;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearHighlightLater(id, HIGHLIGHT_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => highlightTimer && clearTimeout(highlightTimer));
</script>

<template>
  <main
    ref="main"
    :class="
      isEmpty
        ? 'flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6'
        : 'flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-10 pb-6'
    "
  >
    <section
      v-if="chat"
      :class="isEmpty ? 'flex w-full max-w-3xl flex-col gap-4 text-center md:gap-6' : 'flex w-full max-w-3xl flex-col gap-8 text-left'"
    >
      <div v-if="isEmpty" class="text-center">
        <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">{{ locale.chat.heading }}</h1>
      </div>

      <ChatMessages :messages="chat.messages" />

      <div v-if="chat.phase === 'streaming' && chat.streamingText" class="flex justify-start">
        <div
          class="chat-markdown chat-markdown--streaming max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)"
          v-html="renderMarkdown(chat.streamingText)"
        />
      </div>

      <div v-if="chat.phase === 'waiting'" class="flex justify-start">
        <div class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-muted)">
          <span class="inline-flex gap-1">
            <span v-for="delay in [0, 150, 300]" :key="delay" class="inline-block h-2 w-2 animate-bounce rounded-full bg-(--text-muted)" :style="{ animationDelay: `${delay}ms` }" />
          </span>
        </div>
      </div>

      <div v-if="chat.phase === 'tool'" class="flex justify-start">
        <div class="flex max-w-[min(100%,640px)] items-center gap-2 text-xs text-(--text-muted)">
          <span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-(--text-muted) border-t-transparent" />
          {{ locale.chat.workingLabel }}
        </div>
      </div>

      <div v-if="chat.phase === 'error' && chat.error" class="flex justify-start">
        <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-red-500">{{ chat.error }}</p>
      </div>

      <QuestionPrompt v-if="prompt?.toolName === 'ask_question'" :key="prompt.callId" :prompt="prompt" />
      <PreferencePrompt v-if="prompt?.toolName === 'prompt_preference' && prompt.preference" :prompt="prompt" />

      <template v-if="chat.phase === 'approval'">
        <ApprovalCard v-for="a in chat.approvals" :key="a.callId" :approval="a" />
      </template>

      <LoginInvite v-if="chat.phase === 'login' && chat.loginInvite" :invite="chat.loginInvite" />

      <ChatComposer :chat="chat" />
    </section>
  </main>
</template>
