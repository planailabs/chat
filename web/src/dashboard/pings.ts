import { getSupabaseClientOrThrow } from '../chat/supabase/client';
import { escapeHtml } from './logic';

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  demo_request:       { label: 'Demo',       color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  callback_request:   { label: 'Callback',   color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  support_escalation: { label: 'Escalation', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  other:              { label: 'Other',       color: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20' },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type Ping = {
  id: string;
  user_id: string;
  reason: string;
  message: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
};

type Profile = {
  user_id: string;
  provider_identity: Record<string, unknown> | null;
};

export function initPings(container: HTMLElement) {
  const supabase = getSupabaseClientOrThrow();
  const pingList = container.querySelector('.ping-list') as HTMLElement;
  const pingCount = container.querySelector('.ping-count') as HTMLElement;
  const showResolvedCheckbox = container.querySelector('.show-resolved') as HTMLInputElement;

  let allPings: Ping[] = [];
  let profileMap = new Map<string, { name: string; email: string }>();

  async function loadPings() {
    const { data, error } = await supabase
      .from('staff_pings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      pingList.innerHTML = `<div class="text-sm text-red-400 py-4 text-center">Error loading pings: ${escapeHtml(error.message)}</div>`;
      return;
    }

    allPings = (data ?? []) as Ping[];

    const userIds = [...new Set(allPings.map((p) => p.user_id))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, provider_identity')
        .in('user_id', userIds);

      profileMap = new Map();
      for (const p of (profiles ?? []) as Profile[]) {
        const pi = p.provider_identity ?? {};
        profileMap.set(p.user_id, {
          name: (pi.name as string) ?? (pi.displayName as string) ?? '',
          email: (pi.email as string) ?? '',
        });
      }
    }

    render();
  }

  function render() {
    const showResolved = showResolvedCheckbox.checked;
    const visible = showResolved ? allPings : allPings.filter((p) => !p.resolved);

    pingCount.textContent = `${visible.length} ping${visible.length === 1 ? '' : 's'}`;

    if (visible.length === 0) {
      pingList.innerHTML = '<div class="text-sm opacity-40 py-8 text-center">No pings to show</div>';
      return;
    }

    pingList.innerHTML = '';
    for (const ping of visible) {
      const profile = profileMap.get(ping.user_id);
      const reason = REASON_LABELS[ping.reason] ?? REASON_LABELS.other;

      const row = document.createElement('div');
      row.className = 'flex items-start justify-between gap-4 px-4 py-3 rounded-lg border border-white/10 hover:border-white/20 transition-colors';

      const rightHtml = ping.resolved
        ? '<span class="text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 whitespace-nowrap">Resolved</span>'
        : `<button data-ping-id="${ping.id}" class="resolve-btn px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap">Resolve</button>`;

      row.innerHTML = `
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs px-2 py-0.5 rounded-full border ${reason.color}">${reason.label}</span>
            <span class="text-sm font-medium">${escapeHtml(profile?.name || profile?.email || ping.user_id.slice(0, 8) + '...')}</span>
            ${profile?.email ? `<span class="text-xs opacity-40">${escapeHtml(profile.email)}</span>` : ''}
            <span class="text-xs opacity-30">${relativeTime(ping.created_at)}</span>
          </div>
          <div class="text-sm opacity-70 break-words">${escapeHtml(ping.message)}</div>
        </div>
        <div class="flex-shrink-0 pt-0.5">${rightHtml}</div>
      `;

      pingList.appendChild(row);
    }

    // Attach resolve handlers
    for (const btn of pingList.querySelectorAll('.resolve-btn')) {
      btn.addEventListener('click', async (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const pingId = target.dataset.pingId!;
        target.textContent = '...';
        target.disabled = true;

        const { error } = await supabase
          .from('staff_pings')
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq('id', pingId);

        if (error) {
          target.textContent = 'Error';
          return;
        }

        const ping = allPings.find((p) => p.id === pingId);
        if (ping) {
          ping.resolved = true;
          ping.resolved_at = new Date().toISOString();
        }
        render();
      });
    }
  }

  showResolvedCheckbox.addEventListener('change', render);
  loadPings();
}
