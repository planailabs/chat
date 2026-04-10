import ApexCharts from 'apexcharts';
import type { Message, Profile } from './app';

let activityChart: ApexCharts | null = null;
let usersChart: ApexCharts | null = null;
let tokenInputChart: ApexCharts | null = null;
let tokenOutputChart: ApexCharts | null = null;
let tokenTotalChart: ApexCharts | null = null;
let messageCountChart: ApexCharts | null = null;

export type TokenUsage = {
  id: number;
  user_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  created_at: string;
};

export type ChartData = {
  messages: Message[];
  profiles: Profile[];
  tokenUsage?: TokenUsage[];
};

export const initCharts = () => {
  // 1. Activity Chart (Prompts over time)
  const activityOptions = {
    series: [{ name: 'Prompts', data: [] }],
    chart: {
      type: 'area',
      toolbar: {
        show: false,
      },
      background: 'transparent',
      animations: { enabled: false },
      zoom: {
        enabled: true,
        type: 'x',
        autoScaleYaxis: true,
      },
      pan: {
        enabled: true,
        mode: 'x',
      },
    },
    theme: { mode: 'dark' }, // Force dark mode for now as per dashboard styling
    stroke: { curve: 'smooth', width: 2 },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#aaa' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#aaa' } },
    },
    grid: {
      borderColor: '#333',
      strokeDashArray: 4,
      padding: {
        left: 10,
        right: 10,
        bottom: 20, // Ensure space for x-axis labels
      },
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.7,
        opacityTo: 0.2,
        stops: [0, 90, 100],
      },
    },
    colors: ['#00E5FF'], // Cyan/Blueish to match theme
  };

  const activityEl = document.querySelector('#chart-activity');
  if (activityEl) {
    activityEl.innerHTML = '';
    activityChart = new ApexCharts(activityEl, activityOptions);
    activityChart.render();
  }

  // 2. Top Users Chart (Bar)
  const usersOptions = {
    series: [{ data: [] }],
    chart: {
      type: 'bar',
      height: '100%',
      toolbar: { show: false },
      background: 'transparent',
      animations: { enabled: false },
    },
    theme: { mode: 'dark' },
    plotOptions: {
      bar: {
        borderRadius: 4,
        horizontal: true,
      },
    },
    dataLabels: { enabled: false },
    xaxis: {
      labels: { style: { colors: '#aaa' } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#aaa' } },
    },
    grid: {
      borderColor: '#333',
      strokeDashArray: 4,
      xaxis: { lines: { show: true } },
      padding: {
        left: 10,
        right: 10,
        bottom: 20, // Align with Activity chart
      },
    },
    colors: ['#00E5FF'],
  };

  const usersEl = document.querySelector('#chart-users');
  if (usersEl) {
    usersEl.innerHTML = '';
    usersChart = new ApexCharts(usersEl, usersOptions);
    usersChart.render();
  }

  // 3 & 4. Token Input / Output per User (two separate stacked bars, hourly)
  const tokenChartBase = {
    series: [] as any[],
    chart: {
      type: 'bar' as const,
      stacked: true,
      height: '100%',
      toolbar: { show: false },
      background: 'transparent',
      animations: { enabled: false },
      zoom: { enabled: true, type: 'x' as const, autoScaleYaxis: true },
    },
    theme: { mode: 'dark' as const },
    plotOptions: { bar: { borderRadius: 2, columnWidth: '80%' } },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime' as const,
      labels: { style: { colors: '#aaa' }, datetimeUTC: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: '#aaa' },
        formatter: (val: number) => val >= 1000 ? (val / 1000).toFixed(0) + 'k' : String(val),
      },
      title: { text: 'Tokens', style: { color: '#aaa' } },
    },
    grid: {
      borderColor: '#333',
      strokeDashArray: 4,
      padding: { left: 10, right: 10, bottom: 20 },
    },
    legend: { position: 'top' as const, labels: { colors: '#aaa' } },
    tooltip: { x: { format: 'MMM dd HH:00' } },
  };

  const tokenInputEl = document.querySelector('#chart-token-input');
  if (tokenInputEl) {
    tokenInputEl.innerHTML = '';
    tokenInputChart = new ApexCharts(tokenInputEl, { ...tokenChartBase });
    tokenInputChart.render();
  }

  const tokenOutputEl = document.querySelector('#chart-token-output');
  if (tokenOutputEl) {
    tokenOutputEl.innerHTML = '';
    tokenOutputChart = new ApexCharts(tokenOutputEl, { ...tokenChartBase });
    tokenOutputChart.render();
  }

  const tokenTotalEl = document.querySelector('#chart-token-total');
  if (tokenTotalEl) {
    tokenTotalEl.innerHTML = '';
    tokenTotalChart = new ApexCharts(tokenTotalEl, { ...tokenChartBase });
    tokenTotalChart.render();
  }

  // 5. Message Count per User (stacked bar, hourly, role=user only)
  const messageCountOptions = {
    series: [],
    chart: {
      type: 'bar',
      stacked: true,
      height: '100%',
      toolbar: { show: false },
      background: 'transparent',
      animations: { enabled: false },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    },
    theme: { mode: 'dark' },
    plotOptions: { bar: { borderRadius: 2, columnWidth: '80%' } },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'datetime',
      labels: { style: { colors: '#aaa' }, datetimeUTC: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: { style: { colors: '#aaa' } },
      title: { text: 'Messages', style: { color: '#aaa' } },
    },
    grid: {
      borderColor: '#333',
      strokeDashArray: 4,
      padding: { left: 10, right: 10, bottom: 20 },
    },
    legend: { position: 'top', labels: { colors: '#aaa' } },
    tooltip: { x: { format: 'MMM dd HH:00' } },
  };

  const messageCountEl = document.querySelector('#chart-message-count');
  if (messageCountEl) {
    messageCountEl.innerHTML = '';
    messageCountChart = new ApexCharts(messageCountEl, messageCountOptions);
    messageCountChart.render();
  }
};

/** Resolve a user ID to a short display label. */
function resolveUserLabel(uid: string, profilesMap: Map<string, Profile>): string {
  const p = profilesMap.get(uid);
  if (p?.provider_identity?.identity_data?.email)
    return p.provider_identity.identity_data.email;
  if (p?.provider_identity?.email) return p.provider_identity.email;
  return uid.slice(0, 8) + '...';
}

/** Floor a Date to the start of its hour (local time). */
function floorToHour(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
}

export const updateCharts = (data: ChartData) => {
  if (!activityChart || !usersChart) return;

  const { messages } = data;

  const profilesMap = new Map<string, Profile>();
  data.profiles.forEach((p) => profilesMap.set(p.user_id, p));

  // --- Aggregation for Activity (Prompts per day) ---
  const activityMap = new Map<string, number>();

  messages.forEach((msg) => {
    const date = new Date(msg.created_at).toISOString().split('T')[0];
    activityMap.set(date, (activityMap.get(date) || 0) + 1);
  });

  const activitySeries = Array.from(activityMap.entries())
    .map(([date, count]) => ({ x: date, y: count }))
    .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());

  activityChart.updateSeries([{ data: activitySeries }]);

  // --- Aggregation for Top Users ---
  const userCounts = new Map<string, number>();
  messages.forEach((msg) => {
    const uid = msg.user_id;
    if (uid) userCounts.set(uid, (userCounts.get(uid) || 0) + 1);
  });

  const sortedUsers = Array.from(userCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const userCategories = sortedUsers.map(([uid]) => resolveUserLabel(uid, profilesMap));

  usersChart.updateOptions({
    xaxis: { categories: userCategories },
  });
  usersChart.updateSeries([
    {
      data: sortedUsers.map(([, count], i) => ({
        x: userCategories[i],
        y: count,
      })),
    },
  ]);

  // --- Token Usage per User (two separate hourly stacked bars: input & output) ---
  if ((tokenInputChart || tokenOutputChart) && data.tokenUsage?.length) {
    const userHourInput = new Map<string, Map<number, number>>();
    const userHourOutput = new Map<string, Map<number, number>>();
    const allHours = new Set<number>();
    const userTotalTokens = new Map<string, number>();

    for (const row of data.tokenUsage) {
      const hour = floorToHour(new Date(row.created_at));
      allHours.add(hour);
      const input = row.input_tokens + row.cache_creation_input_tokens + row.cache_read_input_tokens;

      if (!userHourInput.has(row.user_id)) userHourInput.set(row.user_id, new Map());
      if (!userHourOutput.has(row.user_id)) userHourOutput.set(row.user_id, new Map());

      userHourInput.get(row.user_id)!.set(hour, (userHourInput.get(row.user_id)!.get(hour) || 0) + input);
      userHourOutput.get(row.user_id)!.set(hour, (userHourOutput.get(row.user_id)!.get(hour) || 0) + row.output_tokens);
      userTotalTokens.set(row.user_id, (userTotalTokens.get(row.user_id) || 0) + input + row.output_tokens);
    }

    const topUsers = Array.from(userTotalTokens.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([uid]) => uid);

    const sortedHours = Array.from(allHours).sort((a, b) => a - b);

    if (tokenInputChart) {
      tokenInputChart.updateSeries(topUsers.map((uid) => ({
        name: resolveUserLabel(uid, profilesMap),
        data: sortedHours.map((h) => ({ x: h, y: userHourInput.get(uid)?.get(h) || 0 })),
      })));
    }

    if (tokenOutputChart) {
      tokenOutputChart.updateSeries(topUsers.map((uid) => ({
        name: resolveUserLabel(uid, profilesMap),
        data: sortedHours.map((h) => ({ x: h, y: userHourOutput.get(uid)?.get(h) || 0 })),
      })));
    }

    if (tokenTotalChart) {
      tokenTotalChart.updateSeries(topUsers.map((uid) => ({
        name: resolveUserLabel(uid, profilesMap),
        data: sortedHours.map((h) => ({
          x: h,
          y: (userHourInput.get(uid)?.get(h) || 0) + (userHourOutput.get(uid)?.get(h) || 0),
        })),
      })));
    }
  }

  // --- Message Count per User (hourly stacked bar, role=user only) ---
  if (messageCountChart) {
    const userMessages = messages.filter((m) => m.role === 'user');
    const userHourMsgs = new Map<string, Map<number, number>>();
    const allMsgHours = new Set<number>();

    for (const msg of userMessages) {
      const hour = floorToHour(new Date(msg.created_at));
      allMsgHours.add(hour);
      let hourMap = userHourMsgs.get(msg.user_id);
      if (!hourMap) {
        hourMap = new Map();
        userHourMsgs.set(msg.user_id, hourMap);
      }
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    }

    // Top users by message count
    const msgUserTotals = Array.from(userHourMsgs.entries())
      .map(([uid, hm]) => ({ uid, total: Array.from(hm.values()).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const sortedMsgHours = Array.from(allMsgHours).sort((a, b) => a - b);

    const msgSeries = msgUserTotals.map(({ uid }) => ({
      name: resolveUserLabel(uid, profilesMap),
      data: sortedMsgHours.map((h) => ({ x: h, y: userHourMsgs.get(uid)?.get(h) || 0 })),
    }));

    messageCountChart.updateSeries(msgSeries);
  }
};

export const resetActivityZoom = () => {
  if (activityChart) {
    activityChart.resetSeries();
  }
};
