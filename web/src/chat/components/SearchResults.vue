<script setup lang="ts">
/**
 * Search hits for `query` (debounced): grouped by conversation, the title
 * and up to three snippets each. Matches are <mark>ed in escaped text.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import { locale } from '../app/locale';
import type { SearchHit } from '../api';
import { groupHits, isSearchable, openSearchHit, searchConversations, snippetHtml, snippetText, titleHtml } from '../actions/chat/search';

const props = defineProps<{ query: string }>();
const emit = defineEmits<{ opened: [] }>();

const DEBOUNCE_MS = 250;

const hits = ref<SearchHit[]>([]);
const loading = ref(false);
const failed = ref(false);
/** The query the hits are for (only the newest request's answer counts). */
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const run = async (q: string) => {
  const mine = ++sequence;
  try {
    const result = await searchConversations(q);
    if (mine !== sequence) return;
    hits.value = result;
    failed.value = false;
  } catch (error) {
    if (mine !== sequence) return;
    console.error('[search] failed', error);
    failed.value = true;
  } finally {
    if (mine === sequence) loading.value = false;
  }
};

watch(
  () => props.query,
  (q) => {
    if (timer) clearTimeout(timer);
    if (!isSearchable(q)) {
      sequence++;
      hits.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    timer = setTimeout(() => void run(q), DEBOUNCE_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  sequence++;
});

const groups = computed(() => groupHits(hits.value));

const open = (conversation: string, messageId: number | null) => {
  emit('opened');
  void openSearchHit(conversation, messageId);
};
</script>

<template>
  <div class="sidebar-search-results" aria-live="polite">
    <p v-if="!loading && (failed || groups.length === 0) && isSearchable(query)" class="sidebar-empty">{{ locale.sidebar.noResults }}</p>
    <section v-for="group in groups" :key="group.conversation" class="search-group">
      <button
        type="button"
        class="search-hit search-hit--title"
        :title="group.title"
        @click="open(group.conversation, null)"
      >
        <span v-if="group.titleHit" class="search-hit__text" v-html="titleHtml(group.title, group.titleHit.snippet)" />
        <span v-else class="search-hit__text">{{ group.title.trim() || '…' }}</span>
      </button>
      <button
        v-for="hit in group.hits"
        :key="hit.message_id ?? 'title'"
        type="button"
        class="search-hit"
        :title="snippetText(hit.snippet)"
        @click="open(hit.conversation, hit.message_id)"
      >
        <AppIcon
          :name="hit.role === 'assistant' ? 'assistant' : 'user'"
          class="sidebar-icon"
          role="img"
          :aria-label="hit.role === 'assistant' ? locale.sidebar.assistant : locale.sidebar.you"
          :aria-hidden="false"
        />
        <span class="search-hit__text" v-html="snippetHtml(hit.snippet)" />
      </button>
    </section>
  </div>
</template>
