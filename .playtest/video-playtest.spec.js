const { test, expect } = require('@playwright/test');

test('real-surface smoke and careless sign-in attempt', async ({ page }) => {
  const errors = [];
  const failedRequests = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', req => failedRequests.push(req.url() + ' :: ' + (req.failure()?.errorText || 'failed')));
  page.on('response', res => {
    const url = res.url();
    if (res.request().resourceType() === 'script' && res.status() >= 300) {
      errors.push('script response ' + res.status() + ': ' + url);
    }
  });

  await page.goto('http://127.0.0.1:3000/auth/sign-in', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  const email = page.locator('input[type="email"]');
  const password = page.locator('input[type="password"]');
  await expect(email).toHaveCount(1);
  await expect(password).toHaveCount(1);

  await page.goto('http://127.0.0.1:3000/studio/video', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/auth\/sign-in/);

  await email.fill('not-a-real-user');
  await password.fill('');
  const buttons = page.locator('button');
  if (await buttons.count()) {
    await buttons.last().click().catch(() => {});
    await buttons.last().click().catch(() => {});
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('input[type="email"]')).toHaveCount(1);
  await expect(page.locator('input[type="password"]')).toHaveCount(1);

  console.log(JSON.stringify({
    observedConsoleErrors: errors,
    observedFailedRequests: failedRequests,
    protectedRoute: 'redirected-to-sign-in',
    invalidInputAttempt: 'completed',
    rapidClickAndReload: 'completed'
  }, null, 2));
});