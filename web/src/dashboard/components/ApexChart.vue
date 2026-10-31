<script setup lang="ts">
/** An ApexCharts chart: created with `options`, updated with `series` (and `update` options). */
import ApexCharts from 'apexcharts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

type Series = Parameters<ApexCharts['updateSeries']>[0];

const props = defineProps<{ options: object; series: Series; update?: object }>();

const el = ref<HTMLElement | null>(null);
let chart: ApexCharts | null = null;

onMounted(() => {
  if (!el.value) return;
  chart = new ApexCharts(el.value, { ...props.options, series: props.series, ...(props.update ?? {}) });
  void chart.render();
});

watch(
  () => [props.series, props.update] as const,
  ([series, update]) => {
    if (!chart) return;
    if (update) void chart.updateOptions(update, false, false);
    void chart.updateSeries(series);
  },
);

onBeforeUnmount(() => {
  chart?.destroy();
  chart = null;
});

defineExpose({ resetZoom: () => chart?.resetSeries() });
</script>

<template>
  <div ref="el" class="relative h-full w-full flex-1" />
</template>
