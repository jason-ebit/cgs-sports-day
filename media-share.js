import { VIEWING_URL } from './share-link.js?v=41';

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
  let busy = false, imageUnsupported = false;

  function canShare(file) {
    if (!file) return false;
    try {
      return Boolean(!imageUnsupported && file.type === 'image/png' && typeof navigator?.share === 'function' && typeof navigator?.canShare === 'function' && navigator.canShare({ files: [file] }));
    } catch { return false; }
  }

  function mode(file, size) {
    if (!file) return 'unavailable';
    try {
      if (file.type !== 'image/png') return 'unsupported';
      if (canShare(file)) return 'image';
      if ((size !== 'poster' && size !== 'phone') || typeof navigator?.share !== 'function') return 'unsupported';
      if (typeof navigator.canShare === 'function' && !navigator.canShare({ url: posterURL(size) })) return 'unsupported';
      return 'link';
    } catch { return 'unsupported'; }
  }

  async function share(file, size) {
    if (!file) return 'unavailable';
    if (busy) return 'busy';
    busy = true;
    try {
      const selected = mode(file, size);
      if (selected !== 'image' && selected !== 'link') return selected;
      try {
        // Invoke before yielding so the prepared file keeps the click's activation.
        const payload = selected === 'image' ? { files: [file], title: 'OLYMPICS' } : { url: posterURL(size), title: 'OLYMPICS' };
        const attempt = navigator.share(payload);
        await attempt;
        return selected === 'image' ? 'shared' : 'shared-link';
      } catch (error) {
        if (error?.name === 'AbortError') return 'cancelled';
        if (error?.name === 'InvalidStateError') return 'busy';
        if (selected === 'image' && error?.name === 'TypeError') {
          imageUnsupported = true;
          // A new click must supply activation for the URL share attempt.
          if (mode(file, size) === 'link') return 'link-ready';
        }
        return 'failed';
      }
    } finally { busy = false; }
  }

  return { share, canShare, mode };
}

export function posterURL(size) {
  if (size !== 'poster' && size !== 'phone') throw new TypeError('Choose a full poster or phone story.');
  const url = new URL(VIEWING_URL);
  url.search = new URLSearchParams({ poster: size === 'poster' ? 'full' : 'phone' }).toString();
  return url.href;
}

export function posterSizeFromSearch(search) {
  if (typeof search !== 'string') return null;
  const size = new URLSearchParams(search).get('poster');
  return size === 'full' ? 'poster' : size === 'phone' ? 'phone' : null;
}
