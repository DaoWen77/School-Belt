const fs=require('fs'),path=require('path');
const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);e.isDirectory()?walk(p):e.name.endsWith('.controller.ts')&&files.push(p)}})('server/src');
const out=[];
for(const f of files){const s=fs.readFileSync(f,'utf8');const cm=s.match(/@Controller\(([^)]*)\)/);const cls=cm?cm[1].trim().replace(/['"`]/g,''):'';const re=/@(Get|Post|Patch|Delete|Put)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;let m;while((m=re.exec(s))){out.push({file:f.replace(/\\/g,'/'),method:m[1].toUpperCase(),path:'/'+(cls?cls+'/':'')+(m[2]||'')})}}
fs.writeFileSync('reports/infra/routes.json',JSON.stringify(out,null,1),'utf8');
const by={};for(const x of out){const g=x.file.split('/').slice(2).join('/');by[g]=(by[g]||0)+1}
console.log('TOTAL',out.length,'FILES',files.length);console.log(by);
