import { getSupabaseClientOrThrow } from '../chat/supabase/client';
import { escapeHtml, getJwt } from './logic';

export function initTokens(container: HTMLElement) {
  const supabase = getSupabaseClientOrThrow();
  const searchInput = container.querySelector('.search-input') as HTMLInputElement;
  const searchBtn = container.querySelector('.search-btn') as HTMLButtonElement;
  const results = container.querySelector('.results') as HTMLElement;
  const userCards = container.querySelector('.user-cards') as HTMLElement;
  const statusMsg = container.querySelector('.status-msg') as HTMLElement;

  // Modal elements are page-level (fixed overlay)
  const tokenModal = document.getElementById('token-modal')!;
  const tokenInput = document.getElementById('token-input') as HTMLInputElement;
  const modalUserInfo = document.getElementById('modal-user-info')!;
  const modalCancel = document.getElementById('modal-cancel')!;
  const modalSave = document.getElementById('modal-save')!;
  const modalError = document.getElementById('modal-error')!;

  let modalUserId = '';
  let modalUserEmail = '';
  let lastSearchResults: any[] = [];

  function showStatus(msg: string, type: 'success' | 'error') {
    statusMsg.textContent = msg;
    statusMsg.className = `text-sm text-center py-2 rounded-lg ${type === 'success' ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`;
    statusMsg.classList.remove('hidden');
    setTimeout(() => statusMsg.classList.add('hidden'), 4000);
  }

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

  function renderUsers(users: any[]) {
    userCards.innerHTML = '';

    if (users.length === 0) {
      userCards.innerHTML = '<div class="text-sm opacity-40 py-4 text-center">No users found</div>';
      return;
    }

    for (const u of users) {
      const card = document.createElement('div');
      card.className = 'flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

      const tokenBadge = Boolean(u.customerToken)
        ? `<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Has token</span>`
        : `<span class="text-xs px-2 py-0.5 rounded-full bg-white/5 opacity-40 border border-white/5">No token</span>`;

      card.innerHTML = `
        <div class="flex items-center gap-3">
          <div>
            <div class="text-sm font-medium">${escapeHtml(u.email ?? 'No email')}</div>
            <div class="text-xs opacity-40 font-mono">${u.userId.slice(0, 16)}...</div>
          </div>
          ${tokenBadge}
        </div>
        <div class="flex items-center gap-2">
          <button class="set-token-btn px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors" data-user-id="${u.userId}" data-email="${escapeHtml(u.email ?? '')}">
            ${Boolean(u.customerToken) ? 'Change Token' : 'Set Token'}
          </button>
          ${Boolean(u.customerToken) ? `<button class="remove-token-btn px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-lg transition-colors" data-user-id="${u.userId}" data-email="${escapeHtml(u.email ?? '')}">Remove token</button>` : ''}
        </div>
      `;
      userCards.appendChild(card);
    }

    // Bind set token buttons
    userCards.querySelectorAll('.set-token-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const el = e.currentTarget as HTMLElement;
        openTokenModal(el.dataset.userId!, el.dataset.email!);
      });
    });

    // Bind remove token buttons
    userCards.querySelectorAll('.remove-token-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const el = e.currentTarget as HTMLElement;
        const userId = el.dataset.userId!;
        const email = el.dataset.email!;

        if (!confirm(`Remove customer token for ${email}?`)) return;

        el.textContent = 'Removing...';
        (el as HTMLButtonElement).disabled = true;

        try {
          const jwt = await getJwt();
          const res = await fetch('/api/admin/customer-token/', {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${jwt}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId }),
          });
          const data = await res.json();
          if (res.ok) {
            showStatus(`Token removed for ${email}`, 'success');
            const user = lastSearchResults.find((u: any) => u.userId === userId);
            if (user) {
              user.hasCustomerToken = false;
              user.customerToken = null;
            }
            renderUsers(lastSearchResults);
          } else {
            showStatus(data.error ?? 'Failed to remove token', 'error');
          }
        } catch {
          showStatus('Network error', 'error');
        }
      });
    });
  }

  function openTokenModal(userId: string, email: string) {
    modalUserId = userId;
    modalUserEmail = email;
    modalUserInfo.textContent = `${email} (${userId.slice(0, 12)}...)`;
    tokenInput.value = '';
    modalError.classList.add('hidden');
    tokenModal.classList.remove('hidden');
    tokenModal.classList.add('flex');
    tokenInput.focus();
  }

  function closeTokenModal() {
    tokenModal.classList.add('hidden');
    tokenModal.classList.remove('flex');
  }

  modalCancel.addEventListener('click', closeTokenModal);
  tokenModal.addEventListener('click', (e) => {
    if (e.target === tokenModal) closeTokenModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !tokenModal.classList.contains('hidden')) closeTokenModal();
  });

  modalSave.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) return;

    modalSave.textContent = 'Validating...';
    (modalSave as HTMLButtonElement).disabled = true;

    try {
      const jwt = await getJwt();
      const res = await fetch('/api/admin/customer-token/', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: modalUserId, token }),
      });
      const data = await res.json();
      if (res.ok) {
        modalError.classList.add('hidden');
        showStatus(`Token set for ${modalUserEmail}`, 'success');
        closeTokenModal();
        const user = lastSearchResults.find((u: any) => u.userId === modalUserId);
        if (user) {
          user.hasCustomerToken = true;
          user.customerToken = token;
        }
        renderUsers(lastSearchResults);
      } else {
        modalError.textContent = data.error ?? 'Failed to set token';
        modalError.classList.remove('hidden');
      }
    } catch {
      modalError.textContent = 'Network error';
      modalError.classList.remove('hidden');
    } finally {
      modalSave.textContent = 'Save Token';
      (modalSave as HTMLButtonElement).disabled = false;
    }
  });
}
