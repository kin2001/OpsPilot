export function demoTarget(value: string) {
  if (value !== 'http://127.0.0.1:54321') throw new Error('Demo requires the exact isolated loopback endpoint');
  return value;
}

export function demoPublicKey(value: string | undefined, projectRef: string | null = null) {
  try {
    if (!value || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const payload = JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8'));
    if (payload.role !== 'anon' || (projectRef ? payload.iss !== 'supabase' || payload.ref !== projectRef : payload.iss !== 'supabase-demo' || payload.ref)) throw new Error();
    return value;
  } catch {
    // Decode only to reject privileged/hosted configuration; the local Auth service verifies the signature.
    throw new Error('Use only the declared synthetic target ANON_KEY');
  }
}

export function demoDeclaration(value: unknown) {
  try {
    const target = value as { classification: string; apiUrl: string; appOrigin: string };
    if (Object.keys(target).sort().join(',') !== 'apiUrl,appOrigin,classification' || target.classification !== 'synthetic-only') throw new Error();
    const api = new URL(target.apiUrl); const app = new URL(target.appOrigin);
    if (api.origin !== target.apiUrl || app.origin !== target.appOrigin) throw new Error();
    const local = target.apiUrl === 'http://127.0.0.1:54321' && target.appOrigin === 'http://127.0.0.1:5173';
    const ref = api.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
    if (!local && (!ref || api.protocol !== 'https:' || api.port || app.protocol !== 'https:' || app.port || app.hostname.endsWith('.invalid'))) throw new Error();
    return { ...target, projectRef: local ? null : ref! };
  } catch {
    throw new Error('Invalid synthetic target declaration');
  }
}

export function demoPolicy(apiUrl: string) {
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${apiUrl}; form-action 'self'; base-uri 'none'; object-src 'none'`;
}

export function demoHeaders(apiUrl: string) {
  return `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cache-Control: private, no-store\n  Content-Security-Policy: ${demoPolicy(apiUrl)}; frame-ancestors 'none'\n`;
}

export function demoHtml(html: string, apiUrl = 'http://127.0.0.1:54321') {
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${demoPolicy(apiUrl)}">`)
    .replace('<body>', '<body><aside role="note" style="padding:12px;background:#fff3cd;color:#332701;text-align:center">SYNTHETIC DEMO — invented records only. AI disabled. No private data, operational use, or safety approval. Local sessions and changes persist until the isolated demo is reset.</aside>');
}
