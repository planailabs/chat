import ApexCharts from 'apexcharts';
import type { Stats } from '../chat/api';

let activityChart: ApexCharts | null = null;
let usersChart: ApexCharts | null = null;
let tokensChart: ApexCharts | null = null;

const axisLabels = { style: { colors: '#aaa' } };

const grid = {
  borderColor: '#333',
  strokeDashArray: 4,
  padding: { left: 10, right: 10, bottom: 20 },
};

const formatTokens = (val: number) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(val));

const hourlyArea = (yTitle: string, formatter?: (val: number) => string) => ({
  chart: {
    type: 'area',
    height: '100%',
    toolbar: { show: false },
    background: 'transparent',
    animations: { enabled: false },
    zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    pan: { enabled: true, mode: 'x' },
  },
  theme: { mode: 'dark' },
  stroke: { curve: 'smooth', width: 2 },
  dataLabels: { enabled: false },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.1, stops: [0, 90, 100] },
  },
  xaxis: {
    type: 'datetime',
    labels: { ...axisLabels, datetimeUTC: false },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: formatter ? { ...axisLabels, formatter } : axisLabels,
    title: { text: yTitle, style: { color: '#aaa' } },
  },
  grid,
  legend: { position: 'top', labels: { colors: '#aaa' } },
  tooltip: { x: { format: 'MMM dd HH:00' } },
});

const mount = (selector: string, options: object): ApexCharts | null => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  el.innerHTML = '';
  const chart = new ApexCharts(el, options);
  void chart.render();
  return chart;
};

export const initCharts = () => {
  activityChart = mount('#chart-activity', {
    ...hourlyArea('Messages'),
    series: [],
    colors: ['#00E5FF'],
  });

  usersChart = mount('#chart-users', {
    series: [],
    chart: {
      type: 'bar',
      stacked: true,
      height: '100%',
      toolbar: { show: false },
      background: 'transparent',
      animations: { enabled: false },
    },
    theme: { mode: 'dark' },
    plotOptions: { bar: { borderRadius: 4, horizontal: true } },
    dataLabels: { enabled: false },
    xaxis: {
      categories: [],
      labels: { ...axisLabels, formatter: (val: string) => formatTokens(Number(val)) },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: { labels: axisLabels },
    grid: { ...grid, xaxis: { lines: { show: true } } },
    legend: { position: 'top', labels: { colors: '#aaa' } },
    colors: ['#00E5FF', '#FF6B6B'],
  });

  tokensChart = mount('#chart-tokens', {
    ...hourlyArea('Tokens', formatTokens),
    series: [],
    colors: ['#00E5FF', '#FF6B6B', '#A78BFA'],
  });
};

const points = <T extends { hour: string }>(rows: T[], value: (row: T) => number) =>
  rows.map((row) => ({ x: new Date(row.hour).getTime(), y: value(row) }));

export const updateCharts = (stats: Stats) => {
  activityChart?.updateSeries([{ name: 'User messages', data: points(stats.activity, (r) => r.messages) }]);

  if (usersChart) {
    void usersChart.updateOptions({ xaxis: { categories: stats.top_users.map((u) => u.email) } });
    void usersChart.updateSeries([
      { name: 'Input tokens', data: stats.top_users.map((u) => u.input) },
      { name: 'Output tokens', data: stats.top_users.map((u) => u.output) },
    ]);
  }

  tokensChart?.updateSeries([
    { name: 'Input tokens', data: points(stats.tokens, (r) => r.input) },
    { name: 'Output tokens', data: points(stats.tokens, (r) => r.output) },
    { name: 'Cached input tokens', data: points(stats.tokens, (r) => r.cached) },
  ]);
};

export const resetActivityZoom = () => {
  activityChart?.resetSeries();
};
