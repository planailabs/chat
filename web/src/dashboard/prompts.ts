import { api, type UserHit } from '../chat/api';
import { errorMessage, escapeHtml } from './logic';

const MODES = ['machine_config', 'sales'] as const;
const MODE_LABELS: Record<string, string> = {
  machine_config: 'Machine Config',
  sales: 'Sales',
};

export function initPrompts(container: HTMLElement) {
  const searchInput = container.querySelector('.search-input') as HTMLInputElement;
  const searchBtn = container.querySelector('.search-btn') as HTMLButtonElement;
  const results = container.querySelector('.results') as HTMLElement;
  const userCards = container.querySelector('.user-cards') as HTMLElement;
  const statusMsg = container.querySelector('.status-msg') as HTMLElement;

  // Modal elements
  const modal = document.getElementById('prompt-ext-modal')!;
  const modeSelect = document.getElementById('prompt-ext-mode') as HTMLSelectElement;
  const contentArea = document.getElementById('prompt-ext-content') as HTMLTextAreaElement;
  const userInfo = document.getElementById('prompt-ext-user-info')!;
  const errorEl = document.getElementById('prompt-ext-error')!;
  const saveBtn = document.getElementById('prompt-ext-save') as HTMLButtonElement;
  const cancelBtn = document.getElementById('prompt-ext-cancel')!;
  const deleteBtn = document.getElementById('prompt-ext-delete') as HTMLButtonElement;

  let modalUser: UserHit | null = null;
  let lastSearchResults: UserHit[] = [];

  function showStatus(msg: string, type: 'success' | 'error') {
    statusMsg.textContent = msg;
    statusMsg.className = `text-sm text-center py-2 rounded-lg ${type === 'success' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`;
    statusMsg.classList.remove('hidden');
    setTimeout(() => statusMsg.classList.add('hidden'), 4000);
  }

  function showModalError(msg: string) {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async function searchUsers() {
    const q = searchInput.value.trim();
    if (q.length < 2) return;

    searchBtn.textContent = 'Searching...';
    searchBtn.disabled = true;

    try {
      lastSearchResults = await api.admin.users(q);
      renderUsers();
      results.classList.remove('hidden');
    } catch (error) {
      showStatus(`Search failed: ${errorMessage(error)}`, 'error');
    } finally {
      searchBtn.textContent = 'Search';
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener('click', searchUsers);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
  });

  // ── User Cards ──────────────────────────────────────────────────────────────

  function renderUsers() {
    userCards.innerHTML = '';

    if (lastSearchResults.length === 0) {
      userCards.innerHTML = '<div class="text-sm opacity-40 py-4 text-center">No users found</div>';
      return;
    }

    for (const u of lastSearchResults) {
      const card = document.createElement('div');
      card.className = 'flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

      const badges = u.extension_modes.length > 0
        ? u.extension_modes
            .map((m) => `<span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">${escapeHtml(MODE_LABELS[m] ?? m)}</span>`)
            .join(' ')
        : '<span class="text-xs px-2 py-0.5 rounded-full bg-white/5 opacity-40 border border-white/5">No extensions</span>';

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div>
            <div class="text-sm font-medium">${escapeHtml(u.email)}</div>
            <div class="text-xs opacity-40 font-mono">${escapeHtml(u.id.slice(0, 16))}...</div>
          </div>
          <div class="flex items-center gap-1">${badges}</div>
        </div>
        <button type="button" class="edit-prompt-btn px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
          Edit Prompt
        </button>
      `;
      card.querySelector('.edit-prompt-btn')!.addEventListener('click', () => void openModal(u));
      userCards.appendChild(card);
    }
  }

  // ── Modal ───────────────────────────────────────────────────────────────────

  async function loadExtension() {
    if (!modalUser) return;
    contentArea.value = '';
    contentArea.placeholder = 'Loading...';
    try {
      const [extension] = await api.admin.promptExtensions(modalUser.id, modeSelect.value);
      contentArea.value = extension?.content ?? '';
    } catch (error) {
      showModalError(`Loading failed: ${errorMessage(error)}`);
    } finally {
      contentArea.placeholder = 'Additional system prompt instructions for this user...';
    }
  }

  async function openModal(user: UserHit) {
    modalUser = user;
    userInfo.textContent = `${user.email} (${user.id.slice(0, 12)}...)`;
    errorEl.classList.add('hidden');
    modeSelect.value = MODES[0];
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await loadExtension();
    contentArea.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  modeSelect.addEventListener('change', () => {
    errorEl.classList.add('hidden');
    void loadExtension();
  });

  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  function setModes(user: UserHit, mode: string, present: boolean) {
    const others = user.extension_modes.filter((m) => m !== mode);
    user.extension_modes = present ? [...others, mode].sort() : others;
    renderUsers();
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const user = modalUser;
    const content = contentArea.value.trim();
    if (!user || !content) return;
    const mode = modeSelect.value;

    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    try {
      await api.admin.setPromptExtension(user.id, mode, content);
      errorEl.classList.add('hidden');
      showStatus(`Prompt extension saved for ${user.email} (${MODE_LABELS[mode]})`, 'success');
      closeModal();
      setModes(user, mode, true);
    } catch (error) {
      showModalError(errorMessage(error));
    } finally {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  deleteBtn.addEventListener('click', async () => {
    const user = modalUser;
    if (!user) return;
    const mode = modeSelect.value;
    if (!confirm(`Remove prompt extension for ${user.email} (${MODE_LABELS[mode]})?`)) return;

    deleteBtn.textContent = 'Deleting...';
    deleteBtn.disabled = true;
    try {
      await api.admin.removePromptExtension(user.id, mode);
      errorEl.classList.add('hidden');
      showStatus(`Prompt extension removed for ${user.email} (${MODE_LABELS[mode]})`, 'success');
      closeModal();
      setModes(user, mode, false);
    } catch (error) {
      showModalError(errorMessage(error));
    } finally {
      deleteBtn.textContent = 'Delete';
      deleteBtn.disabled = false;
    }
  });
}
