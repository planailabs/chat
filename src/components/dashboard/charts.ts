import ApexCharts from 'apexcharts';
import type { Message, Profile } from './app';

let activityChart: ApexCharts | null = null;
let usersChart: ApexCharts | null = null;

export type ChartData = {
  messages: Message[];
  profiles: Profile[];
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
};

export const updateCharts = (data: ChartData) => {
  if (!activityChart || !usersChart) return;

  const { messages } = data; // profiles not needed for these simple stats yet

  // --- Aggregation for Activity (Prompts per day/hour) ---
  // Group by hour for last 24h, or day for last 30 days.
  // For simplicity v1: Group by Day
  const activityMap = new Map<string, number>();

  messages.forEach((msg) => {
    const date = new Date(msg.created_at).toISOString().split('T')[0]; // YYYY-MM-DD
    activityMap.set(date, (activityMap.get(date) || 0) + 1);
  });

  // Sort logic
  const activitySeries = Array.from(activityMap.entries())
    .map(([date, count]) => ({ x: date, y: count }))
    .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());

  activityChart.updateSeries([{ data: activitySeries }]);

  // --- Aggregation for Top Users ---
  const userCounts = new Map<string, number>();
  // Make sure we have user identifiers.
  // Join logic happens in main app, so messages might have user_id, or joined profile?
  // Assuming messages have user_id.
  messages.forEach((msg) => {
    const uid = msg.user_id;
    if (uid) userCounts.set(uid, (userCounts.get(uid) || 0) + 1);
  });

  const sortedUsers = Array.from(userCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10); // Top 10

  // Map UUIDs to Names/Emails if available in profiles?
  // We need profiles map.
  const profilesMap = new Map();
  data.profiles.forEach((p) => profilesMap.set(p.user_id, p));

  const userCategories = sortedUsers.map(([uid]) => {
    const p = profilesMap.get(uid);
    // Fallback or use email
    if (p?.provider_identity?.identity_data?.email)
      return p.provider_identity.identity_data.email;
    if (p?.provider_identity?.email) return p.provider_identity.email;
    return uid.slice(0, 8) + '...';
  });

  // unused: const userSeriesData = sortedUsers.map(([uid, count]) => count);

  usersChart.updateOptions({
    xaxis: { categories: userCategories }, // Bar chart uses categories on axis
  });
  usersChart.updateSeries([
    {
      data: sortedUsers.map(([, count], i) => ({
        x: userCategories[i],
        y: count,
      })),
    },
  ]);
};

export const resetActivityZoom = () => {
  if (activityChart) {
    activityChart.resetSeries();
  }
};
