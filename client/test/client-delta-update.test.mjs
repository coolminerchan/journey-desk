import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ClientUpdater, signedRelease } from '../client-update.mjs'
import { apply, createManifest, makePlan, product, verifyPackage } from '../client-update-install.mjs'

const execute = promisify(execFile), python = process.env.OVERFIELD_TEST_PYTHON || 'python'
const hash = content => createHash('sha256').update(content).digest('hex')
const pair = generateKeyPairSync('ed25519')
const trust = { repository:'example/archive', public_key:pair.publicKey.export({type:'spki',format:'pem'}) }
const rootURL = 'https://github.com/example/archive/releases/download/v0.12.10/'
function envelope(value) {
  const payload = Buffer.from(JSON.stringify(value))
  return { payload:payload.toString('base64'), signature:sign(null,payload,pair.privateKey).toString('base64') }
}
async function bundle(folder, version) {
  const stable = Buffer.alloc(8192,23)
  const files = ['游戏启动器.exe','runtime/node.exe','resources/app/main.mjs','resources/app/rendered/index.html',
    'resources/dependencies/tools/python/python.exe','resources/core/overfield-client.exe','resources/core/overfield-server.exe',
    'resources/pcgame/PCGameSDK.dll','resources/offline/Lolo.exe','resources/offline/Lolo-source.zip']
  for(const name of files) {await mkdir(resolve(folder,name,'..'),{recursive:true});await writeFile(join(folder,name),stable)}
  await writeFile(join(folder,'resources/app/main.mjs'),'new app '+version)
  await writeFile(join(folder,'resources/app/product.json'),JSON.stringify({role:'client',version}))
  await writeFile(join(folder,'resources/app/client-update.json'),JSON.stringify(trust))
  for(const name of ['client_update_package.py','client_update_delta.py'])
    await writeFile(join(folder,'resources/app',name),await readFile(new URL('../'+name,import.meta.url)))
  await createManifest(folder,version)
}
async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),'journey-delta-test-'))
  try {
    const base=join(root,'base 中文目录'), target=join(root,'release'), settings=join(root,'private-settings')
    await bundle(base,'0.12.9');await bundle(target,'0.12.10');await mkdir(settings)
    await writeFile(join(base,'resources/old.js'),'removed');await createManifest(base,'0.12.9')
    await writeFile(join(target,'resources/new.js'),'added');await createManifest(target,'0.12.10')
    const zipScript = "from pathlib import Path; from zipfile import ZipFile; import sys; r=Path(sys.argv[1]); z=ZipFile(sys.argv[2],'w'); [z.write(p,sys.argv[3]+'/'+p.relative_to(r).as_posix()) for p in r.rglob('*') if p.is_file()]; z.close()"
    const oldZIP=join(root,'Journey-Desk-0.12.9-Windows-x64.zip'), fullZIP=join(root,'Journey-Desk-0.12.10-Windows-x64.zip')
    await execute(python,['-B','-c',zipScript,base,oldZIP,'Journey-Desk-0.12.9-Windows-x64'],{windowsHide:true})
    await execute(python,['-B','-c',zipScript,target,fullZIP,'Journey-Desk-0.12.10-Windows-x64'],{windowsHide:true})
    const patch=join(root,'Journey-Desk-Delta-0.12.9-to-0.12.10-Windows-x64.zip')
    await execute(python,['-B',resolve('scripts/build_client_delta.py'),'--base',oldZIP,'--target',fullZIP,'--output',patch],{windowsHide:true})
    const info=JSON.parse(await readFile(patch+'.json')), full=await readFile(fullZIP), delta=await readFile(patch)
    const release={schema:1,role:'client',repository:trust.repository,version:'0.12.10',url:rootURL+'Journey-Desk-0.12.10-Windows-x64.zip',bytes:full.length,sha256:hash(full),
      deltas:[{from_version:'0.12.9',url:rootURL+info.file,bytes:delta.length,sha256:hash(delta),base_manifest_sha256:info.base_manifest_sha256,target_manifest_sha256:info.target_manifest_sha256}]}
    await writeFile(join(base,'my-account.zip'),'private account backup')
    await writeFile(join(settings,'save.json'),'private save sentinel')
    const urls=[], commands=[]
    const context={here:join(base,'resources/app'),userData:settings,python:()=>python,command:(_bin,args)=>{
      commands.push(args.includes('--base-installation')?'delta':'full')
      return {done:execute(python,args,{windowsHide:true}).then(result=>result.stdout)}
    }}
    const fetcher=async url=>{urls.push(url.href);return new Response(url.pathname.endsWith('/client-update.json')?JSON.stringify(envelope(release)):url.pathname.includes('Delta-')?delta:full)}
    await run({root,base,target,settings,context,release,full,delta,urls,commands,fetcher})
  } finally {assert.ok(root.startsWith(join(tmpdir(),'journey-delta-test-')));await rm(root,{recursive:true,force:true})}
}

test('signed delta downloads only changes, reconstructs the exact package and applies in place',async()=>fixture(async f=>{
  const updater=new ClientUpdater(f.context,{fetcher:f.fetcher})
  await updater.check();assert.equal(updater.state.updateKind,'delta')
  assert.equal(updater.state.downloadBytes,f.delta.length)
  await updater.prepare();assert.equal(updater.state.phase,'ready');assert.deepEqual(f.commands,['delta'])
  assert.ok(!f.urls.some(url=>url.endsWith('/Journey-Desk-0.12.10-Windows-x64.zip')))
  await verifyPackage(updater.installed.path,'0.12.10')
  const helper=join(f.root,'helper');await mkdir(helper)
  await apply(await makePlan(f.base,updater.installed.path,helper,'0.12.10'))
  assert.equal((await product(f.base)).version,'0.12.10')
  assert.equal(await readFile(join(f.base,'resources/new.js'),'utf8'),'added')
  await assert.rejects(readFile(join(f.base,'resources/old.js')))
  assert.equal(await readFile(join(f.base,'my-account.zip'),'utf8'),'private account backup')
  assert.equal(await readFile(join(f.settings,'save.json'),'utf8'),'private save sentinel')
}))

test('a modified local base skips the patch and falls back to a separately verified full release',async()=>fixture(async f=>{
  await writeFile(join(f.base,'runtime/node.exe'),'local modification')
  const updater=new ClientUpdater(f.context,{fetcher:f.fetcher})
  await updater.check();await updater.prepare()
  assert.equal(updater.state.updateKind,'full');assert.equal(updater.state.fallback,true)
  assert.deepEqual(f.commands,['full']);assert.ok(!f.urls.some(url=>url.includes('/Journey-Desk-Delta-')))
  assert.equal(await readFile(join(f.base,'runtime/node.exe'),'utf8'),'local modification')
}))

test('a corrupted patch is never installed and full fallback retains verified content',async()=>fixture(async f=>{
  const updater=new ClientUpdater(f.context,{fetcher:async url=>url.pathname.includes('Delta-')?(f.urls.push(url.href),new Response(Buffer.alloc(f.delta.length))):f.fetcher(url)})
  await updater.check();await updater.prepare()
  assert.deepEqual(f.commands,['full']);assert.equal(updater.state.fallback,true)
  await verifyPackage(updater.installed.path,'0.12.10')
  assert.equal((await product(f.base)).version,'0.12.9')
}))

test('in-place delta replacement failure rolls back and preserves personal data',async()=>fixture(async f=>{
  const updater=new ClientUpdater(f.context,{fetcher:f.fetcher});await updater.check();await updater.prepare()
  const helper=join(f.root,'helper');await mkdir(helper)
  const plan=await makePlan(f.base,updater.installed.path,helper,'0.12.10')
  await assert.rejects(apply(plan,{beforeReplace:name=>{if(name==='resources')throw Error('Injected failure')}}),/Injected/)
  assert.equal((await product(f.base)).version,'0.12.9')
  assert.equal(await readFile(join(f.base,'my-account.zip'),'utf8'),'private account backup')
  assert.equal(await readFile(join(f.settings,'save.json'),'utf8'),'private save sentinel')
}))

test('cancelling a delta download does not start a full fallback',{timeout:10000},async()=>fixture(async f=>{
  let started;const ready=new Promise(ok=>{started=ok})
  const updater=new ClientUpdater(f.context,{fetcher:async(url,options)=>{
    if(!url.pathname.includes('Delta-'))return f.fetcher(url)
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(f.delta.subarray(0,8));options.signal.addEventListener('abort',()=>controller.error(Error('aborted')),{once:true});started()
    }}))
  }})
  await updater.check();const task=updater.prepare();await ready;updater.cancel();await assert.rejects(task,/aborted/)
  assert.deepEqual(f.commands,[]);assert.equal(updater.state.phase,'failed')
  assert.ok(!f.urls.some(url=>url.endsWith('/Journey-Desk-0.12.10-Windows-x64.zip')))
}))

test('delta metadata and download addresses are covered by the existing release signature',()=>{
  const full={schema:1,role:'client',repository:trust.repository,version:'0.12.10',url:rootURL+'full.zip',bytes:1000,sha256:'1'.repeat(64)}
  const delta={from_version:'0.12.9',url:rootURL+'delta.zip',bytes:100,sha256:'2'.repeat(64),base_manifest_sha256:'3'.repeat(64),target_manifest_sha256:'4'.repeat(64)}
  assert.equal(signedRelease(envelope({...full,deltas:[delta]}),trust,'0.12.9').deltas.length,1)
  for(const bad of [{...delta,sha256:'bad'},{...delta,from_version:'0.12.10'},{...delta,url:'https://github.com/other/repo/releases/download/v1/a.zip'}])
    assert.throws(()=>signedRelease(envelope({...full,deltas:[bad]}),trust,'0.12.9'))
  assert.throws(()=>signedRelease(envelope({...full,deltas:[delta,delta]}),trust,'0.12.9'))
})
