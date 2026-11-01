// Cold start check: open the site while the server is down, expect "Waking up the server",
// start the server, expect the banner to go away. Needs the preview on :4173 and the
// server stopped. Usage: node scripts/waking-check.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const server = fileURLToPath(new URL('../../server', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/login');
const banner = page.getByText('Waking up the server');
await banner.waitFor({ timeout: 30_000 });
console.log('server down  -> banner shown:', await banner.isVisible());

const env = {
  ...process.env,
  NODE_ENV: 'production', PORT: '4300', MONGODB_URI: 'mongodb://127.0.0.1:27017/synq_test', MONGODB_IP_FAMILY: '',
  CLIENT_ORIGINS: 'http://127.0.0.1:4173', COOKIE_SECURE: 'false', TRUST_PROXY: '2', RUN_ENABLED: 'true',
  SHELL_ENABLED: 'false', OTP_DEV_LOG: 'false', STATIC_DIR: '/none', WORKSPACES_DIR: '../qa/workspaces', DATA_DIR: '../qa/data',
};
const t0 = Date.now();
const child = spawn(process.execPath, ['--env-file=.env', 'src/index.js'], { cwd: server, env, stdio: 'ignore' });
await banner.waitFor({ state: 'detached', timeout: 60_000 });
console.log(`server up    -> banner gone after ${((Date.now() - t0) / 1000).toFixed(1)}s, without reloading the page`);
const form = await page.getByRole('textbox', { name: 'Email' }).isVisible();
console.log('login form usable:', form);
await browser.close();
child.kill();
process.exit(0);
