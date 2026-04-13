import { escapeHtml, getJwt } from './logic';

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

  let modalUserId = '';
  let modalUserEmail = '';
  let lastSearchResults: any[] = [];

  function showStatus(msg: string, type: 'success' | 'error') {
    statusMsg.textContent = msg;
    statusMsg.className = `text-sm text-center py-2 rounded-lg ${type === 'success' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`;
    statusMsg.classList.remove('hidden');
    setTimeout(() => statusMsg.classList.add('hidden'), 4000);
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async function searchUsers() {
    const q = searchInput.value.trim();
    if (q.length < 2) return;

    searchBtn.textContent = 'Searching...';
    searchBtn.disabled = true;

    try {
      const jwt = await getJwt();
      const res = await fetch(`/api/admin/search-users/?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json();
      lastSearchResults = data.users ?? [];
      renderUsers(lastSearchResults);
      results.classList.remove('hidden');
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

  function renderUsers(users: any[]) {
    userCards.innerHTML = '';

    if (users.length === 0) {
      userCards.innerHTML = '<div class="text-sm opacity-40 py-4 text-center">No users found</div>';
      return;
    }

    for (const u of users) {
      const card = document.createElement('div');
      card.className = 'flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

      const exts: string[] = u.systemPromptExtensions ?? [];
      const badges = exts.length > 0
        ? exts.map((m: string) =>
            `<span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">${escapeHtml(MODE_LABELS[m] ?? m)}</span>`
          ).join(' ')
        : `<span class="text-xs px-2 py-0.5 rounded-full bg-white/5 opacity-40 border border-white/5">No extensions</span>`;

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div>
            <div class="text-sm font-medium">${escapeHtml(u.email ?? 'No email')}</div>
            <div class="text-xs opacity-40 font-mono">${u.userId.slice(0, 16)}...</div>
          </div>
          <div class="flex items-center gap-1">${badges}</div>
        </div>
        <button class="edit-prompt-btn px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors" data-user-id="${u.userId}" data-email="${escapeHtml(u.email ?? '')}">
          Edit Prompt
        </button>
      `;
      userCards.appendChild(card);
    }

    userCards.querySelectorAll('.edit-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const el = e.currentTarget as HTMLElement;
        openModal(el.dataset.userId!, el.dataset.email!);
      });
    });
  }

  // ── Modal ───────────────────────────────────────────────────────────────────

  async function fetchExtension(userId: string, mode: string): Promise<string> {
    try {
      const jwt = await getJwt();
      const res = await fetch(`/api/admin/system-prompt-extension/?userId=${encodeURIComponent(userId)}&mode=${encodeURIComponent(mode)}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json();
      return data.content ?? '';
    } catch {
      return '';
    }
  }

  async function openModal(userId: string, email: string) {
    modalUserId = userId;
    modalUserEmail = email;
    userInfo.textContent = `${email} (${userId.slice(0, 12)}...)`;
    errorEl.classList.add('hidden');
    modeSelect.value = MODES[0];

    // Fetch existing content for the default mode
    contentArea.value = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    contentArea.placeholder = 'Loading...';
    const content = await fetchExtension(userId, modeSelect.value);
    contentArea.value = content;
    contentArea.placeholder = 'Additional system prompt instructions for this user...';
    contentArea.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  // Reload content when mode changes
  modeSelect.addEventListener('change', async () => {
    contentArea.value = '';
    contentArea.placeholder = 'Loading...';
    const content = await fetchExtension(modalUserId, modeSelect.value);
    contentArea.value = content;
    contentArea.placeholder = 'Additional system prompt instructions for this user...';
  });

  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const content = contentArea.value.trim();
    if (!content) return;

    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      const jwt = await getJwt();
      const res = await fetch('/api/admin/system-prompt-extension/', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: modalUserId, mode: modeSelect.value, content }),
      });
      const data = await res.json();
      if (res.ok) {
        errorEl.classList.add('hidden');
        showStatus(`Prompt extension saved for ${modalUserEmail} (${MODE_LABELS[modeSelect.value]})`, 'success');
        closeModal();
        // Update local search results
        const user = lastSearchResults.find((u: any) => u.userId === modalUserId);
        if (user) {
          const exts: string[] = user.systemPromptExtensions ?? [];
          if (!exts.includes(modeSelect.value)) exts.push(modeSelect.value);
          user.systemPromptExtensions = exts;
        }
        renderUsers(lastSearchResults);
      } else {
        errorEl.textContent = data.error ?? 'Failed to save';
        errorEl.classList.remove('hidden');
      }
    } catch {
      errorEl.textContent = 'Network error';
      errorEl.classList.remove('hidden');
    } finally {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Remove prompt extension for ${modalUserEmail} (${MODE_LABELS[modeSelect.value]})?`)) return;

    deleteBtn.textContent = 'Deleting...';
    deleteBtn.disabled = true;

    try {
      const jwt = await getJwt();
      const res = await fetch('/api/admin/system-prompt-extension/', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: modalUserId, mode: modeSelect.value }),
      });
      const data = await res.json();
      if (res.ok) {
        errorEl.classList.add('hidden');
        showStatus(`Prompt extension removed for ${modalUserEmail} (${MODE_LABELS[modeSelect.value]})`, 'success');
        closeModal();
        // Update local search results
        const user = lastSearchResults.find((u: any) => u.userId === modalUserId);
        if (user) {
          user.systemPromptExtensions = (user.systemPromptExtensions ?? []).filter((m: string) => m !== modeSelect.value);
        }
        renderUsers(lastSearchResults);
      } else {
        errorEl.textContent = data.error ?? 'Failed to delete';
        errorEl.classList.remove('hidden');
      }
    } catch {
      errorEl.textContent = 'Network error';
      errorEl.classList.remove('hidden');
    } finally {
      deleteBtn.textContent = 'Delete';
      deleteBtn.disabled = false;
    }
  });
}
