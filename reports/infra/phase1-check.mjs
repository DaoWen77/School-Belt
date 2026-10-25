const base='http://127.0.0.1:3000/api/v1';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db00000000049454e44ae426082','hex');
(async()=>{
 const login=async h=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:h,password:'Dijiang#2026'})});const j=await r.json();if(!j.ok)throw new Error(h+' login '+r.status+' '+JSON.stringify(j).slice(0,120));return j.data.accessToken};
 const t=await login('founder'); const h={authorization:'Bearer '+t,'content-type':'application/json'};
 const ch=(await (await fetch(base+'/channels',{headers:h})).json()).data.channels.find(c=>c.slug==='general');
 const pre=await (await fetch(base+'/files/presign',{method:'POST',headers:h,body:JSON.stringify({channelId:ch.id,filename:'phase1-lan.png',mime:'image/png',size:png.length})})).json();
 const p=pre.data?.presign??pre.data; console.log('PRESIGN_HOST',new URL(p.uploadUrl).host);
 const put=await fetch(p.uploadUrl,{method:'PUT',headers:p.headers||{'content-type':'image/png'},body:png});
 console.log('PUT',put.status);
 const comp=await (await fetch(base+'/files/'+p.fileId+'/complete',{method:'POST',headers:h,body:JSON.stringify({})})).json();
 console.log('COMPLETE',comp.ok,comp.data?.status||comp.error?.code);
 const u=await (await fetch(base+'/files/'+p.fileId+'/url',{headers:h})).json(); console.log('GETURL_HOST',new URL(u.data.url).host);
 const got=Buffer.from(await (await fetch(u.data.url)).arrayBuffer()); console.log('GET_BYTES',got.length,'EQUAL',got.equals(png));
 const msgs=(await (await fetch(base+'/channels/'+ch.id+'/messages?limit=5',{headers:h})).json()).data.messages;
 const target=msgs.find(m=>!m.deletedAt);
 const sent=await (await fetch(base+'/channels/'+ch.id+'/messages',{method:'POST',headers:h,body:JSON.stringify({clientMsgId:crypto.randomUUID(),kind:'text',body:'[phase1] 引用验证',replyToId:target.id})})).json();
 console.log('REPLY_SEND',sent.ok,JSON.stringify(sent.data?.message?.replyTo??sent.error));
 const qiu=await login('qiu'); const me=await (await fetch(base+'/me',{headers:{authorization:'Bearer '+t}})).json();
 if(me.data?.avatarFileId){const ar=await fetch(base+'/files/'+me.data.avatarFileId+'/url',{headers:{authorization:'Bearer '+qiu}});console.log('AVATAR_ACL',ar.status,(await ar.text()).slice(0,120));}
})().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
