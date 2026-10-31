import { getSupabaseClientOrThrow } from '../chat/supabase/client';
import { initCharts, updateCharts } from './charts';
import type { TokenUsage } from './charts';
import type { Message, Profile } from './app';

export async function initOverview(container: HTMLElement) {
  const supabase = getSupabaseClientOrThrow();

  // Fetch stats in parallel
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    { count: totalMessages },
    { count: todayMessages },
    todayUsersResult,
    { count: unresolvedPings },
    { count: usersWithTokens },
  ] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true }),
    supabase.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    supabase.from('messages').select('user_id', { count: 'exact', head: false }).gte('created_at', todayStart.toISOString()),
    supabase.from('staff_pings').select('*', { count: 'exact', head: true }).eq('resolved', false),
    supabase.from('profiles').select('*', { count: 'exact', head: true }).not('customer_token', 'is', null),
  ]);

  // Count distinct users today
  const distinctUsersToday = todayUsersResult.data
    ? new Set(todayUsersResult.data.map((r: any) => r.user_id)).size
    : 0;

  // Render stat cards
  const statsGrid = container.querySelector('.stats-grid') as HTMLElement;
  const stats = [
    { label: 'Messages Today', value: todayMessages ?? 0 },
    { label: 'Total Messages', value: totalMessages ?? 0 },
    { label: 'Active Users Today', value: distinctUsersToday },
    { label: 'Unresolved Pings', value: unresolvedPings ?? 0 },
    { label: 'Users with Tokens', value: usersWithTokens ?? 0 },
  ];

  statsGrid.innerHTML = stats
    .map(
      (s) => `
      <div class="p-4 rounded-xl border border-white/10 bg-white/5 shadow-sm hover:border-white/20 transition-colors">
        <div class="text-xs opacity-50 mb-1">${s.label}</div>
        <div class="text-2xl font-bold tracking-tight">${s.value.toLocaleString()}</div>
      </div>
    `,
    )
    .join('');

  // Init charts
  initCharts();

  // Fetch recent messages and token usage for chart data
  const [{ data: msgs }, { data: tokenRows }] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('chat_token_usage')
      .select('id, user_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, created_at')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  if (msgs) {
    const messages = msgs as Message[];
    const tokenUsage = (tokenRows ?? []) as TokenUsage[];

    // Collect all user IDs from both messages and token usage
    const userIds = [...new Set([
      ...messages.map((m) => m.user_id),
      ...tokenUsage.map((t) => t.user_id),
    ])];
    let profiles: Profile[] = [];

    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);
      profiles = (profs ?? []) as Profile[];
    }

    updateCharts({ messages, profiles, tokenUsage });
  }
}
