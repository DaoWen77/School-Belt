const base='http://127.0.0.1:3000/api/v1';
(async()=>{
 const l=await (await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handle:'founder',password:'Dijiang#2026'})})).json();
 if(!l.ok){console.log('LOGIN',JSON.stringify(l));return;}
 const h={authorization:'Bearer '+l.data.accessToken,'content-type':'application/json'};
 const bots=await (await fetch(base+'/bots',{headers:h})).json();
 console.log('BOTS',bots.data?.bots?.map(b=>({name:b.name,id:b.id,model:b.model,keyMasked:b.keyMasked})));
 const ch=await (await fetch(base+'/channels',{headers:h})).json();
 const channel=ch.data.channels.find(c=>c.slug==='general');
 console.log('CHANNEL',channel.id);
 const cb=await (await fetch(base+'/channels/'+channel.id+'/bots',{headers:h})).json();
 console.log('CHANNEL_BOTS',cb.data?.bots?.map(b=>b.name));
 const created=await (await fetch(base+'/bots',{method:'POST',headers:h,body:JSON.stringify({name:'验收协议官',systemPrompt:'你是验收用的协议官。',model:'mock-gpt'})})).json();
 console.log('CREATE',JSON.stringify(created).slice(0,300));
 if(!created.ok)return;
 const botId=created.data.bot.id;
 const add=await fetch(base+'/channels/'+channel.id+'/members',{method:'POST',headers:h,body:JSON.stringify({userIds:[botId]})});
 console.log('ADD_MEMBER',add.status,(await add.text()).slice(0,160));
 const r=await fetch(base+'/ai/chat',{method:'POST',headers:h,body:JSON.stringify({channelId:channel.id,body:'@验收协议官 你好',botId})});
 console.log('CHAT_STATUS',r.status,r.headers.get('content-type'));
 const text=await r.text();
 console.log('SSE',text.split('\n').slice(0,8).join(' | ').slice(0,500));
 const del=await fetch(base+'/bots/'+botId,{method:'DELETE',headers:h});
 console.log('DELETE',del.status,await del.text());
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
