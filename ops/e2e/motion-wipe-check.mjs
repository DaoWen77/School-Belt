import { chromium } from 'playwright-core';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://localhost:3100/login',{waitUntil:'networkidle'});await p.waitForTimeout(900);
await p.fill('input[autocomplete=username]','founder');await p.fill('input[type=password]','Dijiang#2026');await p.click('form button[type=submit]');
await p.waitForTimeout(440);
try{await p.waitForURL('http://localhost:3100/',{timeout:2000})}catch{}
await p.waitForTimeout(80);
const wipe=await p.locator('.motion-wipe').count();console.log('WIPE_NOW',wipe);
await p.screenshot({path:'E:/项目/O.M.V帝江号全域广播/reports/frontend/motion-wipe-1440.png'});
await b.close();
