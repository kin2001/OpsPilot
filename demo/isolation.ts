export function demoTarget(value: string) {
  if (value !== 'http://127.0.0.1:54321') throw new Error('Demo requires the exact isolated loopback endpoint');
  return value;
}

export function demoPublicKey(value: string | undefined) {
  try {
    if (!value || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const payload = JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString('utf8'));
    if (payload.iss !== 'supabase-demo' || payload.role !== 'anon' || payload.ref) throw new Error();
    return value;
  } catch {
    // Decode only to reject privileged/hosted configuration; the local Auth service verifies the signature.
    throw new Error('Use only the newly generated local instance ANON_KEY');
  }
}

export function demoHtml(html: string) {
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src http://127.0.0.1:54321 ws://127.0.0.1:5173; form-action 'self'; base-uri 'none'; object-src 'none'">`)
    .replace('<body>', '<body><aside role="note" style="padding:12px;background:#fff3cd;color:#332701;text-align:center">SYNTHETIC DEMO — invented records only. AI disabled. No private data, operational use, or safety approval. Local sessions and changes persist until the isolated demo is reset.</aside>');
}
