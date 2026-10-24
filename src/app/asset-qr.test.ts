import { describe, expect, it } from 'vitest';
import { assetRecordQr } from './asset-qr';

describe('private asset QR labels', () => {
  it('encodes only the same-origin authenticated asset route and identifier', () => {
    const assetId = '58fa243d-81dc-4fb2-8f9a-5314a333b932';
    const qr = assetRecordQr(assetId, 'https://ops.example.test');
    expect(new URL(qr.href).origin).toBe('https://ops.example.test');
    expect(new URL(qr.href).pathname).toBe('/assets');
    expect(new URL(qr.href).search).toBe(`?asset=${assetId}`);
    expect(qr.src).toMatch(/^data:image\/gif;base64,/);
    expect(() => assetRecordQr('not-a-uuid', 'https://ops.example.test')).toThrow('VALIDATION');
  });
});
