import { chromium } from 'playwright-core';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://localhost:3100/login',{waitUntil:'networkidle'});await p.waitForTimeout(900);
await p.fill('input[autocomplete=username]','founder');await p.fill('input[type=password]','Dijiang#2026');
await p.click('form button[type=submit]');
let seen=false;
for(let i=0;i<25;i++){await p.waitForTimeout(80);const c=await p.locator('.motion-wipe').count();if(c){seen=true;console.log('SEEN_AT_MS',i*80,'URL',p.url());await p.screenshot({path:'E:/项目/O.M.V工作台全域广播/reports/frontend/motion-wipe-1440.png'});break;}}
console.log('SEEN',seen,'SESSION',await p.evaluate(()=>sessionStorage.getItem('dj-login-wipe')));
await b.close();
