import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'CI', 'FORCE_COLOR'];
const env = Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.TEST_SUPABASE_URL ?? 'http://127.0.0.1:54321';
env.VITE_SUPABASE_PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.TEST_SUPABASE_ANON_KEY ?? 'local-test-publishable-key';

const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
const forward = (signal) => vite.kill(signal);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
vite.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
