/** ApexCharts options of the overview's charts (dark theme, hourly series). */
import type { Stats } from '../chat/api';

const axisLabels = { style: { colors: '#aaa' } };

const grid = {
  borderColor: '#333',
  strokeDashArray: 4,
  padding: { left: 10, right: 10, bottom: 20 },
};

export const formatTokens = (val: number) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(val));

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

export const activityOptions = { ...hourlyArea('Messages'), colors: ['#00E5FF'] };

export const tokensOptions = { ...hourlyArea('Tokens', formatTokens), colors: ['#00E5FF', '#FF6B6B', '#A78BFA'] };

export const usersOptions = {
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
    categories: [] as string[],
    labels: { ...axisLabels, formatter: (val: string) => formatTokens(Number(val)) },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: { labels: axisLabels },
  grid: { ...grid, xaxis: { lines: { show: true } } },
  legend: { position: 'top', labels: { colors: '#aaa' } },
  colors: ['#00E5FF', '#FF6B6B'],
};

const points = <T extends { hour: string }>(rows: T[], value: (row: T) => number) =>
  rows.map((row) => ({ x: new Date(row.hour).getTime(), y: value(row) }));

/** The series (and the users chart's categories) from the stats. */
export const chartData = (stats: Stats) => ({
  activity: [{ name: 'User messages', data: points(stats.activity, (r) => r.messages) }],
  users: [
    { name: 'Input tokens', data: stats.top_users.map((u) => u.input) },
    { name: 'Output tokens', data: stats.top_users.map((u) => u.output) },
  ],
  userCategories: { xaxis: { categories: stats.top_users.map((u) => u.email) } },
  tokens: [
    { name: 'Input tokens', data: points(stats.tokens, (r) => r.input) },
    { name: 'Output tokens', data: points(stats.tokens, (r) => r.output) },
    { name: 'Cached input tokens', data: points(stats.tokens, (r) => r.cached) },
  ],
});
