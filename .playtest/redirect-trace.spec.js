const { test, chromium } = require('@playwright/test');
test.setTimeout(60000);
test('trace production root resource redirects and browser errors',async()=>{
  const browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const redirects=[]; const errors=[]; const scripts=[]; const allRequests=[];
  page.on('console',m=>{ if(m.type()==='error') errors.push(m.text()); });
  page.on('requestfailed',r=>errors.push('requestfailed '+r.url()+' '+(r.failure()?.errorText||'')));
  page.on('request',r=>{ allRequests.push({type:r.resourceType(),url:r.url(),redirectedFrom:r.redirectedFrom()?.url()||null}); });
  page.on('response',r=>{
    if(r.status()>=300 && r.status()<400) redirects.push({status:r.status(),url:r.url(),location:r.headers()['location']||''});
    if(r.request().resourceType()==='script') scripts.push({status:r.status(),url:r.url(),redirectedFrom: r.request().redirectedFrom()?.url()||null});
  });
  const res=await page.goto('https://enotes-amber.vercel.app/',{waitUntil:'networkidle',timeout:20000}).catch(()=>null);
  await page.waitForTimeout(1000);
  const scriptTags=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src));
  const sw=await page.evaluate(async()=>{const regs=await navigator.serviceWorker.getRegistrations(); return {registrations:regs.map(r=>({scope:r.scope,scriptURL:r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||null,state:r.active?.state||r.installing?.state||r.waiting?.state||null})),controller:navigator.serviceWorker.controller?.scriptURL||null};});
  const swResponse=await page.request.get('https://enotes-amber.vercel.app/sw.js',{timeout:10000}).catch(()=>null);
  const swText=swResponse ? (await swResponse.text()).slice(0,300) : '';
  console.log(JSON.stringify({status:res?.status()||0,url:page.url(),redirects,errors,scripts,scriptTags,sw,swStatus:swResponse?.status()||0,swText,allRequests:allRequests.filter(x=>x.url.includes('/sw.js')).slice(0,10)},null,2));
  await context.close(); await browser.close();
  if(errors.length||redirects.length) throw new Error(JSON.stringify({redirects,errors},null,2));
});

// rerun after middleware PWA service-worker exemption
