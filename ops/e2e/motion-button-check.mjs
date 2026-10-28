import { chromium } from 'playwright-core';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://localhost:3100/login',{waitUntil:'networkidle'});await p.waitForTimeout(900);
await p.fill('input[autocomplete=username]','founder');await p.fill('input[type=password]','Dijiang#2026');
const btn=p.locator('form button[type=submit]');await btn.hover();await p.waitForTimeout(350);
await p.screenshot({path:'E:/项目/O.M.V工作台全域广播/reports/frontend/motion-button-hover-1440.png'});
const info=await btn.evaluate(e=>{const s=getComputedStyle(e);return{disabled:e.disabled,bgi:s.backgroundImage,bg:s.backgroundColor,color:s.color,transform:s.transform,after:getComputedStyle(e,'::after').transform}});console.log('BUTTON',JSON.stringify(info));
await b.close();
