import assert from 'node:assert/strict';
import { File as BufferFile } from 'node:buffer';
import { createMediaExport, createMediaShare, posterShareTargets, posterSizeFromSearch } from '../media-share.js';
import { VIEWING_URL } from '../share-link.js';

globalThis.File ??= BufferFile;
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS ' + name); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function canvas(label, manual = false) {
  const encodes = [];
  return {
    encodes,
    toBlob(done, type) {
      encodes.push({ done, type });
      if (!manual) done(new Blob([label], { type: 'image/png' }));
    }
  };
}
const png = name => new File([name], name, { type: 'image/png' });
const namedError = name => Object.assign(new Error(name), { name });

await test('Both public formats prepare a PNG file with the matching canvas and filename', async () => {
  for (const [size, filename] of [['poster', 'olympics-full-poster.png'], ['phone', 'olympics-phone-story.png']]) {
    const image = canvas(size), input = { size, publicContent: 'schedule and teams' };
    const exports = createMediaExport({ render: value => { assert.equal(value, input); return image; } });
    const prepared = await exports.prepare(input);
    assert.equal(prepared, exports.asset);
    assert.equal(prepared.canvas, image);
    assert.equal(prepared.size, size);
    assert.ok(prepared.file instanceof File);
    assert.equal(prepared.file.type, 'image/png');
    assert.equal(prepared.file.name, filename);
    assert.equal(await prepared.file.text(), size);
    assert.equal(image.encodes[0].type, 'image/png');
  }
});

await test('A new preparation clears the previously shareable asset immediately', async () => {
  const next = deferred();
  const exports = createMediaExport({ render: input => input.size === 'poster' ? canvas('old') : next.promise });
  await exports.prepare({ size: 'poster' });
  assert.ok(exports.asset);
  const pending = exports.prepare({ size: 'phone' });
  assert.equal(exports.asset, null);
  next.resolve(canvas('new'));
  assert.equal((await pending).file.name, 'olympics-phone-story.png');
});

await test('An older render cannot replace the latest format when rendering finishes out of order', async () => {
  const old = deferred(), newer = deferred(), oldCanvas = canvas('old'), newCanvas = canvas('new');
  const exports = createMediaExport({ render: input => input.size === 'poster' ? old.promise : newer.promise });
  const first = exports.prepare({ size: 'poster' }), second = exports.prepare({ size: 'phone' });
  newer.resolve(newCanvas);
  const latest = await second;
  old.resolve(oldCanvas);
  assert.equal(await first, null);
  assert.equal(exports.asset, latest);
  assert.equal(latest.canvas, newCanvas);
  assert.equal(oldCanvas.encodes.length, 0);
});

await test('An older PNG encoder cannot replace a newer completed export', async () => {
  const old = canvas('old', true), newer = canvas('new', true);
  const exports = createMediaExport({ render: input => input.size === 'poster' ? old : newer });
  const first = exports.prepare({ size: 'poster' });
  await Promise.resolve();
  const second = exports.prepare({ size: 'phone' });
  await Promise.resolve();
  newer.encodes[0].done(new Blob(['new'], { type: 'image/png' }));
  const latest = await second;
  old.encodes[0].done(new Blob(['old'], { type: 'image/png' }));
  assert.equal(await first, null);
  assert.equal(exports.asset, latest);
  assert.equal(await latest.file.text(), 'new');
});

await test('A newer null encoding stays failed even when an older encoder later succeeds', async () => {
  const old = canvas('old', true), newer = canvas('new', true);
  const exports = createMediaExport({ render: input => input.size === 'poster' ? old : newer });
  const first = exports.prepare({ size: 'poster' });
  await Promise.resolve();
  const second = exports.prepare({ size: 'phone' });
  await Promise.resolve();
  const failure = assert.rejects(second, /encode the PNG/);
  newer.encodes[0].done(null);
  await failure;
  assert.equal(exports.asset, null);
  old.encodes[0].done(new Blob(['old']));
  assert.equal(await first, null);
  assert.equal(exports.asset, null);
});

await test('A newer render failure also prevents an older prepared image from returning', async () => {
  const old = canvas('old', true), failure = new Error('Render failed');
  const exports = createMediaExport({ render: input => { if (input.size === 'phone') throw failure; return old; } });
  const first = exports.prepare({ size: 'poster' });
  await Promise.resolve();
  await assert.rejects(exports.prepare({ size: 'phone' }), error => error === failure);
  old.encodes[0].done(new Blob(['old']));
  assert.equal(await first, null);
  assert.equal(exports.asset, null);
});

await test('Invalidate cancels a pending render and a completed asset', async () => {
  const pending = deferred();
  const exports = createMediaExport({ render: input => input.size === 'phone' ? pending.promise : canvas('ready') });
  await exports.prepare({ size: 'poster' });
  exports.invalidate();
  assert.equal(exports.asset, null);
  const next = exports.prepare({ size: 'phone' });
  exports.invalidate();
  pending.resolve(canvas('stale'));
  assert.equal(await next, null);
  assert.equal(exports.asset, null);
});

await test('Invalidate cancels a pending encoder and suppresses a stale render failure', async () => {
  const image = canvas('pending', true), failedRender = deferred();
  const exports = createMediaExport({ render: input => input.size === 'poster' ? image : failedRender.promise });
  const first = exports.prepare({ size: 'poster' });
  await Promise.resolve();
  exports.invalidate();
  image.encodes[0].done(null);
  assert.equal(await first, null);
  const second = exports.prepare({ size: 'phone' });
  exports.invalidate();
  failedRender.reject(new Error('Stale render failed'));
  assert.equal(await second, null);
  assert.equal(exports.asset, null);
});

await test('A current encoding exception rejects and leaves no shareable image', async () => {
  const failure = new Error('Encoding blocked');
  const exports = createMediaExport({ render: () => ({ toBlob() { throw failure; } }) });
  await assert.rejects(exports.prepare({ size: 'poster' }), error => error === failure);
  assert.equal(exports.asset, null);
});

await test('Native sharing is invoked synchronously with only the prepared file and public title', async () => {
  const file = png('olympics-full-poster.png'), completion = deferred();
  let payload = null;
  const device = {
    canShare(value) { assert.equal(this, device); assert.deepEqual(value, { files: [file] }); return true; },
    share(value) { assert.equal(this, device); payload = value; return completion.promise; }
  };
  const sharing = createMediaShare({ navigator: device });
  const pending = sharing.share(file);
  assert.deepEqual(payload, { files: [file], title: 'OLYMPICS' }, 'Share is called before the caller regains control.');
  completion.resolve();
  assert.equal(await pending, 'shared');
});

await test('Unsupported native sharing and unsupported files return unsupported without downloading', async () => {
  const file = png('olympics-phone-story.png');
  for (const device of [null, {}, { share() {} }, { canShare: () => true }, { share() { assert.fail('Unsupported files must not invoke native share.'); }, canShare() { return false; } }, { share() {}, canShare() { throw new Error('Unsupported'); } }]) {
    const sharing = createMediaShare({ navigator: device, download() { assert.fail('Sharing must not trigger a download.'); } });
    assert.equal(sharing.canShare(file), false);
    assert.equal(await sharing.share(file), 'unsupported');
  }
});

await test('Missing images are unavailable and never trigger sharing or downloads', async () => {
  const sharing = createMediaShare({ navigator: { canShare() { assert.fail(); }, share() { assert.fail(); } }, download() { assert.fail(); } });
  assert.equal(sharing.canShare(null), false);
  assert.equal(await sharing.share(null), 'unavailable');
});

await test('Cancelling native sharing does not download and releases the busy guard', async () => {
  const file = png('olympics-full-poster.png');
  let calls = 0;
  const sharing = createMediaShare({ navigator: { canShare: () => true, share() { if (++calls === 1) return Promise.reject(namedError('AbortError')); } }, download() { assert.fail('Cancelled sharing must not download.'); } });
  assert.equal(await sharing.share(file), 'cancelled');
  assert.equal(await sharing.share(file), 'shared');
});

await test('An already-open native share sheet returns busy and releases the guard', async () => {
  let calls = 0;
  const sharing = createMediaShare({ navigator: { canShare: () => true, share() { if (++calls === 1) throw namedError('InvalidStateError'); } }, download() { assert.fail('An open share sheet must not download.'); } });
  assert.equal(await sharing.share(png('olympics-full-poster.png')), 'busy');
  assert.equal(await sharing.share(png('olympics-full-poster.png')), 'shared');
});

await test('Blocked sharing and other native failures return failed without downloading', async () => {
  const file = png('olympics-full-poster.png');
  for (const share of [() => { throw namedError('NotAllowedError'); }, () => Promise.reject(new Error('Share failed'))]) {
    const sharing = createMediaShare({ navigator: { canShare: () => true, share }, download() { assert.fail('Sharing must not trigger a download.'); } });
    assert.equal(await sharing.share(file), 'failed');
  }
});

await test('Concurrent share clicks cannot open duplicate sheets or trigger a fallback download', async () => {
  const file = png('olympics-full-poster.png'), completion = deferred();
  let nativeCalls = 0;
  const sharing = createMediaShare({ navigator: { canShare: () => true, share() { nativeCalls++; return completion.promise; } }, download() { assert.fail(); } });
  const first = sharing.share(file);
  assert.equal(await sharing.share(file), 'busy');
  assert.equal(nativeCalls, 1);
  completion.resolve();
  assert.equal(await first, 'shared');
  assert.equal(await sharing.share(file), 'shared');
  assert.equal(nativeCalls, 2);
});

await test('Copy image writes the prepared PNG synchronously with the clipboard receiver intact', async () => {
  const file = png('olympics-phone-story.png'), completion = deferred();
  const writes = [], formats = [];
  class ClipboardImage {
    constructor(data) { this.data = data; }
    static supports(type) { formats.push(type); return type === 'image/png'; }
  }
  const clipboard = { write(items) { assert.equal(this, clipboard); writes.push(items); return completion.promise; } };
  const sharing = createMediaShare({ navigator: { clipboard }, ClipboardItem: ClipboardImage });
  assert.equal(sharing.canCopyImage(file), true);
  const pending = sharing.copyImage(file);
  assert.equal(writes.length, 1, 'Clipboard write is invoked before the caller regains control.');
  assert.equal(writes[0].length, 1);
  assert.ok(writes[0][0] instanceof ClipboardImage);
  assert.deepEqual(writes[0][0].data, { 'image/png': file });
  assert.ok(formats.every(type => type === 'image/png'));
  completion.resolve();
  assert.equal(await pending, 'copied');
});

await test('PNG clipboard support works when the optional supports method is absent', async () => {
  class ClipboardImage { constructor(data) { this.data = data; } }
  const sharing = createMediaShare({ navigator: { clipboard: { write: () => Promise.resolve() } }, ClipboardItem: ClipboardImage });
  assert.equal(sharing.canCopyImage(png('poster.png')), true);
  assert.equal(await sharing.copyImage(png('poster.png')), 'copied');
});

await test('Missing clipboard features and unsupported PNG types do not attempt copying', async () => {
  class ClipboardImage { constructor() { assert.fail('Unsupported copying must not build an item.'); } }
  class UnsupportedImage extends ClipboardImage { static supports() { return false; } }
  class BrokenSupport extends ClipboardImage { static supports() { throw new Error('Blocked'); } }
  const file = png('poster.png');
  for (const options of [
    { navigator: null, ClipboardItem: ClipboardImage },
    { navigator: {}, ClipboardItem: ClipboardImage },
    { navigator: { clipboard: {} }, ClipboardItem: ClipboardImage },
    { navigator: { clipboard: { write() { assert.fail(); } } }, ClipboardItem: null },
    { navigator: { clipboard: { write() { assert.fail(); } } }, ClipboardItem: UnsupportedImage },
    { navigator: { clipboard: { write() { assert.fail(); } } }, ClipboardItem: BrokenSupport }
  ]) {
    const sharing = createMediaShare(options);
    assert.equal(sharing.canCopyImage(file), false);
    assert.equal(await sharing.copyImage(file), 'unsupported');
  }
  const sharing = createMediaShare({ navigator: { clipboard: { write() { assert.fail(); } } }, ClipboardItem: ClipboardImage });
  for (const invalid of [null, new File(['text'], 'note.txt', { type: 'text/plain' })]) {
    assert.equal(sharing.canCopyImage(invalid), false);
    assert.equal(await sharing.copyImage(invalid), 'unsupported');
  }
});

await test('Clipboard item construction and blocked or rejected writes fail without downloading', async () => {
  class ClipboardImage { constructor(data) { this.data = data; } }
  class BrokenItem { constructor() { throw new Error('Cannot build clipboard item'); } }
  const file = png('poster.png');
  for (const options of [
    { ClipboardItem: BrokenItem, navigator: { clipboard: { write() { assert.fail(); } } } },
    { ClipboardItem: ClipboardImage, navigator: { clipboard: { write() { throw namedError('NotAllowedError'); } } } },
    { ClipboardItem: ClipboardImage, navigator: { clipboard: { write() { return Promise.reject(new Error('Copy failed')); } } } }
  ]) {
    const sharing = createMediaShare({ ...options, download() { assert.fail('Copying must not trigger a download.'); } });
    assert.equal(await sharing.copyImage(file), 'failed');
  }
});

await test('Each format gets a canonical poster URL and correctly encoded app share links', () => {
  for (const [size, route] of [['poster', 'full'], ['phone', 'phone']]) {
    const targets = posterShareTargets(size), expected = new URL(VIEWING_URL);
    expected.searchParams.set('poster', route);
    assert.deepEqual(Object.keys(targets).sort(), ['instagram', 'poster', 'whatsapp', 'x']);
    assert.equal(targets.poster, expected.href);
    const whatsapp = new URL(targets.whatsapp), x = new URL(targets.x);
    assert.equal(whatsapp.origin + whatsapp.pathname, 'https://wa.me/');
    assert.deepEqual([...whatsapp.searchParams], [['text', 'OLYMPICS · Oct 25\n' + expected.href]]);
    assert.equal(x.origin + x.pathname, 'https://twitter.com/intent/tweet');
    assert.deepEqual([...x.searchParams], [['text', 'OLYMPICS · Oct 25'], ['url', expected.href]]);
    assert.equal(targets.instagram, 'https://www.instagram.com/');
    assert.equal(posterSizeFromSearch(expected.search), size);
  }
});

await test('Public share targets never read the viewing device URL or carry its private state', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, get() { assert.fail('Do not read location for public poster links.'); } });
  try {
    const poster = new URL(posterShareTargets('poster').poster);
    assert.deepEqual([...poster.searchParams], [['poster', 'full']]);
    assert.equal(poster.hash, '');
    assert.equal(poster.username, '');
    assert.equal(poster.password, '');
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  }
});

await test('Only supported export formats can create share targets', () => {
  for (const size of [undefined, null, '', 'full', 'story', 'Poster']) assert.throws(() => posterShareTargets(size), TypeError);
});

await test('Poster routes select full or phone views and ignore unknown or missing choices', () => {
  for (const [search, size] of [['?poster=full', 'poster'], ['?poster=phone', 'phone'], ['poster=phone', 'phone'], ['?other=keep&poster=full', 'poster']]) assert.equal(posterSizeFromSearch(search), size);
  for (const search of [null, undefined, '', '?other=full', '?poster=', '?poster=poster', '?poster=Full', '?poster=story']) assert.equal(posterSizeFromSearch(search), null);
});

console.log(`${count} media export and sharing tests passed.`);
