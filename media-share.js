import { VIEWING_URL } from './share-link.js?v=38';

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

export function createMediaShare({ navigator = globalThis.navigator, ClipboardItem = globalThis.ClipboardItem } = {}) {
  let busy = false;

  function canShare(file) {
    if (!file) return false;
    try {
      return Boolean(typeof navigator?.share === 'function' && typeof navigator?.canShare === 'function' && navigator.canShare({ files: [file] }));
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

  function canCopyImage(file) {
    try {
      return Boolean(file?.type === 'image/png' && typeof ClipboardItem === 'function' &&
        typeof navigator?.clipboard?.write === 'function' &&
        (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png')));
    } catch { return false; }
  }

  async function copyImage(file) {
    if (!canCopyImage(file)) return 'unsupported';
    try {
      const item = new ClipboardItem({ 'image/png': file });
      const attempt = navigator.clipboard.write([item]);
      await attempt;
      return 'copied';
    } catch { return 'failed'; }
  }

  return { share, canShare, copyImage, canCopyImage };
}

export function posterShareTargets(size) {
  if (size !== 'poster' && size !== 'phone') throw new TypeError('Choose a full poster or phone story.');
  const poster = new URL(VIEWING_URL);
  poster.search = new URLSearchParams({ poster: size === 'poster' ? 'full' : 'phone' }).toString();
  const whatsapp = new URL('https://wa.me/');
  whatsapp.search = new URLSearchParams({ text: 'OLYMPICS · Oct 25\n' + poster.href }).toString();
  const x = new URL('https://twitter.com/intent/tweet');
  x.search = new URLSearchParams({ text: 'OLYMPICS · Oct 25', url: poster.href }).toString();
  return { poster: poster.href, whatsapp: whatsapp.href, x: x.href, instagram: 'https://www.instagram.com/' };
}

export function posterSizeFromSearch(search) {
  if (typeof search !== 'string') return null;
  const size = new URLSearchParams(search).get('poster');
  return size === 'full' ? 'poster' : size === 'phone' ? 'phone' : null;
}
