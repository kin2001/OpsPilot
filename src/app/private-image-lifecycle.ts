export function createPrivateImageLifecycle() {
  let active = true;
  const sources = new Set<string>();
  return {
    createSource(blob: Blob) {
      if (!active) return null;
      const source = URL.createObjectURL(blob);
      sources.add(source);
      return source;
    },
    dispose() {
      if (!active) return;
      active = false;
      for (const source of sources) URL.revokeObjectURL(source);
      sources.clear();
    },
  };
}
