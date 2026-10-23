import { describe, expect, it } from 'vitest';
import { imageMetadataFor } from './private-attachments';

describe('private attachment input', () => {
  it('accepts only supported, bounded image metadata and keeps the original filename', () => {
    const image = new File([new Uint8Array([1, 2, 3])], 'pump.png', { type: 'image/png' });
    expect(imageMetadataFor(image)).toEqual({ name: 'pump.png', media_type: 'image/png', size: 3 });

    expect(() => imageMetadataFor(new File(['x'], '../pump.png', { type: 'image/png' }))).toThrow('VALIDATION');
    expect(() => imageMetadataFor(new File(['x'], 'pump.svg', { type: 'image/svg+xml' }))).toThrow('VALIDATION');
    expect(() => imageMetadataFor(new File(['x'.repeat(5 * 1024 * 1024 + 1)], 'pump.png', { type: 'image/png' }))).toThrow('VALIDATION');
  });
});
