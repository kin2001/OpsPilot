import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
export function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const character of secret.toUpperCase().replace(/=+$/, '')) {
    const digit = alphabet.indexOf(character); if (digit < 0) throw new Error('Invalid synthetic TOTP secret');
    bits += digit.toString(2).padStart(5, '0');
  }
  const key: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) key.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.from(key)).update(counter).digest(); const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export async function enrollMfa(client: SupabaseClient) {
  const factor = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Synthetic isolated verification' });
  if (factor.error || !factor.data) throw new Error('Synthetic native MFA enrollment failed');
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: factor.data.id, code: totp(factor.data.totp.secret) });
  if (verified.error) throw new Error('Synthetic native MFA verification failed');
  return { factorId: factor.data.id, secret: factor.data.totp.secret };
}
