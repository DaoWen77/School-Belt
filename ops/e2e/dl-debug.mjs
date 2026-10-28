import { chromium } from 'playwright-core';
const API='http://127.0.0.1:3000/api/v1';
const login=await fetch(API+'/belt/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'qiu',password:'Dijiang#2026'})});
const t=(await login.json()).data;
const b=await chromium.launch({channel:'chrome',headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
await ctx.addInitScript(tk=>{localStorage.setItem('dj.belt.access',tk.a);localStorage.setItem('dj.belt.refresh',tk.r);},{a:t.accessToken,r:t.refreshToken});
const p=await ctx.newPage();
p.on('dialog',async d=>{console.log('DIALOG',d.type(),d.message());await d.dismiss();});
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200));});
p.on('response',r=>{if(r.url().includes('/download/'))console.log('DL-RESP',r.status(),r.url().slice(0,110));});
p.on('download',d=>console.log('DOWNLOAD EVENT',d.suggestedFilename()));
await p.goto('http://localhost:3100/belt/channel',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(2500);
const cards=p.locator('.belt-file-card');
console.log('cards',await cards.count());
if(await cards.count()){await p.locator('.belt-file-card',{hasText:'演示材料.pptx'}).last().click();await p.waitForTimeout(4000);}
await b.close();
