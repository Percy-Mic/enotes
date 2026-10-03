const { test, expect, chromium } = require('@playwright/test');
test.setTimeout(180000);
const fs = require('fs');

const targets = [
  { name: 'production', baseURL: 'https://enotes-amber.vercel.app' },
];

const publicRoutes = [
  '/',
  '/contact',
  '/privacy',
  '/terms',
  '/feed',
  '/posts/not-a-real-post',
  '/posts/not-a-real-post/comments',
  '/auth/sign-in',
  '/auth/sign-up',
  '/auth/forgot-password',
  '/auth/update-password',
];

const protectedRoutes = [
  '/admin',
  '/admin/reports',
  '/admin/templates',
  '/communities',
  '/communities/new',
  '/communities/not-a-real-community',
  '/dashboard',
  '/dashboard/create-journal',
  '/journals',
  '/journals/not-a-real-journal',
  '/journals/not-a-real-journal/edit',
  '/journals/not-a-real-journal/settings',
  '/messages',
  '/messages/new',
  '/messages/not-a-real-message',
  '/notes',
  '/notes/not-a-real-note',
  '/notifications',
  '/search',
  '/settings',
  '/settings/billing',
  '/settings/profile',
  '/stories/new',
  '/studio',
  '/studio/admin',
  '/studio/sounds',
  '/studio/templates',
  '/studio/video',
  '/videos',
  '/u/not-a-real-user',
  '/users/not-a-real-user/followers',
  '/users/not-a-real-user/following',
];

const apiRoutes = [
  '/api/billing/checkout',
  '/api/billing/webhook',
  '/api/gifs',
  '/api/live/end',
  '/api/push/send',
  '/api/stock/videos',
  '/api/studio/import-sounds',
  '/api/studio/jamendo',
  '/api/studio/sounds',
  '/api/studio/stock-videos',
  '/api/video/ai',
  '/api/video/cloudinary',
];

const failures = [];
const evidence = [];
function rec(x){ evidence.push(x); }

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', {timeout:15000}).catch(()=>{});
  await page.waitForTimeout(450);
}

async function scan(page, label) {
  const body = await page.locator('body').innerText().catch(()=> '');
  const visibleText = body.replace(/\s+/g,' ').trim();
  const pageErrors=[];
  const consoleErrors=[];
  const requestErrors=[];
  const links=await page.locator('a:visible').evaluateAll(els=>els.slice(0,80).map(a=>({text:(a.textContent||'').trim().slice(0,80),href:a.getAttribute('href')}))).catch(()=>[]);
  rec({label,url:page.url(),title:await page.title().catch(()=>''),body:visibleText.slice(0,1000),links});
  return {pageErrors,consoleErrors,requestErrors};
}

async function testRoutes(target, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: target.baseURL, viewport });
  const page = await context.newPage();
  const consoleErrors=[];
  const pageErrors=[];
  const requestErrors=[];
  page.on('console',m=>{ if(m.type()==='error') consoleErrors.push(m.text().slice(0,500)); });
  page.on('pageerror',e=>pageErrors.push(e.message.slice(0,500)));
  page.on('requestfailed',r=>requestErrors.push({url:r.url(),error:r.failure()?.errorText||'unknown'}));

  for (const route of publicRoutes) {
    const response=await page.goto(route,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>null);
    await settle(page);
    const status=response?.status()||0;
    const final=new URL(page.url());
    rec({kind:'route',target:target.name,viewport,route,status,finalUrl:page.url()});
    // Public dynamic pages may legitimately return 404; they must not auth-redirect.
    if (final.pathname==='/auth/sign-in' && route!=='/auth/sign-in') {
      failures.push({target:target.name,viewport,route,issue:'public route redirected to sign-in unexpectedly',url:page.url()});
    }
    if (status>=500) failures.push({target:target.name,viewport,route,issue:'public route returned server error',status});
  }

  for (const route of protectedRoutes) {
    const response=await page.goto(route,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>null);
    await settle(page);
    const status=response?.status()||0;
    const final=new URL(page.url());
    rec({kind:'protected-route',target:target.name,viewport,route,status,finalUrl:page.url()});
    const redirected=final.pathname==='/auth/sign-in' && final.searchParams.get('redirect')===route;
    if (!redirected) failures.push({target:target.name,viewport,route,issue:'anonymous protected route did not redirect with exact redirect parameter',status,finalUrl:page.url()});
  }

  // Auth forms: native validation + bad credentials + reload while loading.
  await page.goto('/auth/sign-in',{waitUntil:'domcontentloaded',timeout:20000});
  await settle(page);
  await expect(page.locator('input[type=email]')).toBeVisible();
  const email=page.locator('input[type=email]');
  const password=page.locator('input[type=password]');
  const submit=page.locator('form button[type=submit]');
  await email.fill('bad');
  await submit.click().catch(()=>{});
  await email.fill('playtest.invalid.20261004@example.invalid');
  await password.fill('wrong-password-20261004');
  await Promise.all([submit.click().catch(()=>{}),submit.click().catch(()=>{}),submit.click().catch(()=>{})]);
  await page.waitForTimeout(1200);
  rec({kind:'bad-auth',target:target.name,viewport,body:(await page.locator('body').innerText()).slice(-900)});
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await settle(page);
  await expect(page.locator('input[type=email]')).toBeVisible();

  // Sign-up careless inputs.
  await page.goto('/auth/sign-up',{waitUntil:'domcontentloaded',timeout:20000});
  await settle(page);
  const inputs=page.locator('input');
  const counts=await inputs.count();
  for(let i=0;i<Math.min(counts,5);i++) await inputs.nth(i).fill('x').catch(()=>{});
  const signup=page.locator('form button[type=submit]').first();
  await signup.click().catch(()=>{});
  await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  await settle(page);

  // Public feed drill-down: click first internal-looking post/profile link without assuming data exists.
  await page.goto('/feed',{waitUntil:'domcontentloaded',timeout:20000});
  await settle(page);
  const feedLinks=await page.locator('a[href]').evaluateAll(els=>els.map(a=>a.getAttribute('href')).filter(Boolean).filter(h=>/^\/(posts|u)\//.test(h)).slice(0,4));
  rec({kind:'feed-drilldown-candidates',target:target.name,viewport,links:feedLinks});
  for(const href of feedLinks){
    await page.goto(href,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
    await settle(page);
    const body=(await page.locator('body').innerText()).replace(/\s+/g,' ').trim();
    if (body.length<10) failures.push({target:target.name,viewport,route:href,issue:'public drill-down rendered essentially empty'});
    if (page.url().includes('/auth/sign-in')) failures.push({target:target.name,viewport,route:href,issue:'public feed drill-down unexpectedly required sign-in'});
  }

  // Careless reloads on entry points.
  for(const route of ['/','/feed','/auth/sign-in','/studio/video']){
    await page.goto(route,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
    await Promise.all([page.reload({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{}),page.reload({waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{})]);
    await settle(page);
  }

  // API smoke: unauthenticated requests must not crash with 5xx.
  for(const route of apiRoutes){
    const resp=await page.request.get(route).catch(()=>null);
    const status=resp?.status()||0;
    rec({kind:'api-get',target:target.name,route,status});
    if(status>=500) failures.push({target:target.name,route,issue:'unauthenticated API GET returned 5xx',status});
  }

  if(consoleErrors.length||pageErrors.length||requestErrors.length){
    rec({kind:'browser-errors',target:target.name,viewport,consoleErrors:consoleErrors.slice(0,40),pageErrors:pageErrors.slice(0,40),requestErrors:requestErrors.slice(0,40)});
  }

  await context.close();
  await browser.close();
}

test.describe.configure({ mode:'serial' });
for(const target of targets){
  test(target.name+' desktop full surface', async()=>{ await testRoutes(target,{width:1440,height:900}); });
  test(target.name+' mobile full surface', async()=>{ await testRoutes(target,{width:390,height:844}); });
}

test.afterAll(async()=>{
  fs.mkdirSync('playtest-results',{recursive:true});
  fs.writeFileSync('playtest-results/evidence.json',JSON.stringify({failures,evidence},null,2));
  if(failures.length) throw new Error('Observed defects:\n'+JSON.stringify(failures.slice(0,50),null,2));
});
