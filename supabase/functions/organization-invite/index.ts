import { handleInvitation } from './handler.ts';

Deno.serve((request: Request) => handleInvitation(request, {
  apiUrl: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  appOrigin: Deno.env.get('APP_ORIGIN') ?? '',
  emailEnabled: Deno.env.get('INVITATION_EMAIL_ENABLED') === 'true',
}));
