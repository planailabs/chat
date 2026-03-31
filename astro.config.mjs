import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import compress from 'astro-compress';
import node from '@astrojs/node';

export default defineConfig({
  adapter: node({ mode: 'standalone' }),
  vite: {
    envPrefix: ['VITE_', 'PUBLIC_'],
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  },
  integrations: [
    compress({
      CSS: true,
      HTML: {
        'html-minifier-terser': {
          removeComments: true,
          removeAttributeQuotes: false,
          collapseWhitespace: true,
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          minifyJS: true,
          minifyCSS: true,
        },
      },
      Image: false,
      JavaScript: true,
      SVG: true,
    }),
  ],
  devToolbar: {
    enabled: false,
  },
  trailingSlash: 'always',
});
