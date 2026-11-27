import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, atomicJSON, cleanupHelpers, createManifest, EXECUTABLE, inside, JOURNAL, legacyOrigin, makePlan, MANIFEST, product, rollback, verifyPackage } from '../client-update-install.mjs'

const trust = { repository:'example/archive',public_key:'fixture-public-key' }
async function bundle(path, version, { inventory = true, publisher = trust } = {}) {
  await mkdir(join(path,'resources/app'),{recursive:true}); await mkdir(join(path,'runtime'))
  for (const [name, body] of [[EXECUTABLE,'host-'+version],['runtime/node.exe','node-'+version],['resources/app/main.mjs','app-'+version],
    ['resources/app/product.json',JSON.stringify({role:'client',version})],['resources/app/client-update.json',JSON.stringify(publisher)]])
    await writeFile(join(path,name),body)
  if (inventory) await createManifest(path,version)
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(),'client-in-place-'))
  try {
    const target=join(root,'original path 原目录'), source=join(root,'staged package'), helper=join(root,'helper')
    await bundle(target,'0.7.1',{inventory:false}); await bundle(source,'0.7.2'); await mkdir(helper)
    await run({root,target,source,helper})
  } finally {
    assert.equal(dirname(resolve(root)),resolve(tmpdir())); assert.ok(basename(root).startsWith('client-in-place-'))
    await rm(root,{recursive:true,force:true})
  }
}
test('in-place replacement keeps the exact entry, unrelated root files and previous program components',async()=>fixture(async({target,source,helper})=>{
  await writeFile(join(target,'my-account.zip'),'user-backup')
  await writeFile(join(target,'resources/app/stale.js'),'old-owned-file')
  const plan=await makePlan(target,source,helper,'0.7.2')
  const result=await apply(plan,{beforeReplace:async name=>{
    if(name==='resources') {
      assert.equal(await readFile(join(target,EXECUTABLE),'utf8'),'host-0.7.2')
      assert.equal(await readFile(join(plan.backup,EXECUTABLE),'utf8'),'host-0.7.1')
    }
  }})
  assert.equal(result.executable,join(target,EXECUTABLE))
  assert.equal((await product(target)).version,'0.7.2')
  assert.equal(await readFile(join(target,'my-account.zip'),'utf8'),'user-backup')
  assert.equal(await readFile(join(result.backup,EXECUTABLE),'utf8'),'host-0.7.1')
  assert.equal(await readFile(join(result.backup,'resources/app/stale.js'),'utf8'),'old-owned-file')
  assert.ok(!(await readdir(join(target,'resources/app'))).includes('stale.js'))
}))
test('replacement failures restore every moved component without removing unrelated files',async()=>{
  for(const failAt of [EXECUTABLE,'resources',MANIFEST])await fixture(async({target,source,helper})=>{
    await writeFile(join(target,'notes.txt'),'keep')
    const plan=await makePlan(target,source,helper,'0.7.2')
    await assert.rejects(apply(plan,{beforeReplace:name=>{if(name===failAt)throw Error('Injected replacement failure')}}),/Injected/)
    assert.equal((await product(target)).version,'0.7.1')
    assert.equal(await readFile(join(target,EXECUTABLE),'utf8'),'host-0.7.1')
    assert.equal(await readFile(join(target,'notes.txt'),'utf8'),'keep')
    assert.equal(JSON.parse(await readFile(join(target,JOURNAL))).phase,'rolled_back')
  })
})
test('an interrupted rename can recover even while application metadata is missing',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await mkdir(plan.backup)
  await rename(join(target,'resources'),join(plan.backup,'resources'))
  await atomicJSON(join(target,JOURNAL),{...plan,phase:'applying',operations:[{name:'resources',existed:true}]})
  await rollback(plan)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('tampered stage files fail before the original installation changes',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await writeFile(join(source,'runtime/node.exe'),'tampered')
  await assert.rejects(apply(plan),/changed/)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('another publisher, a downgrade and overlapping directories cannot be applied',async()=>fixture(async({target,source,helper})=>{
  await assert.rejects(makePlan(target,source,helper,'0.7.1'))
  await writeFile(join(source,'resources/app/client-update.json'),JSON.stringify({...trust,repository:'other/project'}))
  await createManifest(source,'0.7.2')
  await assert.rejects(makePlan(target,source,helper,'0.7.2'),/publisher/)
  assert.equal(inside(target,join(target,'resources')),true)
  assert.equal(inside(target,target),false)
  assert.equal(inside(target,join(dirname(target),'outside')),false)
  const nested=join(target,'nested-source');await bundle(nested,'0.7.2')
  await assert.rejects(makePlan(target,nested,helper,'0.7.2'),/overlap/)
}))
test('helper cleanup retains active helpers and directories containing unrelated files',async()=>fixture(async({root})=>{
  const userData=join(root,'user-data'), updates=join(userData,'updates')
  for(const [digit,pid,extra] of [['1',2147483647,false],['2',2147483647,true],['3',process.pid,false]]) {
    const helper=join(updates,'apply-'+digit.repeat(32));await mkdir(helper,{recursive:true})
    await atomicJSON(join(helper,'result.json'),{kind:'client_update_result',phase:'committed',pid})
    if(extra)await writeFile(join(helper,'user-notes.txt'),'keep')
  }
  await cleanupHelpers(userData)
  assert.deepEqual((await readdir(updates)).sort(),['apply-'+'2'.repeat(32),'apply-'+'3'.repeat(32)])
}))
test('package inventories reject additional executables and path traversal',async()=>fixture(async({source})=>{
  await writeFile(join(source,'unrelated.exe'),'unexpected')
  await assert.rejects(verifyPackage(source,'0.7.2'),/Unexpected/)
  await rm(join(source,'unrelated.exe'))
  const manifest=JSON.parse(await readFile(join(source,MANIFEST)))
  manifest.files[0].path='../outside'
  await atomicJSON(join(source,MANIFEST),manifest)
  await assert.rejects(verifyPackage(source,'0.7.2'),/Invalid/)
}))
test('two update helpers cannot replace the same installation concurrently',async()=>fixture(async({target,source,helper})=>{
  const a=await makePlan(target,source,helper,'0.7.2'), b=await makePlan(target,source,helper,'0.7.2')
  let entered,release
  const ready=new Promise(ok=>{entered=ok}), gate=new Promise(ok=>{release=ok})
  const first=apply(a,{beforeReplace:async name=>{if(name===EXECUTABLE){entered();await gate}}})
  await ready
  try { await assert.rejects(apply(b),/already active/) } finally { release() }
  await first
  assert.equal((await product(target)).version,'0.7.2')
  assert.equal(JSON.parse(await readFile(join(target,JOURNAL))).id,a.id)
}))
test('an existing interrupted transaction must recover before preparing another update',async()=>fixture(async({target,source,helper})=>{
  const plan=await makePlan(target,source,helper,'0.7.2')
  await atomicJSON(join(target,JOURNAL),{...plan,phase:'preparing',operations:[]})
  await assert.rejects(makePlan(target,source,helper,'0.7.2'),/recover first/)
  await assert.rejects(apply(plan),/recover first/)
  assert.equal((await product(target)).version,'0.7.1')
}))
test('legacy migration requires the matching update cache record and client origin',async()=>fixture(async({root,target})=>{
  const userData=join(root,'settings'), source=join(userData,'updates/version-0.7.2-12345678')
  await bundle(source,'0.7.2')
  await atomicJSON(join(userData,'updates/prepared.json'),{path:source,version:'0.7.2'})
  const input={here:join(source,'resources/app'),userData,origin:target}
  assert.equal((await legacyOrigin(input)).target,target)
  assert.equal(await legacyOrigin({...input,origin:source}),null)
  assert.equal(await legacyOrigin({...input,origin:root}),null)
  await atomicJSON(join(userData,'updates/prepared.json'),{path:join(root,'other'),version:'0.7.2'})
  assert.equal(await legacyOrigin(input),null)
}))
