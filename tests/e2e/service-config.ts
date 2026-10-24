export type IsolatedServiceConfig = { url: string; anon: string; service: string };

export function readIsolatedServiceConfig(environment: NodeJS.ProcessEnv): IsolatedServiceConfig | null {
  const names = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_KEY'] as const;
  const allAbsent = names.every((name) => environment[name] === undefined);
  if (allAbsent) {
    if (environment.CI) throw new Error('CI requires complete loopback-only service configuration for browser journeys.');
    return null;
  }

  const [url, anon, service] = names.map((name) => environment[name]);
  let parsed: URL;
  try {
    if (!url || !anon?.trim() || !service?.trim() || /[\r\n]/.test(anon) || /[\r\n]/.test(service)) throw new Error();
    parsed = new URL(url);
  } catch {
    throw new Error('Service browser journeys require complete loopback-only configuration.');
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Service browser journeys require complete loopback-only configuration.');
  }
  return { url, anon, service };
}
