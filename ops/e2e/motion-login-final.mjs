import { chromium } from 'playwright-core';
const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://localhost:3100/login',{waitUntil:'networkidle'});await p.waitForTimeout(1300);
await p.screenshot({path:'E:/项目/O.M.V帝江号全域广播/reports/frontend/motion-login-final-1440.png'});
const btn=p.locator('form button[type=submit]');await btn.hover();await p.waitForTimeout(300);
await p.screenshot({path:'E:/项目/O.M.V帝江号全域广播/reports/frontend/motion-button-hover-1440.png'});
const cs=await btn.evaluate(e=>{const s=getComputedStyle(e);return{bg:s.backgroundImage||s.backgroundColor,transform:s.transform,color:s.color}});console.log('BUTTON_HOVER',JSON.stringify(cs));
await b.close();
