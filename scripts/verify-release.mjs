import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const env=Object.fromEntries((await readFile('.env.local','utf8')).split(/\r?\n/).filter(x=>x.trim()&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const origin='https://minhaclara.com';
const report=[];
const root=await fetch(origin,{signal:AbortSignal.timeout(20000)});
assert.equal(root.status,200);
assert.ok(root.headers.get('content-security-policy'));
assert.ok(root.headers.get('strict-transport-security'));
const local=await readFile((process.argv[2] || 'dist')+'/index.html','utf8');
const script=local.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
assert.ok((await root.text()).includes(script));
const bundle=await fetch(origin+script,{signal:AbortSignal.timeout(20000)});
assert.equal(bundle.status,200);assert.match(bundle.headers.get('cache-control'),/immutable/);
report.push({check:'published_build_and_headers',ok:true,script});
if(process.argv[2]){
 const manifest=JSON.parse(await readFile(process.argv[2]+'.manifest.json','utf8'));
 assert.equal(manifest.mode,'production');
 for(const file of manifest.files.filter(x=>x.file!=='vercel.json')){
  const response=await fetch(origin+'/'+file.file,{signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200,file.file);
  const hash=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  assert.equal(hash,file.sha256,file.file);
 }
 report.push({check:'all_published_assets_match_manifest',ok:true,files:manifest.files.length-1});
}
for(const [name,body,expected] of [['booking',{action:'booking_page',args:{p_slug:'verificacao-clara-deploy-inexistente'}},200],['billing',{action:'status'},401],['clara',{message:'smoke'},401],['stripe-webhook',{},400]]){
 const response=await fetch(env.VITE_SUPABASE_URL+'/functions/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,expected,name);
 const value=await response.json();
 if(name==='booking')assert.equal(value.data,null,'unknown catalogue must not expose any studio');
 report.push({check:name,status:response.status,ok:true});
}
await writeFile('.local/deploy-verification.json',JSON.stringify({time:new Date().toISOString(),origin,report},null,2));
console.log(JSON.stringify(report));
