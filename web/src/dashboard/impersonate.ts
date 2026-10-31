import { api, startImpersonation } from '../chat/api';
import { errorMessage, escapeHtml } from './logic';

export function initImpersonate(container: HTMLElement) {
  const searchInput = container.querySelector('.search-input') as HTMLInputElement;
  const searchBtn = container.querySelector('.search-btn') as HTMLButtonElement;
  const results = container.querySelector('.results') as HTMLElement;
  const userList = container.querySelector('.user-list') as HTMLElement;

  async function searchUsers() {
    const q = searchInput.value.trim();
    if (q.length < 2) return;

    searchBtn.textContent = 'Searching...';
    searchBtn.disabled = true;

    try {
      const users = await api.admin.users(q);
      userList.innerHTML = '';
      if (users.length === 0) {
        userList.innerHTML = '<div class="text-sm opacity-40 py-4 text-center">No users found</div>';
      }
      for (const u of users) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';
        row.innerHTML = `
          <div>
            <div class="text-sm font-medium">${escapeHtml(u.name || u.email)}</div>
            <div class="text-xs opacity-40">${escapeHtml(u.email)} <span class="font-mono">${escapeHtml(u.id.slice(0, 8))}...</span></div>
          </div>
          <button
            type="button"
            class="open-as-user px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors font-medium"
          >
            Open as user
          </button>
        `;
        row.querySelector('.open-as-user')!.addEventListener('click', () => {
          startImpersonation(u.id);
          window.location.href = '/';
        });
        userList.appendChild(row);
      }
    } catch (error) {
      userList.innerHTML = `<div class="text-sm text-red-400 py-4 text-center">Search failed: ${escapeHtml(errorMessage(error))}</div>`;
    } finally {
      results.classList.remove('hidden');
      searchBtn.textContent = 'Search';
      searchBtn.disabled = false;
    }
  }

  searchBtn.addEventListener('click', searchUsers);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
  });
}
