export function createMediaExport({ render }) {
  let generation = 0, asset = null;

  return {
    get asset() { return asset; },
    invalidate() { generation++; asset = null; },
    async prepare(input) {
      const request = ++generation;
      asset = null;
      try {
        const size = input.size;
        const canvas = await render(input);
        if (request !== generation) return null;
        const blob = await new Promise((resolve, reject) => {
          try { canvas.toBlob(resolve, 'image/png'); }
          catch (error) { reject(error); }
        });
        if (request !== generation) return null;
        if (!blob) throw new Error('Could not encode the PNG image. Please try again.');
        const file = new File([blob], size === 'phone' ? 'olympics-phone-story.png' : 'olympics-full-poster.png', { type: 'image/png' });
        asset = { canvas, file, size };
        return asset;
      } catch (error) {
        if (request !== generation) return null;
        throw error;
      }
    }
  };
}

export function createMediaShare({ navigator = globalThis.navigator } = {}) {
  let busy = false;

  function canShare(file) {
    if (!file) return false;
    try {
      return Boolean(file.type === 'image/png' && typeof navigator?.share === 'function' && typeof navigator?.canShare === 'function' && navigator.canShare({ files: [file] }));
    } catch { return false; }
  }

  async function share(file) {
    if (!file) return 'unavailable';
    if (busy) return 'busy';
    busy = true;
    try {
      if (!canShare(file)) return 'unsupported';
      try {
        // Invoke before yielding so the prepared file keeps the click's activation.
        const attempt = navigator.share({ files: [file], title: 'OLYMPICS' });
        await attempt;
        return 'shared';
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled';
        if (error?.name === 'InvalidStateError') return 'busy';
        return 'failed';
      }
    } finally { busy = false; }
  }

  return { share, canShare };
}

export function posterSizeFromSearch(search) {
  if (typeof search !== 'string') return null;
  const size = new URLSearchParams(search).get('poster');
  return size === 'full' ? 'poster' : size === 'phone' ? 'phone' : null;
}
