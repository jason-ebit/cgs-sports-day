import assert from 'node:assert/strict';
import { createAppInstall } from '../app-install.js';

let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS ' + name); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function browser({ standalone = false, legacyMedia = false } = {}) {
  const events = new Map(), mediaEvents = new Map();
  const media = { matches: standalone };
  const subscribe = (type, listener) => mediaEvents.set(type, listener);
  if (legacyMedia) media.addListener = listener => subscribe('change', listener);
  else media.addEventListener = subscribe;
  return {
    addEventListener(type, listener) { events.set(type, listener); },
    matchMedia(query) { assert.equal(query, '(display-mode: standalone)'); return media; },
    emit(type, value) { events.get(type)?.(value); },
    display(value) { media.matches = value; mediaEvents.get('change')?.({ matches: value }); }
  };
}
function nativePrompt({ outcome = 'accepted', completion, prompt } = {}) {
  return {
    calls: 0, prevented: 0,
    preventDefault() { this.prevented++; },
    prompt() {
      this.calls++;
      assert.equal(this.calls, 1, 'Each native event can only be used once.');
      return prompt ? prompt.call(this) : completion?.promise ?? Promise.resolve({ outcome });
    }
  };
}
const idle = { available: false, installing: false, installed: false };

await test('No browser or captured native event falls back to the manual guide', async () => {
  for (const target of [null, {}, browser()]) {
    const install = createAppInstall({ window: target, navigator: {} });
    assert.deepEqual(install.state, idle);
    assert.equal(await install.install(), 'unsupported');
  }
});

await test('Capturing a native prompt enables install and invokes it before yielding', async () => {
  const target = browser(), changes = [], completion = deferred(), event = nativePrompt({ completion });
  const install = createAppInstall({ window: target, navigator: {}, onChange: state => changes.push(state) });
  target.emit('beforeinstallprompt', event);
  assert.equal(event.prevented, 1);
  assert.deepEqual(install.state, { ...idle, available: true });
  const pending = install.install();
  assert.equal(event.calls, 1, 'The user activation must reach prompt() synchronously.');
  assert.deepEqual(install.state, { ...idle, installing: true });
  assert.equal(await install.install(), 'busy');
  completion.resolve({ outcome: 'accepted' });
  assert.equal(await pending, 'accepted');
  assert.deepEqual(install.state, idle, 'Acceptance alone must not claim installation.');
  assert.deepEqual(changes, [{ ...idle, available: true }, { ...idle, installing: true }, idle]);
});

await test('A dismissed prompt is consumed, while a later fresh event permits another try', async () => {
  const target = browser(), first = nativePrompt({ outcome: 'dismissed' }), second = nativePrompt();
  const install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', first);
  assert.equal(await install.install(), 'dismissed');
  assert.equal(await install.install(), 'unsupported');
  target.emit('beforeinstallprompt', first);
  assert.equal(await install.install(), 'unsupported', 'Re-dispatching an already consumed event must not reuse it.');
  target.emit('beforeinstallprompt', second);
  assert.equal(await install.install(), 'accepted');
});

await test('Older browsers can expose the choice separately from prompt()', async () => {
  const target = browser(), completion = deferred();
  const event = nativePrompt({ prompt() {} });
  event.userChoice = completion.promise;
  const install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', event);
  const pending = install.install();
  assert.equal(event.calls, 1);
  completion.resolve({ outcome: 'dismissed' });
  assert.equal(await pending, 'dismissed');
  assert.deepEqual(install.state, idle);
});

await test('Only the first available prompt is retained and new prompts are ignored while pending', async () => {
  const target = browser(), completion = deferred(), first = nativePrompt({ completion });
  const duplicate = nativePrompt(), concurrent = nativePrompt();
  const install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', first);
  target.emit('beforeinstallprompt', duplicate);
  const pending = install.install();
  target.emit('beforeinstallprompt', concurrent);
  completion.resolve({ outcome: 'accepted' });
  assert.equal(await pending, 'accepted');
  assert.equal(first.calls, 1);
  assert.equal(duplicate.calls, 0);
  assert.equal(concurrent.calls, 0);
  assert.equal(await install.install(), 'unsupported');
});

await test('Prompt exceptions and rejected native promises release the busy state', async () => {
  for (const prompt of [() => { throw new Error('Blocked'); }, () => Promise.reject(new Error('Blocked'))]) {
    const target = browser(), install = createAppInstall({ window: target, navigator: {} });
    const event = nativePrompt({ prompt });
    target.emit('beforeinstallprompt', event);
    assert.equal(await install.install(), 'failed');
    assert.deepEqual(install.state, idle);
    assert.equal(await install.install(), 'unsupported');
    target.emit('beforeinstallprompt', nativePrompt({ outcome: 'dismissed' }));
    assert.equal(await install.install(), 'dismissed');
  }
});

await test('A rejected separate userChoice also falls back without reusing the event', async () => {
  const target = browser(), completion = deferred(), event = nativePrompt({ prompt() {} });
  event.userChoice = completion.promise;
  const install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', event);
  const pending = install.install();
  completion.reject(new Error('Unavailable'));
  assert.equal(await pending, 'failed');
  assert.deepEqual(install.state, idle);
});

await test('appinstalled confirms installation even when the native dialog is still pending', async () => {
  const target = browser(), completion = deferred(), event = nativePrompt({ completion });
  const install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', event);
  const pending = install.install();
  target.emit('appinstalled');
  assert.deepEqual(install.state, { ...idle, installed: true });
  assert.equal(await install.install(), 'installed');
  target.emit('beforeinstallprompt', nativePrompt());
  completion.resolve({ outcome: 'accepted' });
  assert.equal(await pending, 'installed');
  assert.deepEqual(install.state, { ...idle, installed: true });
});

await test('An installation confirmation takes precedence over a later native rejection', async () => {
  const target = browser(), completion = deferred(), install = createAppInstall({ window: target, navigator: {} });
  target.emit('beforeinstallprompt', nativePrompt({ completion }));
  const pending = install.install();
  target.emit('appinstalled');
  completion.reject(new Error('Dialog closed after installation'));
  assert.equal(await pending, 'installed');
  assert.equal(install.state.installed, true);
});

await test('Installed standalone launches do not offer a native installation again', async () => {
  for (const [target, navigator] of [[browser({ standalone: true }), {}], [browser(), { standalone: true }]]) {
    const event = nativePrompt(), install = createAppInstall({ window: target, navigator });
    target.emit('beforeinstallprompt', event);
    assert.deepEqual(install.state, { ...idle, installed: true });
    assert.equal(await install.install(), 'installed');
    assert.equal(event.calls, 0);
  }
});

await test('Display-mode changes update installation state and discard obsolete prompts', async () => {
  for (const legacyMedia of [false, true]) {
    const target = browser({ legacyMedia }), changes = [], install = createAppInstall({ window: target, navigator: {}, onChange: state => changes.push(state) });
    target.emit('beforeinstallprompt', nativePrompt());
    target.display(true);
    assert.deepEqual(install.state, { ...idle, installed: true });
    target.display(false);
    assert.deepEqual(install.state, idle);
    assert.equal(await install.install(), 'unsupported');
    assert.equal(changes.length, 3);
  }
});

await test('A fresh event captured after a completed attempt remains available', async () => {
  const target = browser(), next = nativePrompt(), changes = [];
  const install = createAppInstall({ window: target, navigator: {}, onChange: state => {
    changes.push(state);
    if (changes.length === 3) target.emit('beforeinstallprompt', next);
  } });
  target.emit('beforeinstallprompt', nativePrompt({ outcome: 'dismissed' }));
  assert.equal(await install.install(), 'dismissed');
  assert.equal(install.state.available, true);
  assert.equal(await install.install(), 'accepted');
  assert.equal(next.calls, 1);
});

console.log('\n' + count + ' app install checks passed.');
