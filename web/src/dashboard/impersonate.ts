import { getSupabaseClientOrThrow } from '../chat/supabase/client';
import { escapeHtml, getJwt } from './logic';

export function initImpersonate(container: HTMLElement) {
  const supabase = getSupabaseClientOrThrow();
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
      const jwt = await getJwt();
      const res = await fetch(`/api/admin/search-users/?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const data = await res.json();

      userList.innerHTML = '';
      if (!data.users || data.users.length === 0) {
        userList.innerHTML = '<div class="text-sm opacity-40 py-4 text-center">No users found</div>';
      } else {
        for (const u of data.users) {
          const row = document.createElement('div');
          row.className = 'flex items-center justify-between px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

          const badges = [
            u.customerToken
              ? '<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Has token</span>'
              : '',
            u.newsletterOptIn === true
              ? '<span class="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Newsletter</span>'
              : '',
            u.pendingDeletion
              ? '<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">Pending deletion</span>'
              : '',
          ].filter(Boolean).join(' ');

          row.innerHTML = `
            <div class="flex items-center gap-3">
              <div>
                <div class="text-sm font-medium">${escapeHtml(u.displayName ?? u.email ?? 'No email')}</div>
                <div class="text-xs opacity-40">${escapeHtml(u.email ?? '')} <span class="font-mono">${u.userId.slice(0, 8)}...</span></div>
              </div>
              <div class="flex gap-1">${badges}</div>
            </div>
            <a
              href="/?impersonate=${u.userId}"
              class="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors font-medium"
            >
              Open as user
            </a>
          `;
          userList.appendChild(row);
        }
      }
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
}
