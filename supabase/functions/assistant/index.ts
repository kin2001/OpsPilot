import { handleAssistant } from './handler.ts';
Deno.serve((request: Request) => handleAssistant(request, {
  apiUrl: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  appOrigin: Deno.env.get('APP_ORIGIN') ?? '',
  enabled: Deno.env.get('ASSISTANT_ENABLED') === 'true',
  syntheticEnvironment: Deno.env.get('ASSISTANT_SYNTHETIC_ENVIRONMENT') === 'true',
  providerKey: Deno.env.get('ASSISTANT_PROVIDER_KEY') ?? '',
  model: Deno.env.get('ASSISTANT_MODEL') ?? ''
}));
