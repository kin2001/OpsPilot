import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../vite.config.ts';
import { demoHtml, demoTarget, demoPublicKey } from './isolation.ts';

// Ignore .env files and pin the target; a private application's ambient VITE_* values cannot redirect this build.
export default defineConfig(({ command, isPreview }) => {
  if (command === 'serve' && !isPreview) throw new Error('Build and preview the synthetic demo; development mode is not supported');
  return mergeConfig(appConfig, {
  envDir: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(demoTarget('http://127.0.0.1:54321')),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(demoPublicKey(process.env.DEMO_PUBLISHABLE_KEY)),
  },
  plugins: [{ name: 'synthetic-demo-label', transformIndexHtml: demoHtml }],
  build: { outDir: '.cache/demo-dist' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
});
