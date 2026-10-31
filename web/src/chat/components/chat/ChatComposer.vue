<script setup lang="ts">
/**
 * The input: shown when idle, after an error, and for text questions (with
 * Skip). Enter sends, Shift+Enter is a new line. What is typed stays while
 * the rest of the page changes.
 */
import { computed, ref, type PropType } from 'vue';
import type { ChatSession } from '../../app/state';
import { locale } from '../../app/locale';
import { sendChatMessage, cancelChatQuestion } from '../../actions/chat';
import AppIcon from '../AppIcon.vue';

const props = defineProps({ chat: { type: Object as PropType<ChatSession>, required: true } });

const textQuestion = computed(() => {
  const prompt = props.chat.phase === 'question' ? props.chat.clientPrompt : undefined;
  const input = prompt?.toolName === 'ask_question' ? (prompt.input as { type?: string; question?: string }) : undefined;
  return input?.type === 'text' ? input : undefined;
});
const visible = computed(() => props.chat.phase === 'idle' || props.chat.phase === 'error' || textQuestion.value !== undefined);
const placeholder = computed(() => textQuestion.value?.question ?? locale.value.chat.placeholder);

const input = ref<HTMLElement | null>(null);
const hasContent = ref(false);

const onInput = () => {
  hasContent.value = (input.value?.textContent ?? '').trim().length > 0;
};

const send = () => {
  const el = input.value;
  const value = (el?.textContent ?? '').trim();
  if (!el || !value) return;
  el.textContent = '';
  hasContent.value = false;
  void sendChatMessage(value);
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
};
</script>

<template>
  <div v-if="visible" class="composer-card">
    <div class="composer-wrapper">
      <button v-if="textQuestion" type="button" class="composer-skip-button" @click.stop="cancelChatQuestion">{{ locale.chat.skipLabel }}</button>
      <div
        ref="input"
        class="composer-input"
        role="textbox"
        contenteditable="plaintext-only"
        :aria-label="placeholder"
        :data-empty="hasContent ? 'false' : 'true'"
        inputmode="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="sentences"
        @input="onInput"
        @keydown="onKeydown"
      />
      <button
        type="button"
        class="composer-send-button"
        :aria-label="locale.composer.submitLabel"
        :aria-disabled="!hasContent"
        :disabled="!hasContent"
        @click="send"
      >
        <AppIcon name="send" />
      </button>
    </div>
  </div>
</template>
