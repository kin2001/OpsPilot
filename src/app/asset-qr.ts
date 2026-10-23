import qrcode from 'qrcode-generator';

const assetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assetRecordQr(assetId: string, origin: string) {
  if (!assetUuid.test(assetId)) throw new Error('VALIDATION');
  const target = new URL(`/assets?asset=${encodeURIComponent(assetId)}`, origin);
  const qr = qrcode(0, 'M');
  qr.addData(target.href, 'Byte');
  qr.make();
  return { href: target.href, src: qr.createDataURL(6, 12) };
}
