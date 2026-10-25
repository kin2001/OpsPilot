import { handleReportExport } from './handler.ts';

Deno.serve((request: Request) => handleReportExport(request, {
  apiUrl: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  appOrigin: Deno.env.get('APP_ORIGIN') ?? '',
}));
