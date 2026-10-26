import { defineConfig, mergeConfig } from 'vite';
import { readFileSync } from 'node:fs';
import appConfig from '../vite.config.ts';
import { demoHtml, demoDeclaration, demoPublicKey, demoHeaders } from './isolation.ts';

// Ignore .env files and pin the target; a private application's ambient VITE_* values cannot redirect this build.
export default defineConfig(({ command, isPreview }) => {
  if (command === 'serve' && !isPreview) throw new Error('Build and preview the synthetic demo; development mode is not supported');
  let target;
  try { target = demoDeclaration(JSON.parse(readFileSync(process.env.DEMO_TARGET_FILE ?? 'demo/target.local.json', 'utf8'))); }
  catch { throw new Error('Invalid synthetic target declaration'); }
  return mergeConfig(appConfig, {
  envDir: false,
  publicDir: false,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(target.apiUrl),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(demoPublicKey(process.env.DEMO_PUBLISHABLE_KEY, target.projectRef)),
  },
  plugins: [{ name: 'synthetic-demo-label', transformIndexHtml: (html) => demoHtml(html, target.apiUrl),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: demoHeaders(target.apiUrl) });
      this.emitFile({ type: 'asset', fileName: '_redirects', source: readFileSync('public/_redirects', 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'demo-target.json', source: JSON.stringify({ classification: target.classification, apiUrl: target.apiUrl, appOrigin: target.appOrigin }) });
    },
  }],
  build: { outDir: '.cache/demo-dist' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  });
});
