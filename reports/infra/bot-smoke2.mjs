const base='http://127.0.0.1:3000/api/v1';
(async()=>{
 const l=await (await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'founder',password:'Dijiang#2026'})})).json();
 const h={authorization:'Bearer '+l.data.accessToken,'content-type':'application/json'};
 const bots=await (await fetch(base+'/bots',{headers:h})).json();
 const bot=bots.data.bots.find(b=>b.name==='验收协议官')||bots.data.bots[0];
 const ch=await (await fetch(base+'/channels',{headers:h})).json();
 const channel=ch.data.channels.find(c=>c.slug==='general');
 const add=await fetch(base+'/channels/'+channel.id+'/members',{method:'POST',headers:h,body:JSON.stringify({userId:bot.id})});
 console.log('ADD_MEMBER',add.status,(await add.text()).slice(0,160));
 const cb=await (await fetch(base+'/channels/'+channel.id+'/bots',{headers:h})).json();
 console.log('CHANNEL_BOTS',cb.data?.bots?.map(b=>b.name));
 const r=await fetch(base+'/ai/chat',{method:'POST',headers:h,body:JSON.stringify({channelId:channel.id,body:'@'+bot.name+' 你好',botId:bot.id})});
 console.log('CHAT_STATUS',r.status);
 const text=await r.text();
 console.log('SSE',text.slice(0,600));
 const del=await fetch(base+'/bots/'+bot.id,{method:'DELETE',headers:{authorization:h.authorization}});
 console.log('DELETE',del.status,(await del.text()).slice(0,120));
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
