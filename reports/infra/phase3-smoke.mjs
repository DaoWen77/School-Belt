const base='http://127.0.0.1:3000/api/v1';
(async()=>{
 const login=async h=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:h,password:'Dijiang#2026'})});return {status:r.status,json:await r.json()}};
 const o=await login('founder'); const t=o.json.data.accessToken; const h={authorization:'Bearer '+t,'content-type':'application/json'};
 const users=await (await fetch(base+'/users?limit=100',{headers:h})).json(); const chen=users.data.users.find(u=>u.handle==='chen'); console.log('USERS_STATUS',chen?.status);
 const ban=await fetch(base+'/users/'+chen.id+'/status',{method:'PATCH',headers:h,body:JSON.stringify({status:'suspended'})}); console.log('BAN',ban.status,(await ban.text()).slice(0,90));
 const c2=await login('chen'); console.log('CHEN_LOGIN_AFTER_BAN',c2.status,c2.json.error?.code);
 const unban=await fetch(base+'/users/'+chen.id+'/status',{method:'PATCH',headers:h,body:JSON.stringify({status:'active'})}); console.log('UNBAN',unban.status);
 const ann=await fetch(base+'/announcements',{method:'PUT',headers:h,body:JSON.stringify({body:'Phase3 全服公告验收',level:'info'})}); console.log('ANN_PUT',ann.status,(await ann.text()).slice(0,120));
 const cur=await (await fetch(base+'/announcements/current',{headers:h})).json(); console.log('ANN_GET',JSON.stringify(cur.data).slice(0,120));
 const ch=(await (await fetch(base+'/channels',{headers:h})).json()).data.channels.find(c=>c.slug==='general');
 const msgs=(await (await fetch(base+'/channels/'+ch.id+'/messages?limit=3',{headers:h})).json()).data.messages; const mid=msgs[0].id;
 const react=await fetch(base+'/messages/'+mid+'/reactions',{method:'POST',headers:h,body:JSON.stringify({emoji:'👍'})}); console.log('REACT',react.status,(await react.text()).slice(0,100));
 const pin=await fetch(base+'/messages/'+mid+'/pin',{method:'POST',headers:h}); console.log('PIN',pin.status,(await pin.text()).slice(0,100));
 const pins=await (await fetch(base+'/channels/'+ch.id+'/pins',{headers:h})).json(); console.log('PINS',pins.data?.pins?.length);
 const unpin=await fetch(base+'/messages/'+mid+'/pin',{method:'DELETE',headers:h}); console.log('UNPIN',unpin.status);
 const nc=await (await fetch(base+'/notifications/unread-count',{headers:h})).json(); console.log('NOTIF_UNREAD',JSON.stringify(nc.data));
 const create=await fetch(base+'/channels',{method:'POST',headers:h,body:JSON.stringify({name:'Phase3 审计频道',slug:'phase3-audit-'+Date.now().toString(36),visibility:'public'})}); const cj=await create.json(); console.log('CHANNEL_CREATE',create.status,cj.data?.id?'ok':JSON.stringify(cj).slice(0,120));
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
