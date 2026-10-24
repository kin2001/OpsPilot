import { expect, it } from 'vitest';
import { handleInvitation } from '../../supabase/functions/organization-invite/handler';

const config = { apiUrl: 'http://127.0.0.1:54321', publishableKey: 'synthetic', appOrigin: 'http://127.0.0.1:5173', emailEnabled: false };
const input = { ctx: { organization_id: 'a9be90aa-204c-48c9-9655-9dbe91c6e911', request_id: 'a9be90aa-204c-48c9-9655-9dbe91c6e911' }, email: 'recipient@example.test', role: 'technician' };
function request(body: unknown, origin = config.appOrigin) {
  return new Request('http://127.0.0.1/invite', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic', origin }, body: JSON.stringify(body) });
}
it('fails closed before any remote operation when email transport is not enabled', async () => {
  const response = await handleInvitation(request(input), config);
  expect(response.status).toBe(503);
  expect((await response.json()).code).toBe('DEPENDENCY_UNAVAILABLE');
});
it('rejects caller redirect, owner grants, cross-origin requests and oversized input', async () => {
  expect((await handleInvitation(request({ ...input, redirectTo: 'https://evil.example' }), config)).status).toBe(422);
  expect((await handleInvitation(request({ ...input, role: 'owner' }), config)).status).toBe(422);
  expect((await handleInvitation(request(input, 'https://evil.example'), config)).status).toBe(403);
  expect((await handleInvitation(request({ ...input, email: 'a'.repeat(9000) }), config)).status).toBe(422);
});
