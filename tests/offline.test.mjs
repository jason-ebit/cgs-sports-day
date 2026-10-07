import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/cgs-sports-day/';
const version = source.match(/const VERSION = '([^']+)'/)[1];
const cacheName = `cg-sports-day-v${version}`;
const asset = path => new URL(path, scope).href;
const keyFor = input => typeof input === 'string' ? asset(input) : input.url ?? input.href;

function worker({workerSource = source, stores = new Map()} = {}) {
  const handlers = new Map(), networkCalls = [], installRequests = [];
  let network = input => Promise.resolve(new Response(`network:${keyFor(input)}`));
  let cacheWrites = (cache, key, response) => { cache.entries.set(keyFor(key), response.clone()); };
  let installFailure = false, skipWaiting = 0, claims = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, {
        entries:new Map(),
        async match(key) { return this.entries.get(keyFor(key))?.clone(); },
        async put(key, response) { await cacheWrites(this, key, response); },
        async addAll(requests) {
          installRequests.push(...requests);
          if (installFailure) throw new Error('Install is offline');
          const responses = await Promise.all(requests.map(input => fetch(input)));
          for (let i = 0; i < requests.length; i++) await this.put(requests[i], responses[i]);
        }
      });
      return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  async function fetch(input) { networkCalls.push(keyFor(input)); return network(input); }
  vm.runInNewContext(workerSource, {
    URL, Request, caches, fetch,
    self:{
      location:new URL('sw.js', scope),
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() { skipWaiting++; },
      clients:{async claim() { claims++; }}
    }
  });
  function send(type, request) {
    const pending = [];
    const event = {
      request, pending,
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
      respondWith(promise) { this.response = Promise.resolve(promise); }
    };
    handlers.get(type)(event);
    return event;
  }
  async function dispatch(type, request) {
    const event = send(type, request);
    const response = event.response ? await event.response : undefined;
    await Promise.all(event.pending);
    return response;
  }
  return {
    stores, networkCalls, installRequests, send, dispatch,
    request(path, mode = 'cors', method = 'GET') { return {url:asset(path), mode, method}; },
    async seed(path, body, name = cacheName) { await (await caches.open(name)).put(asset(path), new Response(body)); },
    async cached(path, name = cacheName) { return (await caches.open(name)).match(asset(path)); },
    setNetwork(fn) { network = fn; },
    offline() { network = () => Promise.reject(new Error('Offline')); },
    failWrites() { cacheWrites = () => { throw new Error('Storage is full'); }; },
    delayWrites() {
      let release;
      const wait = new Promise(resolve => { release = resolve; });
      cacheWrites = async (cache, key, response) => { await wait; cache.entries.set(keyFor(key), response.clone()); };
      return release;
    },
    failInstall() { installFailure = true; },
    get skipWaiting() { return skipWaiting; },
    get claims() { return claims; }
  };
}

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({name, pass:true}); }
  catch (error) { tests.push({name, pass:false, error:error.message}); }
}

await test('The installed shell contains the exact versions loaded by the page and modules', async () => {
  const w = worker();
  await w.dispatch('install');
  assert.equal(w.skipWaiting, 1);
  const precached = new Set(w.installRequests.map(request => request.url));
  for (const file of ['index.html', 'app.js', 'live.js', 'model.js', 'rounds.js', 'media.js']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/["'](?:\.\/)?([^"']+\.(?:js|css|json)\?v=\d+)["']/g)) {
      assert.ok(precached.has(asset(match[1])), `${file} references an uncached release: ${match[1]}`);
    }
  }
  assert.ok(w.installRequests.every(request => request.cache === 'reload'));
});

await test('Every installed shell resource remains available offline', async () => {
  const w = worker();
  await w.dispatch('install');
  w.offline();
  for (const request of w.installRequests) {
    const path = new URL(request.url).href;
    const response = await w.dispatch('fetch', w.request(path, path === scope ? 'navigate' : 'cors'));
    assert.equal(response.status, 200, path);
  }
});

await test('New asset versions cannot receive an old version or an unversioned cached file', async () => {
  const w = worker();
  await w.seed('app.js?v=16', 'old module');
  await w.seed('app.js', 'unversioned module');
  w.setNetwork(() => Promise.resolve(new Response('new module')));
  const response = await w.dispatch('fetch', w.request(`app.js?v=${version}`));
  assert.equal(await response.text(), 'new module');
  assert.equal(w.networkCalls.length, 1);
  assert.equal(await (await w.cached(`app.js?v=${version}`)).text(), 'new module');
});

await test('Assets are read only from the current release cache', async () => {
  const w = worker();
  await w.seed(`app.js?v=${version}`, 'stale cache', 'cg-sports-day-v15');
  const response = await w.dispatch('fetch', w.request(`app.js?v=${version}`));
  assert.equal(await response.text(), `network:${asset(`app.js?v=${version}`)}`);
});

await test('Offline asset requests must match their exact version', async () => {
  const w = worker();
  await w.seed(`app.js?v=${version}`, 'current module');
  w.offline();
  assert.equal(await (await w.dispatch('fetch', w.request(`app.js?v=${version}`))).text(), 'current module');
  await assert.rejects(w.dispatch('fetch', w.request('app.js?v=99')), /Offline/);
});

await test('Navigation serves the installed page instead of uncached future HTML', async () => {
  const w = worker();
  await w.seed('index.html', 'installed page');
  w.setNetwork(() => Promise.resolve(new Response('future page')));
  assert.equal(await (await w.dispatch('fetch', w.request('./?view=games', 'navigate'))).text(), 'installed page');
  assert.equal(w.networkCalls.length, 0);
  w.offline();
  assert.equal(await (await w.dispatch('fetch', w.request('./?view=scores', 'navigate'))).text(), 'installed page');
});

await test('An interrupted future installation leaves a complete current release usable offline', async () => {
  const active = worker();
  await active.dispatch('install');
  const installedPage = await (await active.cached('index.html')).text();
  active.setNetwork(() => Promise.resolve(new Response('<script type="module" src="app.js?v=99"></script>')));
  assert.equal(await (await active.dispatch('fetch', active.request('./', 'navigate'))).text(), installedPage);

  const future = worker({workerSource:source.replace(/const VERSION = '[^']+'/g, "const VERSION = '99'"), stores:active.stores});
  future.setNetwork(input => keyFor(input).endsWith('app.js?v=99')
    ? Promise.reject(new Error('Connection dropped during update'))
    : Promise.resolve(new Response(`future:${keyFor(input)}`)));
  await assert.rejects(future.dispatch('install'), /Connection dropped during update/);
  assert.equal(future.skipWaiting, 0);
  assert.equal(future.claims, 0);
  active.offline();
  assert.equal(await (await active.dispatch('fetch', active.request('./', 'navigate'))).text(), installedPage);
  for (const request of active.installRequests.filter(request => /\.(?:js|css|json)\?v=/.test(request.url))) {
    assert.equal((await active.dispatch('fetch', active.request(request.url))).status, 200, request.url);
  }
});

await test('An uncached landing page is served online without pinning an incomplete release', async () => {
  const w = worker();
  w.setNetwork(() => Promise.resolve(new Response('online page')));
  assert.equal(await (await w.dispatch('fetch', w.request('./', 'navigate'))).text(), 'online page');
  assert.equal(await w.cached('index.html'), undefined);
});

await test('Temporary page and schedule server errors preserve the usable offline copies', async () => {
  const w = worker();
  await w.seed('index.html', 'good page');
  await w.seed(`schedule.json?v=${version}`, 'good schedule');
  w.setNetwork(() => Promise.resolve(new Response('Server unavailable', {status:503})));
  assert.equal(await (await w.dispatch('fetch', w.request('./', 'navigate'))).text(), 'good page');
  assert.equal(await (await w.dispatch('fetch', w.request(`schedule.json?v=${version}`))).text(), 'good schedule');
  assert.equal(await (await w.cached('index.html')).text(), 'good page');
  assert.equal(await (await w.cached(`schedule.json?v=${version}`)).text(), 'good schedule');
});

await test('Opening an asset directly cannot replace the offline landing page', async () => {
  const w = worker();
  await w.seed('index.html', 'good page');
  w.setNetwork(() => Promise.resolve(new Response('directly opened script')));
  assert.equal(await (await w.dispatch('fetch', w.request(`app.js?v=${version}`, 'navigate'))).text(), 'directly opened script');
  assert.equal(await (await w.cached('index.html')).text(), 'good page');
});

await test('A missing offline copy does not turn a server error into an invalid response', async () => {
  const w = worker();
  w.setNetwork(() => Promise.resolve(new Response('Not found', {status:404})));
  assert.equal((await w.dispatch('fetch', w.request('./', 'navigate'))).status, 404);
  w.offline();
  await assert.rejects(w.dispatch('fetch', w.request('./', 'navigate')), /Offline/);
});

await test('Successful responses remain usable when browser storage is full', async () => {
  const w = worker();
  w.failWrites();
  assert.equal((await w.dispatch('fetch', w.request('./', 'navigate'))).status, 200);
  assert.equal((await w.dispatch('fetch', w.request(`app.js?v=${version}`))).status, 200);
});

await test('Cache writes remain part of the fetch event lifetime', async () => {
  const w = worker();
  const release = w.delayWrites();
  const event = w.send('fetch', w.request(`app.js?v=${version}`));
  assert.equal((await event.response).status, 200);
  assert.equal(event.pending.length, 1);
  assert.equal(await w.cached(`app.js?v=${version}`), undefined);
  release();
  await Promise.all(event.pending);
  assert.ok(await w.cached(`app.js?v=${version}`));
});

await test('Other sites, out-of-scope resources, and writes pass through untouched', async () => {
  const w = worker();
  for (const request of [
    w.request('https://other.test/file.js'),
    w.request('https://example.test/other-project/file.js'),
    w.request('schedule.json', 'cors', 'POST')
  ]) assert.equal(w.send('fetch', request).response, undefined);
  assert.equal(w.networkCalls.length, 0);
});

await test('An incomplete offline install leaves the previous worker usable', async () => {
  const w = worker();
  await w.seed('index.html', 'previous working page', 'cg-sports-day-v15');
  w.failInstall();
  await assert.rejects(w.dispatch('install'), /Install is offline/);
  assert.equal(w.skipWaiting, 0);
  assert.ok(w.stores.has('cg-sports-day-v15'));
});

await test('Activation cleans only obsolete app caches and never reloads a running desk', async () => {
  const w = worker();
  await w.seed('index.html', 'current page');
  await w.seed('index.html', 'old page', 'cg-sports-day-v15');
  await w.seed('index.html', 'other site', 'unrelated-site');
  await w.dispatch('activate');
  assert.equal(w.stores.has('cg-sports-day-v15'), false);
  assert.equal(w.stores.has(cacheName), true);
  assert.equal(w.stores.has('unrelated-site'), true);
  assert.equal(w.claims, 1);
});

for (const result of tests) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ` — ${result.error}` : ''}`);
if (tests.some(result => !result.pass)) process.exitCode = 1;
