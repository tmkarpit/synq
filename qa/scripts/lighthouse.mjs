// Phase 7: Lighthouse (desktop) on the production build (vite preview :4173 -> QA server).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import { addFile, closeDb, createUser, emitAck, ownerRoom, sleep } from './lib.mjs';

const host = await ownerRoom('LhHost');
await emitAck(host.socket, 'room:settings', { approval: false });
addFile(host.doc, { name: 'main.js', content: 'console.log("hello")\n' });
await sleep(800);
const u = await createUser('Lighthouse');
const chrome = chromium.executablePath();
const base = process.env.LH_BASE || 'http://127.0.0.1:4100';
const pages = { landing: `${base}/`, privacy: `${base}/privacy`, room: `${base}/room/${host.roomId}` };
const rows = {};
for (const [name, url] of Object.entries(pages)) {
  const out = `logs/lighthouse-${name}.json`;
  execFileSync(process.execPath, [
    'node_modules/lighthouse/cli/index.js', url, '--preset=desktop', '--output=json', `--output-path=${out}`, '--quiet',
'--chrome-flags=--headless=new --no-sandbox',
    `--extra-headers=${JSON.stringify({ Cookie: u.cookie })}`, '--max-wait-for-load=60000',
  ], { stdio: 'inherit', env: { ...process.env, CHROME_PATH: chrome } });
  const r = JSON.parse(fs.readFileSync(out, 'utf8'));
  const score = (k) => Math.round(r.categories[k].score * 100);
  const failing = Object.values(r.audits)
    .filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual')
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((a) => `${a.id}: ${a.displayValue || a.title}`);
  rows[name] = {
    performance: score('performance'), accessibility: score('accessibility'), bestPractices: score('best-practices'), seo: score('seo'),
    LCP: r.audits['largest-contentful-paint'].displayValue, TBT: r.audits['total-blocking-time'].displayValue, CLS: r.audits['cumulative-layout-shift'].displayValue,
    transferKB: Math.round(r.audits['total-byte-weight'].numericValue / 1024), topIssues: failing,
  };
}
console.log(JSON.stringify(rows, null, 1));
host.socket.close();
await closeDb();
process.exit(0);
