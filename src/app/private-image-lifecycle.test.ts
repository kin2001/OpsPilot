import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrivateImageLifecycle } from './private-image-lifecycle';

afterEach(() => vi.restoreAllMocks());

describe('private image URL lifetime', () => {
  it('does not create an object URL when a download resolves after context cleanup', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-image');
    const lifecycle = createPrivateImageLifecycle();

    lifecycle.dispose();
    expect(lifecycle.createSource(new Blob(['private']))).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes every created URL exactly once when the image context is replaced', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const lifecycle = createPrivateImageLifecycle();

    expect(lifecycle.createSource(new Blob(['first']))).toBe('blob:first');
    expect(lifecycle.createSource(new Blob(['second']))).toBe('blob:second');
    lifecycle.dispose();
    lifecycle.dispose();
    expect(revoke.mock.calls).toEqual([['blob:first'], ['blob:second']]);
  });
});
