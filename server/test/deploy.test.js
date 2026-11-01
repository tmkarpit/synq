import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clientIp, loadConfig, originPolicy } from '../src/config.js';
import { createSynqServer } from '../src/app.js';

// Production settings and serving the website from the SYNQ server (one origin).

test('production turns off the host terminal and native languages unless switched on', () => {
  const prod = loadConfig({ NODE_ENV: 'production' });
  assert.equal(prod.shellEnabled, false);
  assert.deepEqual(prod.runLanguages, ['javascript', 'typescript']);
  assert.equal(prod.corsOrigin, false);
  const optedIn = loadConfig({ NODE_ENV: 'production', SHELL_ENABLED: 'true', RUN_LANGUAGES: 'python, JavaScript', CORS_ORIGIN: 'https://a.example, https://b.example' });
  assert.equal(optedIn.shellEnabled, true);
  assert.deepEqual(optedIn.runLanguages, ['python', 'javascript']);
  assert.equal(optedIn.corsOrigin('https://a.example'), true);
  assert.equal(optedIn.corsOrigin('https://b.example'), true);
  assert.equal(optedIn.corsOrigin('https://evil.example'), false);
});

test('development keeps every feature on', () => {
  const dev = loadConfig({});
  assert.equal(dev.shellEnabled, true);
  assert.equal(dev.runLanguages, null);
  assert.equal(dev.corsOrigin, true);
  assert.equal(dev.port, 4000);
  assert.equal(loadConfig({ SHELL_ENABLED: 'false' }).shellEnabled, false);
});

test('the client address comes from trusted proxies only', () => {
  // No proxy configured: a spoofed header from the internet is ignored.
  assert.equal(clientIp('203.0.113.9', '1.2.3.4', 0), '203.0.113.9');
  // One proxy (a load balancer): the address it saw is the last entry.
  assert.equal(clientIp('10.0.0.2', '1.2.3.4, 198.51.100.7', 1), '198.51.100.7');
  // Two proxies (CDN + load balancer).
  assert.equal(clientIp('10.0.0.2', '1.2.3.4, 198.51.100.7, 172.16.0.1', 2), '198.51.100.7');
  // The local Vite dev proxy passes the browser on.
  assert.equal(clientIp('127.0.0.1', '192.168.1.20', 0), '192.168.1.20');
  assert.equal(clientIp('::1', '', 0), '::1');
});

test('the server serves the built website: pages, assets, 404s, no path escapes', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SYNQ</title>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-test-'));
  const server = createSynqServer({ dataDir, staticDir: dist, production: true });
  const { port } = await server.listen(0, '127.0.0.1');
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`);
  try {
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('strict-transport-security'), /max-age/);
    const room = await get('/room/synq-abcd-efgh');
    assert.equal(room.status, 200, 'refreshing a room page must not 404');
    assert.match(await room.text(), /<title>SYNQ/);
    const asset = await get('/assets/app-123.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.equal((await get('/robots.txt')).status, 200);
    assert.equal((await get('/missing.png')).status, 404);
    for (const escape of ['/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/assets/..%2f..%2f..%2fpackage.json']) {
      const res = await get(escape);
      assert.doesNotMatch(await res.text(), /"name"/, `${escape} served a file outside the site`);
    }
    const health = await (await get('/api/health')).json();
    assert.deepEqual(health, { ok: true }, 'production health must not reveal open rooms');
    assert.deepEqual(await (await get('/api/lan')).json(), { addresses: [] });
  } finally {
    await server.close();
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('website files are sent compressed when the browser accepts it', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SYNQ</title>');
  const big = 'console.log("synq");\n'.repeat(5000);
  fs.writeFileSync(path.join(dist, 'assets', 'big.js'), big);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-test-'));
  const server = createSynqServer({ dataDir, staticDir: dist });
  const { port } = await server.listen(0, '127.0.0.1');
  const http = await import('node:http');
  const raw = (encoding) =>
    new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/assets/big.js', headers: encoding ? { 'accept-encoding': encoding } : {} }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      });
    });
  try {
    const zlib = await import('node:zlib');
    const br = await raw('gzip, deflate, br');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.ok(br.body.length < big.length / 10);
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), big);
    const gz = await raw('gzip');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gz.body).toString(), big);
    const plain = await raw(null);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), big);
  } finally {
    await server.close();
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('MONGODB_IP_FAMILY picks IPv4 or IPv6 for the database, anything else is ignored', () => {
  assert.equal(loadConfig({ MONGODB_IP_FAMILY: '4' }).mongodbFamily, 4);
  assert.equal(loadConfig({ MONGODB_IP_FAMILY: '6' }).mongodbFamily, 6);
  assert.equal(loadConfig({ MONGODB_IP_FAMILY: 'x' }).mongodbFamily, undefined);
  assert.equal(loadConfig({}).mongodbFamily, undefined);
});

test('/health answers without the database; /health/ready reports whether it is up', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-test-'));
  const server = createSynqServer({ dataDir, production: true });
  const { port } = await server.listen(0, '127.0.0.1');
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true, database: 'up' });
    server.store.ping = async () => {
      throw new Error('database down');
    };
    const down = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(down.status, 503);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200, '/health must not depend on the database');
  } finally {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('allowed origins: exact list without trailing slashes, and only your own Vercel previews', () => {
  const allow = loadConfig({ NODE_ENV: 'production', CLIENT_ORIGINS: 'https://synq.vercel.app/, https://synq.example.com', VERCEL_PREVIEW_PROJECT: 'synq' }).corsOrigin;
  assert.equal(allow('https://synq.vercel.app'), true);
  assert.equal(allow('https://synq.example.com'), true);
  assert.equal(allow('https://synq-git-main-arpit.vercel.app'), true);
  assert.equal(allow('https://synq-abc123-arpit.vercel.app'), true);
  assert.equal(allow('https://other-app.vercel.app'), false, "another person's Vercel app");
  assert.equal(allow('https://synq.vercel.app.evil.com'), false);
  assert.equal(allow('http://synq.vercel.app'), false, 'plain http');
  assert.equal(originPolicy({ production: true }), false);
  assert.equal(originPolicy({ production: false }), true);
  assert.equal(loadConfig({ CORS_ORIGIN: 'https://old.example' }).corsOrigin('https://old.example'), true, 'CORS_ORIGIN still works');
});

test('the API answers CORS preflights for allowed origins only, with credentials', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synq-test-'));
  const server = createSynqServer({ dataDir, production: true, corsOrigin: (o) => o === 'https://synq.vercel.app' });
  const { port } = await server.listen(0, '127.0.0.1');
  const call = (origin, method = 'OPTIONS') =>
    fetch(`http://127.0.0.1:${port}/api/health`, { method, headers: { origin, 'access-control-request-method': 'POST' } });
  try {
    const ok = await call('https://synq.vercel.app');
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://synq.vercel.app');
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    const evil = await call('https://evil.example', 'GET');
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const sock = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, { headers: { origin: 'https://evil.example' } });
    assert.notEqual(sock.headers.get('access-control-allow-origin'), 'https://evil.example');
  } finally {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the login cookie is SameSite=Lax by default; None forces Secure', async () => {
  const { Accounts } = await import('../src/accounts.js');
  const secret = 'x'.repeat(40);
  assert.match(new Accounts({ secret }).cookie('t'), /SameSite=Lax/);
  const none = new Accounts({ secret, sameSite: 'None' });
  assert.match(none.cookie('t'), /SameSite=None/);
  assert.match(none.cookie('t'), /Secure/);
  assert.match(none.clearCookie(), /SameSite=None; Secure/);
  assert.equal(loadConfig({ COOKIE_SAMESITE: 'none' }).cookieSameSite, 'None');
  assert.equal(loadConfig({}).cookieSameSite, 'Lax');
});
