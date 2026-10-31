<script setup lang="ts">
/** Signed out after typing a prompt: the invitation to sign in (the prompt is sent afterwards). */
import type { PropType } from 'vue';
import type { LoginInvite } from '../../app/state';
import { locale } from '../../app/locale';
import { handleSignIn } from '../../actions/auth';

const props = defineProps({ invite: { type: Object as PropType<LoginInvite>, required: true } });

const signIn = () => {
  if (props.invite.ctaLocked) return;
  props.invite.ctaLocked = true;
  handleSignIn();
};
</script>

<template>
  <div class="flex justify-start">
    <p class="max-w-[min(100%,640px)] text-base leading-relaxed text-(--text-primary)">
      {{ invite.visibleText }}<span v-if="invite.isStreaming" class="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-(--text-muted)" />
    </p>
  </div>
  <div v-if="invite.ctaVisible" class="chat-cta-stack chat-cta-stack--fade flex flex-wrap gap-3 text-sm text-(--text-primary) transition-all duration-300">
    <button
      type="button"
      :class="['chat-cta-button', { 'is-disabled is-selected': invite.ctaLocked }]"
      :disabled="invite.ctaLocked"
      :aria-disabled="Boolean(invite.ctaLocked)"
      @click.stop="signIn"
    >
      {{ locale.navigation.loginMenu.labelLoggedOut }}
    </button>
  </div>
</template>
