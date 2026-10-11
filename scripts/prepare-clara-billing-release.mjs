import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseAst } from 'rolldown/parseAst';
import { build } from 'vite';

// Keep the published scheduling code byte-for-byte. Replace only Auth, Team
// and Subscription with reviewed source; the fixed sidebar/logout is the base.
const mode=process.argv[2] || 'production';
assert.ok(['production','test'].includes(mode));
const releaseId=process.argv[3] || '20261007-ready-v1';
assert.match(releaseId,/^[a-z0-9-]+$/);
const baseline='.local/vercel/clara-logout-fixed-sidebar-20261007';
const target=`.local/vercel/clara-billing-${mode}-${releaseId}`;
const oldJs='index-clara-badfb0cc0214910c.js';
const oldCss='index-clara-0a6f6d530535f189.css';
const mainName=`clara-base-${releaseId}.js`;
const hash=x=>createHash('sha256').update(x).digest('hex');
const productionUrl='https://gtqcehwvddvqllicnreu.supabase.co';
const productionKey='sb_publishable_LNIhSp1x9e-xsPUV8dWMZw_gzxhswD-';
const testConfig=JSON.parse(await readFile('.local/stripe/clara-test-config.json','utf8'));
const original=await readFile(join(baseline,'assets',oldJs),'utf8');
assert.equal(hash(original).slice(0,16),'badfb0cc0214910c');
const originalCss=await readFile(join(baseline,'assets',oldCss),'utf8');
assert.equal(hash(originalCss).slice(0,16),'0a6f6d530535f189');
const authSource=await readFile('src/main.jsx','utf8');
const authStart=authSource.indexOf('function Auth(');
const authEnd=authSource.indexOf('\nfunction Onboarding(',authStart);
assert.ok(authStart>0 && authEnd>authStart);
const auth=authSource.slice(authStart,authEnd);
let team=await readFile('src/Team.jsx','utf8');
assert.equal(team.split('import Resources from "./Resources";').length,2);
team=team.replace('import Resources from "./Resources";','');
const resources=/      <Resources\r?\n[\s\S]*?      \/>/;
assert.equal((team.match(new RegExp(resources.source,'g'))||[]).length,1);
team=team.replace(resources,'');
assert.ok(!team.includes('Resources'));
const sources={
 '\0clara-entry':`export { default as NewSubscription } from ${JSON.stringify(resolve('src/Subscription.jsx'))}; export { default as NewTeam } from 'clara-team'; export { default as NewAuth } from 'clara-auth';`,
 '\0clara-team.jsx':team,
 '\0clara-auth.jsx':`import React,{useState,useEffect,useRef} from 'react';
 import {supabase,query,errorMessage,Brand,BrandMark,Button,Field,fieldData,navigate} from 'clara-existing';
 import {CalendarDays,Users,Wallet,Leaf,Mail,ArrowRight,ArrowUpRight,ShieldCheck} from 'lucide-react';
 import claraWelcome from ${JSON.stringify(resolve('src/assets/clara-apontando-v1.webp'))};
 export default ${auth}`,
 '\0clara-react':`import {r as requireReact} from './react-FpO-Qvof.js'; const React=requireReact(); export default React; export const {useState,useEffect,useRef,useMemo,useCallback,useId,useLayoutEffect,useContext,createContext,createElement,forwardRef,memo,Fragment,Component}=React;`,
 '\0clara-jsx':`import {n as requireJsx} from './react-FpO-Qvof.js'; const runtime=requireJsx(); export const {jsx,jsxs,Fragment}=runtime;`,
 '\0clara-lib':`export {supabase,query,rpc,errorMessage,apiFetch} from 'clara-existing';`,
 '\0clara-brand':`export {Brand as default,BrandMark} from 'clara-existing';`
};
await mkdir(target,{recursive:false});
const compiled=await build({configFile:false,publicDir:false,logLevel:'error',define:{
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(mode==='test'?testConfig.supabaseStagingUrl:productionUrl),
 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(mode==='test'?testConfig.supabasePublishableKey:productionKey)
},plugins:[{
 name:'clara-reviewed-release', enforce:'pre',
 resolveId(id,importer){
  if(id==='clara-existing')return {id:'./'+mainName,external:true};
  if(id==='./react-FpO-Qvof.js')return {id,external:true};
  const map={'clara-entry':'\0clara-entry','clara-team':'\0clara-team.jsx','clara-auth':'\0clara-auth.jsx',react:'\0clara-react','react/jsx-runtime':'\0clara-jsx','./lib':'\0clara-lib','./Brand':'\0clara-brand'};
  if(map[id])return map[id];
  if(importer==='\0clara-team.jsx' && id.startsWith('./'))return resolve('src',id.endsWith('.css')?id:id+'.js');
 },
 load(id){return sources[id];}
}],build:{outDir:target,emptyOutDir:false,write:true,minify:true,cssCodeSplit:false,rolldownOptions:{input:'clara-entry',preserveEntrySignatures:'strict',output:{entryFileNames:'assets/clara-features-[hash].js',assetFileNames:'assets/[name]-[hash][extname]'}}}});
const output=compiled.output;
const entry=output.find(x=>x.type==='chunk'&&x.isEntry);
assert.ok(entry?.exports.includes('NewSubscription') && entry.exports.includes('NewAuth'));
const ast=parseAst(original);
const replacements=[['C','NewSubscription','Sua assinatura está ativa'],['M','NewTeam','Equipe do salão'],['Ln','NewAuth','Bom ter você por aqui.']].map(([name,newName,marker])=>{
 const n=ast.body.find(x=>x.type==='FunctionDeclaration'&&x.id.name===name);
 assert.ok(n && original.slice(n.start,n.end).includes(marker),`Unexpected ${name}`);
 return {start:n.start,end:n.end,replacement:`function ${name}(props){return (0,c.jsx)(${newName},props)}`,original:original.slice(n.start,n.end)};
});
let main=original;
for(const x of [...replacements].sort((a,b)=>b.start-a.start))main=main.slice(0,x.start)+x.replacement+main.slice(x.end);
let reversed=main;
for(const x of replacements)reversed=reversed.replace(x.replacement,x.original);
assert.equal(reversed,original,'Changes outside the three reviewed components');
main=`import {NewSubscription,NewTeam,NewAuth} from './${entry.fileName.split('/').pop()}';\n`+main+
 '\nexport {h as supabase,g as rpc,_ as query,p as errorMessage,m as apiFetch,x as Brand,b as BrandMark,Q as Button,$ as Field,An as fieldData,On as navigate};\n';
if(mode==='test')main=main.replaceAll(productionUrl,testConfig.supabaseStagingUrl).replaceAll(productionKey,testConfig.supabasePublishableKey);
assert.ok(!main.includes('owner_available_slots'));
parseAst(main);
for(const directory of ['','assets'])for(const item of await readdir(join(baseline,directory),{withFileTypes:true})){
 if(item.isDirectory())continue;
 if([oldJs,'index.html','vercel.json'].includes(item.name))continue;
 await copyFile(join(baseline,directory,item.name),join(target,directory,item.name));
}
await writeFile(join(target,'assets',mainName),main);
let html=(await readFile(join(baseline,'index.html'),'utf8')).replace(oldJs,mainName);
const css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css'));
html=html.replace('</head>',css.map(x=>`<link rel="stylesheet" href="/${x.fileName}">`).join('')+'</head>');
const settings=JSON.parse(await readFile(join(baseline,'vercel.json'),'utf8'));
if(mode==='test'){
 html=html.replace('</head>','<meta name="robots" content="noindex,nofollow"><style>body::before{content:"AMBIENTE DE TESTES · use apenas dados e cartões fictícios";position:fixed;top:0;left:0;right:0;text-align:center;background:#fff0c2;color:#593800;font:11px sans-serif;padding:5px;z-index:100000;pointer-events:none}</style></head>');
 settings.headers[0].headers.push({key:'X-Robots-Tag',value:'noindex, nofollow'});
}
await writeFile(join(target,'index.html'),html);
await writeFile(join(target,'vercel.json'),JSON.stringify(settings,null,2));
const files=[];
for(const directory of ['','assets'])for(const f of await readdir(join(target,directory),{withFileTypes:true})){
 if(!f.isFile())continue;
 const bytes=await readFile(join(target,directory,f.name));
 files.push({file:join(directory,f.name).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});
}
await writeFile(target+'.manifest.json',JSON.stringify({mode,releaseId,baseline,scope:['Auth with email resend','Subscription plans','Team limits','Visible logout and fixed sidebar'],schedulingChanged:false,files},null,2));
console.log(JSON.stringify({target,mode,files:files.length}));

