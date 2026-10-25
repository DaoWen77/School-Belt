const base='http://127.0.0.1:3000/api/v1';
(async()=>{
 const login=async h=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:h,password:'Dijiang#2026'})});return (await r.json()).data.accessToken};
 const ft=await login('founder'); const me=await (await fetch(base+'/me',{headers:{authorization:'Bearer '+ft}})).json();
 const id=me.data?.user?.avatarFileId||me.data?.avatarFileId; console.log('FOUNDER_AVATAR',id);
 const qt=await login('qiu');
 const r=await fetch(base+'/files/'+id+'/url',{headers:{authorization:'Bearer '+qt}});
 console.log('QIU_READ_FOUNDER_AVATAR',r.status,(await r.text()).slice(0,160));
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
