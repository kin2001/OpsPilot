import { handleAttachment } from './handler.ts';
Deno.serve((request: Request) => handleAttachment(request, {
  apiUrl: Deno.env.get('SUPABASE_URL') ?? '', publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', appOrigin: Deno.env.get('APP_ORIGIN') ?? '',
}));
