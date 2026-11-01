// Phase 7: every browser (Chromium, Firefox, Edge) and width loads the main pages without
// errors or sideways scrolling; keyboard focus is visible; reduced motion is respected.
import { test } from '@playwright/test';
import { closeDb, enterRoom, expect, loggedIn, openRoom } from './helpers.mjs';

test.afterAll(() => closeDb());

// Messages from Google's sign-in script (origin not registered for 127.0.0.1:5190) are
// expected in QA and are not SYNQ bugs.
const ignorable = (t) => /GSI_LOGGER|accounts\.google\.com|Failed to load resource|FedCM|origin is not allowed|identity provider|accounts list is empty/i.test(t);

for (const width of [1280, 1440, 1920]) {
  test(`P1 landing, login and join pages at ${width}px: no errors, no sideways scroll`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && errors.push(m.text()));
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/login', '/signup', '/join', '/privacy', '/terms', '/no-such-page']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  });
}

test('P2 a logged-in user can open a room and see the editor', async ({ browser }) => {
  const room = await openRoom({ files: [{ name: 'main.js', content: 'console.log("hi")' }] });
  const a = await loggedIn(browser, 'Smoke');
  await enterRoom(a.page, room.roomId);
  await expect(a.page.locator('.monaco-editor')).toBeVisible();
  expect(a.errors).toEqual([]);
});

test('P3 keyboard: Tab moves through the landing page with a visible focus indicator', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const s = getComputedStyle(el);
        const visible = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
        return { tag: el.tagName, text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30), visible };
      }),
    );
  }
  const reached = seen.filter((s) => s.tag !== 'BODY');
  expect(reached.length, 'Tab does not reach any control').toBeGreaterThan(3);
  const invisible = reached.filter((s) => !s.visible);
  expect(invisible, `focus not visible on: ${invisible.map((s) => s.text || s.tag).join(', ')}`).toEqual([]);
});

test('P4 prefers-reduced-motion: no CSS animations keep running on the landing page', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().iterations === Infinity)).length,
  );
  expect(running, `${running} endless animations still running with reduced motion`).toBe(0);
  await context.close();
});
