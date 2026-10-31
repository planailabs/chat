<script setup lang="ts">
/**
 * Sidebar — "New chat", the user's conversations grouped by date, and
 * plan.ai's applications. Desktop: a column that can be collapsed. Mobile:
 * an off-canvas drawer opened from the header. Hidden when signed out.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import { store } from '../app/store';
import { locale } from '../app/locale';
import { pathForConversation } from '../app/route';
import { APPLICATIONS } from '../content/applications';
import { groupConversations, type ConversationItem } from '../actions/chat/conversationList';
import {
  closeSidebarDrawer,
  deleteConversation,
  openConversation,
  renameConversation,
  startNewChat,
  startRenaming,
  stopRenaming,
} from '../actions/chat';

const state = store.state;

const groups = computed(() => groupConversations(state.conversations));

const regionClass = computed(() => [
  'sidebar',
  {
    'is-hidden': !state.isAuthenticated,
    'is-open': state.isSidebarOpen,
    'is-collapsed': state.isSidebarCollapsed,
  },
]);

const titleOf = (c: ConversationItem) => c.title.trim() || '…';

const showsActivity = (c: ConversationItem) => c.id !== state.activeConversationId && (c.busy || c.unread);

/** A link, so it can also open in a new tab (modifier keys, middle click). */
const open = (event: MouseEvent, id: string) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (id === state.activeConversationId) {
    closeSidebarDrawer();
    return;
  }
  void openConversation(id, 'push');
};

// ── Rename ─────────────────────────────────────────────────────────────────
const renameInput = ref<HTMLInputElement[]>([]);
const renameValue = ref('');

watch(
  () => state.renamingConversationId,
  async (id) => {
    if (!id) return;
    renameValue.value = titleOf(state.conversations.find((c) => c.id === id) ?? { title: '' } as ConversationItem);
    await nextTick();
    const input = renameInput.value[0];
    input?.focus();
    input?.select();
  },
);

const onRenameKeydown = (event: KeyboardEvent, id: string) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void renameConversation(id, renameValue.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    stopRenaming();
  }
};

/** Leaving the field saves (unless Enter or Escape already ended the rename). */
const onRenameBlur = (id: string) => {
  if (state.renamingConversationId === id) void renameConversation(id, renameValue.value);
};

const remove = (c: ConversationItem) => {
  const question = locale.value.sidebar.deleteConfirm.replace('{{title}}', c.title);
  if (window.confirm(question)) void deleteConversation(c.id);
};

// Escape closes the mobile drawer.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && state.isSidebarOpen) closeSidebarDrawer();
};
onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <aside id="sidebar-region" :class="regionClass">
    <template v-if="state.isAuthenticated">
      <div class="sidebar-backdrop" aria-hidden="true" @click="closeSidebarDrawer" />
      <div class="sidebar-panel">
        <div class="sidebar-top">
          <button v-if="!state.impersonating" type="button" class="sidebar-new-chat" @click="startNewChat">
            <AppIcon name="newChat" class="sidebar-icon" />
            <span>{{ locale.sidebar.newChat }}</span>
          </button>
        </div>

        <div class="sidebar-scroll">
          <p v-if="groups.length === 0" class="sidebar-empty">{{ locale.sidebar.empty }}</p>
          <section v-for="group in groups" :key="group.key" class="sidebar-group">
            <h2 class="sidebar-heading">{{ locale.sidebar.groups[group.key] }}</h2>
            <ul class="sidebar-list">
              <template v-for="c in group.items" :key="c.id">
                <li v-if="c.id === state.renamingConversationId && !state.impersonating" class="sidebar-item is-renaming">
                  <input
                    ref="renameInput"
                    v-model="renameValue"
                    class="sidebar-rename-input"
                    type="text"
                    maxlength="120"
                    :aria-label="locale.sidebar.rename"
                    @keydown="onRenameKeydown($event, c.id)"
                    @blur="onRenameBlur(c.id)"
                  />
                </li>
                <li v-else :class="['sidebar-item', { 'is-active': c.id === state.activeConversationId }]">
                  <a
                    class="sidebar-item__link"
                    :href="pathForConversation(c.id)"
                    :aria-current="c.id === state.activeConversationId ? 'page' : undefined"
                    @click="open($event, c.id)"
                  >
                    <span class="sidebar-item__title">{{ titleOf(c) }}</span>
                    <span
                      v-if="showsActivity(c)"
                      :class="['sidebar-dot', { 'is-busy': c.busy }]"
                      role="img"
                      :aria-label="locale.sidebar.activity"
                    />
                  </a>
                  <span v-if="!state.impersonating" class="sidebar-item__actions">
                    <button
                      type="button"
                      class="sidebar-item__action"
                      :aria-label="locale.sidebar.rename"
                      :title="locale.sidebar.rename"
                      @click.prevent="startRenaming(c.id)"
                    >
                      <AppIcon name="rename" class="sidebar-icon" />
                    </button>
                    <button
                      type="button"
                      class="sidebar-item__action"
                      :aria-label="locale.sidebar.delete"
                      :title="locale.sidebar.delete"
                      @click.prevent="remove(c)"
                    >
                      <AppIcon name="delete" class="sidebar-icon" />
                    </button>
                  </span>
                </li>
              </template>
            </ul>
          </section>
        </div>

        <nav class="sidebar-apps" :aria-label="locale.sidebar.applications">
          <h2 class="sidebar-heading">{{ locale.sidebar.applications }}</h2>
          <ul class="sidebar-list">
            <li v-for="app in APPLICATIONS" :key="app.url">
              <a class="sidebar-app" :href="app.url" target="_blank" rel="noopener noreferrer">
                <AppIcon :name="app.icon" class="sidebar-icon" />
                <span class="sidebar-item__title">{{ app.label[state.localeKey] }}</span>
                <AppIcon name="external" class="sidebar-icon sidebar-icon--small" />
                <span class="sr-only">({{ locale.sidebar.newTab }})</span>
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </template>
  </aside>
</template>
