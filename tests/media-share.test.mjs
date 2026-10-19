import assert from 'node:assert/strict';
import { File as BufferFile } from 'node:buffer';
import { createMediaExport, createMediaShare, posterURL, posterSizeFromSearch } from '../media-share.js';
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

await test('Only PNG files can be handed to the native image share sheet', async () => {
  const sharing = createMediaShare({ navigator: { canShare() { assert.fail('Do not query native sharing for other file types.'); }, share() { assert.fail(); } }, download() { assert.fail(); } });
  for (const file of [new File(['private'], 'backup.json', { type: 'application/json' }), new File(['image'], 'photo.jpg', { type: 'image/jpeg' })]) {
    assert.equal(sharing.canShare(file), false);
    assert.equal(await sharing.share(file), 'unsupported');
    assert.equal(sharing.mode(file, 'poster'), 'unsupported');
    assert.equal(await sharing.share(file, 'poster'), 'unsupported');
  }
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

await test('File-capable Safari and Android Chrome capabilities prefer the prepared PNG', async () => {
  const file = png('olympics-full-poster.png'), payloads = [];
  const sharing = createMediaShare({ navigator: { canShare(payload) { assert.deepEqual(payload, { files: [file] }); return true; }, share(payload) { payloads.push(payload); } } });
  assert.equal(sharing.canShare(file), true);
  assert.equal(sharing.mode(file, 'poster'), 'image');
  assert.equal(await sharing.share(file, 'poster'), 'shared');
  assert.deepEqual(payloads, [{ files: [file], title: 'OLYMPICS' }]);
});

await test('Android Firefox URL-only capabilities open the native share sheet synchronously', async () => {
  const file = png('olympics-phone-story.png'), completion = deferred(), payloads = [];
  const device = { canShare(payload) { assert.equal(this, device); return Boolean(payload.url); }, share(payload) { assert.equal(this, device); payloads.push(payload); return completion.promise; } };
  const sharing = createMediaShare({ navigator: device });
  assert.equal(sharing.canShare(file), false);
  assert.equal(sharing.mode(file, 'phone'), 'link');
  const pending = sharing.share(file, 'phone');
  assert.deepEqual(payloads, [{ url: posterURL('phone'), title: 'OLYMPICS' }], 'Native URL sharing is invoked before the caller regains control.');
  assert.equal(await sharing.share(file, 'phone'), 'busy');
  completion.resolve();
  assert.equal(await pending, 'shared-link');
});

await test('Legacy native sharing without canShare attempts only a canonical URL', async () => {
  const file = png('olympics-full-poster.png'), payloads = [];
  const sharing = createMediaShare({ navigator: { share(payload) { payloads.push(payload); } } });
  assert.equal(sharing.canShare(file), false);
  assert.equal(sharing.mode(file, 'poster'), 'link');
  const pending = sharing.share(file, 'poster');
  assert.deepEqual(payloads, [{ url: posterURL('poster'), title: 'OLYMPICS' }]);
  assert.equal(await pending, 'shared-link');
});

await test('Desktop without native sharing and browsers rejecting URLs remain unsupported', async () => {
  const file = png('poster.png');
  for (const navigator of [{}, { canShare: () => true }, { canShare: () => false, share() { assert.fail(); } }]) {
    const sharing = createMediaShare({ navigator });
    assert.equal(sharing.mode(file, 'poster'), 'unsupported');
    assert.equal(await sharing.share(file, 'poster'), 'unsupported');
    assert.equal(sharing.mode(null, 'poster'), 'unavailable');
  }
});

await test('Native URL sharing requires a valid public poster format', async () => {
  const file = png('poster.png');
  const sharing = createMediaShare({ navigator: { share() { assert.fail('Do not share a URL for an unknown format.'); } } });
  for (const size of [undefined, null, '', 'full', 'story', 'Poster']) {
    assert.equal(sharing.mode(file, size), 'unsupported');
    assert.equal(await sharing.share(file, size), 'unsupported');
    assert.throws(() => posterURL(size), TypeError);
  }
});

await test('A failed file capability probe can still allow a confirmed URL share', async () => {
  const payloads = [];
  const sharing = createMediaShare({ navigator: { canShare(payload) { if (payload.files) throw new Error('Files unsupported'); return Boolean(payload.url); }, share(payload) { payloads.push(payload); } } });
  assert.equal(await sharing.share(png('poster.png'), 'poster'), 'shared-link');
  assert.deepEqual(payloads, [{ url: posterURL('poster'), title: 'OLYMPICS' }]);
});

await test('URL sharing cancellation and failures do not trigger downloads or app redirects', async () => {
  const file = png('poster.png');
  for (const [name, status] of [['AbortError', 'cancelled'], ['InvalidStateError', 'busy'], ['NotAllowedError', 'failed'], ['TypeError', 'failed']]) {
    let calls = 0;
    const sharing = createMediaShare({ navigator: { canShare: payload => Boolean(payload.url), share() { calls++; return Promise.reject(namedError(name)); } }, download() { assert.fail(); } });
    assert.equal(await sharing.share(file, 'poster'), status);
    assert.equal(calls, 1);
    assert.equal(sharing.mode(file, 'poster'), 'link');
  }
});

await test('A false PNG capability report requests a new click before trying the native URL', async () => {
  const file = png('poster.png'), payloads = [];
  const sharing = createMediaShare({ navigator: { canShare: () => true, share(payload) { payloads.push(payload); if (payload.files) return Promise.reject(new TypeError('Files unsupported')); } } });
  assert.equal(await sharing.share(file, 'poster'), 'link-ready');
  assert.deepEqual(payloads, [{ files: [file], title: 'OLYMPICS' }], 'Do not make another native share call after yielding.');
  assert.equal(sharing.canShare(file), false);
  assert.equal(sharing.mode(file, 'poster'), 'link');
  const nextClick = sharing.share(file, 'poster');
  assert.deepEqual(payloads[1], { url: posterURL('poster'), title: 'OLYMPICS' });
  assert.equal(await nextClick, 'shared-link');
});

await test('An image TypeError with no supported native URL stays failed', async () => {
  const file = png('poster.png');
  const sharing = createMediaShare({ navigator: { canShare: payload => Boolean(payload.files), share() { throw new TypeError('Files unsupported'); } } });
  assert.equal(await sharing.share(file, 'poster'), 'failed');
  assert.equal(sharing.canShare(file), false);
  assert.equal(sharing.mode(file, 'poster'), 'unsupported');
});

await test('Cancellation, blocked access and data failures do not downgrade native PNG sharing', async () => {
  const file = png('poster.png');
  for (const [name, status] of [['AbortError', 'cancelled'], ['NotAllowedError', 'failed'], ['DataError', 'failed']]) {
    let calls = 0;
    const sharing = createMediaShare({ navigator: { canShare: () => true, share() { calls++; return Promise.reject(namedError(name)); } } });
    assert.equal(await sharing.share(file, 'poster'), status);
    assert.equal(calls, 1);
    assert.equal(sharing.canShare(file), true);
    assert.equal(sharing.mode(file, 'poster'), 'image');
  }
});

await test('Poster URLs contain only the canonical destination and selected public format', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, get() { assert.fail('Do not read the device URL.'); } });
  try {
    for (const [size, route] of [['poster', 'full'], ['phone', 'phone']]) {
      const expected = new URL(VIEWING_URL), actual = new URL(posterURL(size));
      expected.searchParams.set('poster', route);
      assert.equal(actual.href, expected.href);
      assert.deepEqual([...actual.searchParams], [['poster', route]]);
      assert.equal(actual.hash, '');
      assert.equal(actual.username, '');
      assert.equal(actual.password, '');
      assert.equal(posterSizeFromSearch(actual.search), size);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  }
});

await test('Poster routes select full or phone views and ignore unknown or missing choices', () => {
  for (const [search, size] of [['?poster=full', 'poster'], ['?poster=phone', 'phone'], ['poster=phone', 'phone'], ['?other=keep&poster=full', 'poster']]) assert.equal(posterSizeFromSearch(search), size);
  for (const search of [null, undefined, '', '?other=full', '?poster=', '?poster=poster', '?poster=Full', '?poster=story']) assert.equal(posterSizeFromSearch(search), null);
});

console.log(`${count} media export and sharing tests passed.`);
