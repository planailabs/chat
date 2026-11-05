<script setup lang="ts">
/**
 * Settings: MCP servers the assistant may use (like Claude's custom
 * connectors): the user's own, each team's, and plan.ai's OAuth apps.
 * Team admins add, change and remove; OAuth ones are connected here.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { api, ApiError, type Connector, type ConnectorAuth, type ConnectorList, type ConnectorTeam } from '../api';
import { store } from '../app/store';
import { locale } from '../app/locale';

type AuthChoice = 'bearer' | 'oauth_per_member' | 'oauth_shared' | 'none';

const texts = computed(() => locale.value.settings.sections.connectors);
const data = ref<ConnectorList | null>(null);
const failed = ref(false);
const error = ref('');
const busy = ref<string | null>(null);
/** The team whose add form is open. */
const adding = ref<string | null>(null);
/** The connector being edited. */
const editing = ref<string | null>(null);
const form = reactive({ name: '', description: '', url: '', auth: 'bearer' as AuthChoice, token: '' });

const readOnly = computed(() => store.state.impersonating);

interface Group {
  key: string;
  title: string;
  team: ConnectorTeam | null;
  connectors: Connector[];
}

const groups = computed<Group[]>(() => {
  const d = data.value;
  if (!d) return [];
  const out: Group[] = d.teams
    .filter((t) => t.can_manage || d.connectors.some((c) => c.team_id === t.id))
    .map((t) => ({
      key: t.id,
      title: t.personal ? texts.value.personal : texts.value.team.replace('{{team}}', t.name),
      team: t,
      connectors: d.connectors.filter((c) => c.team_id === t.id),
    }));
  const configured = d.connectors.filter((c) => c.source === 'config');
  if (configured.length) out.push({ key: 'config', title: texts.value.configured, team: null, connectors: configured });
  return out;
});

const load = async () => {
  try {
    data.value = await api.connectors.list();
    failed.value = false;
  } catch (e) {
    console.error('[connectors] loading failed', e);
    failed.value = true;
  }
};

const fail = (e: unknown) => {
  error.value = texts.value.failed.replace('{{message}}', e instanceof ApiError ? e.message : String(e));
};

const reset = () => {
  Object.assign(form, { name: '', description: '', url: '', auth: 'bearer', token: '' });
  error.value = '';
};

const openAdd = (team: ConnectorTeam) => {
  reset();
  editing.value = null;
  adding.value = team.id;
};

const openEdit = (c: Connector) => {
  reset();
  adding.value = null;
  Object.assign(form, { name: c.name, description: c.description, url: c.url });
  editing.value = c.id;
};

const close = () => {
  adding.value = null;
  editing.value = null;
  reset();
};

const authOf = (choice: AuthChoice): ConnectorAuth => {
  switch (choice) {
    case 'bearer':
      return { type: 'bearer', token: form.token };
    case 'oauth_per_member':
      return { type: 'oauth', mode: 'per_member' };
    case 'oauth_shared':
      return { type: 'oauth', mode: 'shared' };
    default:
      return { type: 'none' };
  }
};

const run = async (key: string, action: () => Promise<unknown>) => {
  busy.value = key;
  error.value = '';
  try {
    await action();
    return true;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    busy.value = null;
  }
};

const submitAdd = async (team: ConnectorTeam) => {
  const ok = await run(`add:${team.id}`, () =>
    api.connectors.create({
      team_id: team.id,
      name: form.name.trim(),
      description: form.description.trim(),
      url: form.url.trim(),
      auth: authOf(form.auth),
    }),
  );
  if (ok) {
    close();
    await load();
  }
};

const submitEdit = async (c: Connector) => {
  const change: Record<string, string> = {};
  if (form.name.trim() !== c.name) change.name = form.name.trim();
  if (form.description.trim() !== c.description) change.description = form.description.trim();
  if (form.url.trim() !== c.url) change.url = form.url.trim();
  if (c.auth === 'bearer' && form.token.trim()) change.token = form.token.trim();
  const ok = await run(c.id, () => api.connectors.update(c.id, change));
  if (ok) {
    close();
    await load();
  }
};

const remove = async (c: Connector) => {
  if (await run(c.id, () => api.connectors.remove(c.id))) await load();
};

const connect = async (c: Connector) => {
  await run(c.id, async () => {
    const { url } = await api.connectors.connect(c.id);
    window.location.assign(url);
  });
};

const disconnect = async (c: Connector) => {
  if (await run(c.id, () => api.connectors.disconnect(c.id))) await load();
};

const statusClass = (c: Connector) =>
  c.status === 'needs_reconnect' ? 'text-red-500' : c.status === 'connect_first' ? 'text-amber-600' : 'text-green-600';

const authLabel = (c: Connector) => {
  const t = texts.value;
  if (c.auth === 'bearer') return c.token ? t.tokenSet.replace('{{hint}}', c.token) : t.authBearer;
  if (c.auth === 'oauth') return `OAuth · ${c.oauth_mode === 'shared' ? t.shared : t.perMember}`;
  return t.authNone;
};

const serviceLine = (c: Connector) => texts.value.service.replace('{{service}}', c.service);

const canConnectNow = (c: Connector) => c.can_connect && (c.status === 'connect_first' || c.status === 'needs_reconnect');
const canDisconnect = (c: Connector) => c.can_connect && (c.status === 'connected' || c.status === 'needs_reconnect');

onMounted(() => void load());
</script>

<template>
  <div class="mt-1" data-testid="connectors">
    <p class="text-xs text-(--text-muted)">{{ texts.intro }}</p>
    <p v-if="failed" class="mt-1 text-xs text-red-500">{{ texts.loadFailed }}</p>
    <p v-else-if="data && !data.enabled && groups.length === 0" class="mt-1 text-xs text-(--text-muted)">{{ texts.disabled }}</p>
    <p v-if="error" class="mt-1 text-xs text-red-500" role="alert">{{ error }}</p>

    <div v-for="group in groups" :key="group.key" class="mt-3" :data-testid="`connector-group-${group.key}`">
      <p class="text-xs font-semibold">{{ group.title }}</p>
      <p v-if="group.connectors.length === 0" class="text-xs text-(--text-muted)">{{ texts.none }}</p>
      <ul class="mt-1 flex flex-col gap-2">
        <li v-for="c in group.connectors" :key="c.id" class="text-xs" :data-testid="`connector-${c.id}`">
          <template v-if="editing === c.id">
            <form class="flex flex-col gap-1" @submit.prevent="submitEdit(c)">
              <input v-model="form.name" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" :aria-label="texts.name" :placeholder="texts.name" required />
              <input v-model="form.description" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" :aria-label="texts.description" :placeholder="texts.description" />
              <input v-model="form.url" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" type="url" :aria-label="texts.url" :placeholder="texts.url" required />
              <input
                v-if="c.auth === 'bearer'"
                v-model="form.token"
                class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs"
                type="password"
                autocomplete="off"
                :aria-label="texts.newToken"
                :placeholder="texts.newToken"
              />
              <span class="flex gap-1">
                <button type="submit" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === c.id">{{ texts.save }}</button>
                <button type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" @click="close">{{ texts.cancel }}</button>
              </span>
            </form>
          </template>
          <div v-else class="flex items-start justify-between gap-2">
            <span class="min-w-0">
              <span class="font-medium">{{ c.name }}</span>
              <span :class="['ml-1', statusClass(c)]" data-testid="connector-status">{{ texts.status[c.status] }}</span>
              <span class="block break-all text-(--text-muted)">{{ c.url }} · {{ authLabel(c) }}</span>
              <span class="block text-(--text-muted)">{{ serviceLine(c) }}</span>
              <span v-if="c.status_detail" class="block text-red-500">{{ c.status_detail }}</span>
              <span v-if="c.auth === 'oauth' && !c.can_connect && c.status !== 'connected'" class="block text-(--text-muted)">{{ texts.sharedByAdmin }}</span>
            </span>
            <span class="flex shrink-0 flex-wrap justify-end gap-1">
              <button v-if="canConnectNow(c)" type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === c.id || readOnly" @click="connect(c)">
                {{ c.status === 'needs_reconnect' ? texts.reconnect : texts.connect }}
              </button>
              <button v-if="canDisconnect(c)" type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === c.id || readOnly" @click="disconnect(c)">
                {{ texts.disconnect }}
              </button>
              <button v-if="c.can_manage" type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === c.id || readOnly" @click="openEdit(c)">
                {{ texts.edit }}
              </button>
              <button v-if="c.can_manage" type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === c.id || readOnly" @click="remove(c)">
                {{ texts.remove }}
              </button>
            </span>
          </div>
        </li>
      </ul>

      <template v-if="group.team?.can_manage && data?.enabled">
        <form v-if="adding === group.team.id" class="mt-2 flex flex-col gap-1" data-testid="connector-add-form" @submit.prevent="submitAdd(group.team)">
          <input v-model="form.name" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" :aria-label="texts.name" :placeholder="texts.name" required />
          <input v-model="form.description" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" :aria-label="texts.description" :placeholder="texts.description" />
          <input v-model="form.url" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" type="url" :aria-label="texts.url" placeholder="https://…/mcp" required />
          <label class="flex flex-col text-xs">
            <span>{{ texts.auth }}</span>
            <select v-model="form.auth" class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs" :aria-label="texts.auth">
              <option value="bearer">{{ texts.authBearer }}</option>
              <option value="oauth_per_member">{{ texts.authOauthPerMember }}</option>
              <option v-if="!group.team.personal" value="oauth_shared">{{ texts.authOauthShared }}</option>
              <option value="none">{{ texts.authNone }}</option>
            </select>
          </label>
          <input
            v-if="form.auth === 'bearer'"
            v-model="form.token"
            class="rounded-md border border-(--border-muted) bg-transparent px-2 py-1 text-xs"
            type="password"
            autocomplete="off"
            :aria-label="texts.token"
            :placeholder="texts.token"
            required
          />
          <span class="flex gap-1">
            <button type="submit" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" :disabled="busy === `add:${group.team.id}`">{{ texts.save }}</button>
            <button type="button" class="rounded border border-(--border-muted) px-2 py-0.5 hover:bg-(--surface-hover) disabled:opacity-50" @click="close">{{ texts.cancel }}</button>
          </span>
        </form>
        <button v-else type="button" class="mt-2 rounded border border-(--border-muted) px-2 py-0.5 text-xs hover:bg-(--surface-hover) disabled:opacity-50" :disabled="readOnly" @click="openAdd(group.team)">{{ texts.add }}</button>
      </template>
    </div>
  </div>
</template>

