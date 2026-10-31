// Tests only: vitest compiles the Vue components itself (Parcel builds the app).
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
