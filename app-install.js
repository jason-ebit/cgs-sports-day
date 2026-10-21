export function createAppInstall({ window: target = globalThis.window, navigator = globalThis.navigator, onChange = () => {} } = {}) {
  let media = null, promptEvent = null, pending = false, confirmed = false;
  const used = new WeakSet();
  try { media = target?.matchMedia?.('(display-mode: standalone)') ?? null; }
  catch { /* Browsers without display-mode support use the manual guide. */ }

  const isInstalled = () => confirmed || media?.matches === true || navigator?.standalone === true;
  const state = () => ({ available: Boolean(promptEvent && !pending && !isInstalled()), installing: pending && !isInstalled(), installed: isInstalled() });
  let previous = state();
  function notify() {
    const next = state();
    if (next.available === previous.available && next.installing === previous.installing && next.installed === previous.installed) return;
    previous = next;
    onChange(next);
  }
  function displayChanged() {
    if (isInstalled()) promptEvent = null;
    notify();
  }
  target?.addEventListener?.('beforeinstallprompt', event => {
    if (typeof event.prompt !== 'function') return;
    event.preventDefault();
    if (isInstalled() || pending || promptEvent || used.has(event)) return;
    promptEvent = event;
    notify();
  });
  target?.addEventListener?.('appinstalled', () => {
    confirmed = true;
    promptEvent = null;
    notify();
  });
  if (typeof media?.addEventListener === 'function') media.addEventListener('change', displayChanged);
  else media?.addListener?.(displayChanged);

  return {
    get state() { return state(); },
    async install() {
      if (isInstalled()) return 'installed';
      if (pending) return 'busy';
      if (!promptEvent) return 'unsupported';
      const event = promptEvent;
      promptEvent = null;
      pending = true;
      used.add(event);
      try {
        // Invoke before yielding so the browser keeps the button click's activation.
        const attempt = event.prompt();
        notify();
        const result = await attempt;
        const choice = result?.outcome ? result : await event.userChoice;
        if (isInstalled()) return 'installed';
        return choice?.outcome === 'accepted' ? 'accepted' : choice?.outcome === 'dismissed' ? 'dismissed' : 'failed';
      } catch {
        return isInstalled() ? 'installed' : 'failed';
      } finally {
        pending = false;
        notify();
      }
    }
  };
}
