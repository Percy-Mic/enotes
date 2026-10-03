const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const targets = [
  { name: 'local', baseURL: 'http://127.0.0.1:3000' },
  { name: 'production', baseURL: 'https://enotes-amber.vercel.app' },
];

const publicRoutes = [
  '/',
  '/contact',
  '/privacy',
  '/terms',
  '/feed',
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/forgot-password',
];

const protectedRoutes = [
  '/dashboard',
  '/journals',
  '/messages',
  '/notifications',
  '/settings',
  '/communities',
  '/studio',
  '/studio/video',
  '/notes',
];

const failures = [];
const evidence = [];

function record(item) {
  evidence.push(item);
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function observePage(page, label) {
  const body = await page.locator('body').innerText().catch(() => '');
  const buttons = await page.locator('button').evaluateAll((els) =>
    els.slice(0, 120).map((el) => ({
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      disabled: el.hasAttribute('disabled'),
    }))
  ).catch(() => []);
  const inputs = await page.locator('input').evaluateAll((els) =>
    els.slice(0, 50).map((el) => ({
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      aria: el.getAttribute('aria-label'),
    }))
  ).catch(() => []);
  record({
    label,
    url: page.url(),
    title: await page.title().catch(() => ''),
    bodySample: body.slice(0, 800),
    buttons,
    inputs,
  });
}

for (const target of targets) {
  test.describe.serial(target.name, () => {
    test('public routes load and protected routes redirect', async ({ browser }) => {
      const context = await browser.newContext({ baseURL: target.baseURL });
      const page = await context.newPage();
      const requestErrors = [];
      page.on('requestfailed', (req) => {
        requestErrors.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          record({ label: target.name + ' console error', text: msg.text().slice(0, 500) });
        }
      });

      for (const route of publicRoutes) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await settle(page);
        const status = response?.status() ?? 0;
        const finalUrl = page.url();
        const signin = new URL('/auth/sign-in', target.baseURL).toString();
        const allowed = status >= 200 && status < 400 && !finalUrl.includes('/auth/sign-in?redirect=/');
        record({ kind: 'public-route', target: target.name, route, status, finalUrl });
        if (!allowed) failures.push({ target: target.name, route, issue: 'public route did not load cleanly', status, finalUrl });
      }

      for (const route of protectedRoutes) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await settle(page);
        const status = response?.status() ?? 0;
        const finalUrl = page.url();
        const parsed = new URL(finalUrl);
        const isSignIn = parsed.pathname === '/auth/sign-in' && parsed.searchParams.get('redirect') === route;
        record({ kind: 'protected-route', target: target.name, route, status, finalUrl });
        if (target.name === 'production' || status || finalUrl) {
          if (!isSignIn) failures.push({ target: target.name, route, issue: 'protected route did not redirect to sign-in with redirect param', status, finalUrl });
        }
      }

      if (requestErrors.length) {
        record({ kind: 'request-errors', target: target.name, requestErrors });
      }
      await context.close();
    });

    test('auth edge inputs, rapid clicks, and reloads', async ({ browser }) => {
      const context = await browser.newContext({ baseURL: target.baseURL });
      const page = await context.newPage();
      const requestErrors = [];
      page.on('requestfailed', (req) => requestErrors.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' }));
      page.on('pageerror', (err) => record({ kind: 'pageerror', target: target.name, text: err.message }));

      await page.goto('/auth/sign-in', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);
      await observePage(page, target.name + ' sign-in initial');

      const email = page.locator('input[type="email"]').first();
      const password = page.locator('input[type="password"]').first();
      const submit = page.locator('form button[type="submit"]').first();

      await email.fill('not-an-email').catch(() => {});
      await submit.click().catch(() => {});
      await page.waitForTimeout(300);
      await expect(email).toBeVisible();

      await email.fill('playtest.invalid.20261004@example.invalid');
      await password.fill('DefinitelyWrongPassword!123');
      await Promise.all([
        submit.click().catch(() => {}),
        submit.click().catch(() => {}),
        submit.click().catch(() => {}),
      ]);
      await page.waitForTimeout(1200);
      const body = await page.locator('body').innerText();
      record({ kind: 'auth-invalid', target: target.name, bodySample: body.slice(-900) });

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);
      await expect(email).toBeVisible();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);

      await page.goto('/auth/sign-up', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);
      await observePage(page, target.name + ' sign-up initial');

      const username = page.locator('input').filter({ has: undefined }).nth(0);
      const allInputs = await page.locator('input').evaluateAll((els) => els.map((e) => ({ type: e.type, name: e.getAttribute('name') })));
      record({ kind: 'sign-up-inputs', target: target.name, inputs: allInputs });

      if (requestErrors.length) record({ kind: 'auth-request-errors', target: target.name, requestErrors });
      await context.close();
    });

    test('authenticated read-only surface when a dedicated test account is configured', async ({ browser }) => {
      test.skip(!process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD, 'No E2E_TEST_EMAIL/E2E_TEST_PASSWORD repository secrets configured');

      const context = await browser.newContext({ baseURL: target.baseURL });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
      page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + (req.failure()?.errorText || 'unknown')));

      await page.goto('/auth/sign-in', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);
      await page.locator('input[type="email"]').fill(process.env.E2E_TEST_EMAIL);
      await page.locator('input[type="password"]').fill(process.env.E2E_TEST_PASSWORD);
      await page.locator('form button[type="submit"]').click();
      await page.waitForTimeout(1800);

      const parsed = new URL(page.url());
      if (parsed.pathname === '/auth/sign-in') {
        failures.push({ target: target.name, route: '/auth/sign-in', issue: 'configured E2E account could not sign in', url: page.url(), body: (await page.locator('body').innerText()).slice(-900) });
        await context.close();
        return;
      }

      const authRoutes = [
        '/dashboard','/feed','/messages','/notifications','/settings','/communities','/studio','/studio/video','/notes'
      ];

      for (const route of authRoutes) {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await settle(page);
        await observePage(page, target.name + ' authenticated ' + route);
        if (page.url().includes('/auth/sign-in')) {
          failures.push({ target: target.name, route, issue: 'signed-in user was bounced back to sign-in', url: page.url() });
        }

        const before = await page.locator('body').innerText();
        const clickable = page.locator('button:visible').filter({ hasText: /.+/ });
        const count = Math.min(await clickable.count(), 4);
        for (let i = 0; i < count; i++) {
          await clickable.nth(i).click({ timeout: 1500 }).catch(() => {});
        }
        await page.waitForTimeout(300);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
        await settle(page);
        const after = await page.locator('body').innerText();
        record({ kind: 'rapid-reload', target: target.name, route, changed: before !== after });
      }

      await page.goto('/studio/video', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);
      await observePage(page, target.name + ' video editor empty state');

      const play = page.getByRole('button', { name: 'Play', exact: true });
      await Promise.all([play.click().catch(() => {}), play.click().catch(() => {}), play.click().catch(() => {})]);
      await page.waitForTimeout(350);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await settle(page);

      // Exercise non-destructive tool drawers without adding media.
      for (const label of ['Effects', 'Text', 'Add overlay', 'Adjust']) {
        const button = page.getByRole('button', { name: label, exact: true }).first();
        if (await button.count()) {
          await button.click().catch(() => {});
          await page.waitForTimeout(250);
          const close = page.getByRole('button', { name: 'Close tools', exact: true });
          if (await close.count()) await close.click().catch(() => {});
        }
      }

      if (errors.length) {
        record({ kind: 'authenticated-errors', target: target.name, errors: errors.slice(0, 80) });
        failures.push({ target: target.name, route: '/studio/video', issue: 'runtime/page/request errors observed', errors: errors.slice(0, 20) });
      }

      await context.close();
    });
  });
}

test.afterAll(async () => {
  fs.mkdirSync(path.join(process.cwd(), 'playtest-results'), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), 'playtest-results', 'evidence.json'),
    JSON.stringify({ failures, evidence }, null, 2)
  );
  if (failures.length) {
    throw new Error('Observed playtest defects: ' + JSON.stringify(failures.slice(0, 30), null, 2));
  }
});
