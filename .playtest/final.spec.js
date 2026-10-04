const { test, expect, chromium } = require('@playwright/test');
test.setTimeout(90000);

const publicRoutes=['/','/contact','/privacy','/terms','/feed','/posts/not-a-real-post','/posts/not-a-real-post/comments','/auth/sign-in','/auth/sign-up','/auth/forgot-password','/auth/update-password','/auth/callback'];
const protectedRoutes=['/admin','/admin/reports','/admin/templates','/communities','/communities/new','/communities/not-a-real-community','/dashboard','/dashboard/create-journal','/journals','/journals/not-a-real-journal','/journals/not-a-real-journal/edit','/journals/not-a-real-journal/settings','/messages','/messages/new','/messages/not-a-real-message','/notes','/notes/not-a-real-note','/notifications','/search','/settings','/settings/billing','/settings/profile','/stories/new','/studio','/studio/admin','/studio/sounds','/studio/templates','/studio/video','/videos','/u/not-a-real-user','/users/not-a-real-user/followers','/users/not-a-real-user/following'];
const apiRoutes=['/api/billing/checkout','/api/billing/webhook','/api/gifs','/api/live/end','/api/push/send','/api/stock/videos','/api/studio/import-sounds','/api/studio/jamendo','/api/studio/sounds','/api/studio/stock-videos','/api/video/ai','/api/video/cloudinary'];
const utilityRoutes=['/sitemap.xml','/robots.txt','/manifest.webmanifest'];
const base='https://enotes-amber.vercel.app';

async function make(viewport){
  const browser=await chromium.launch();
  const context=await browser.newContext({viewport});
  const page=await context.newPage();
  return {browser,context,page};
}
async function close(x){await x.context.close(); await x.browser.close();}

for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  test('production public routes '+viewport.width,async()=>{
    const x=await make(viewport);
    for(const route of publicRoutes){
      const r=await x.page.goto(base+route,{waitUntil:'domcontentloaded',timeout:8000}).catch(()=>null);
      const status=r?.status()||0;
      const finalPath=new URL(x.page.url()).pathname;
      console.log(JSON.stringify({route,status,finalPath}));
      expect(status).toBeLessThan(500);
      const expectedAuthFallback = route==='/auth/callback' || route==='/auth/update-password';
      if(expectedAuthFallback) expect(finalPath).toBe('/auth/sign-in');
      else expect(finalPath).not.toBe('/auth/sign-in');
    }
    await close(x);
  });
  test('production protected routes incl journal '+viewport.width,async()=>{
    const x=await make(viewport);
    for(const route of protectedRoutes){
      await x.page.goto(base+route,{waitUntil:'domcontentloaded',timeout:8000}).catch(()=>null);
      const u=new URL(x.page.url());
      expect(u.pathname).toBe('/auth/sign-in');
      expect(u.searchParams.get('redirect')).toBe(route);
    }
    await close(x);
  });
}
test('production service worker and utilities',async()=>{
  const x=await make({width:1440,height:900});
  const sw=await x.page.request.get(base+'/sw.js',{timeout:10000,maxRedirects:0});
  console.log(JSON.stringify({swStatus:sw.status(),swLocation:sw.headers()['location']||null,swType:sw.headers()['content-type']||null}));
  expect(sw.status()).toBe(200);
  const text=await sw.text();
  expect(text).toContain('self.addEventListener');
  expect(text).not.toContain('<!DOCTYPE html>');
  const ct=sw.headers()['content-type']||'';
  expect(ct).toContain('application/javascript');
  for(const route of utilityRoutes){
    const r=await x.page.request.get(base+route,{timeout:10000});
    expect(r.status()).toBeLessThan(500);
  }
  for(const route of apiRoutes){
    const r=await x.page.request.get(base+route,{timeout:10000});
    expect(r.status()).toBeLessThan(500);
  }
  await close(x);
});
test('careless auth interaction and rapid reload',async()=>{
  const x=await make({width:390,height:844});
  await x.page.goto(base+'/auth/sign-in',{waitUntil:'domcontentloaded',timeout:8000});
  await x.page.locator('input[type=email]').fill('bad');
  await x.page.locator('form button[type=submit]').click().catch(()=>{});
  await x.page.locator('input[type=email]').fill('playtest.invalid.20261004@example.invalid');
  await x.page.locator('input[type=password]').fill('wrong-password');
  await Promise.all([1,2,3].map(()=>x.page.locator('form button[type=submit]').click().catch(()=>{})));
  await Promise.all([1,2].map(()=>x.page.reload({waitUntil:'domcontentloaded',timeout:8000}).catch(()=>{})));
  await expect(x.page.locator('input[type=email]')).toBeVisible();
  await close(x);
});
