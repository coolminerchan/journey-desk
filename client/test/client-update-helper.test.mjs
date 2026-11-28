import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile } from 'node:fs/promises'
import { dirname,join,resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { atomicJSON,createManifest,EXECUTABLE,JOURNAL,makePlan } from '../client-update-install.mjs'

const execute=promisify(execFile)
const helperScript=fileURLToPath(new URL('../client-update-apply.mjs',import.meta.url))
const preload=fileURLToPath(new URL('./fixtures/update-helper-preload.mjs',import.meta.url))
async function bundle(path,version){
  await mkdir(join(path,'resources/app'),{recursive:true});await mkdir(join(path,'runtime'))
  for(const [name,body] of [[EXECUTABLE,'test-entry-'+version],['runtime/node.exe','test-runtime'],['resources/app/main.mjs','test-app'],
    ['resources/app/product.json',JSON.stringify({role:'client',version})],['resources/app/client-update.json',JSON.stringify({repository:'fixture/test',public_key:'fixture-key'})]])
    await writeFile(join(path,name),body)
  await createManifest(path,version)
}
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'journey-helper-boundary-'))
  try{
    const target=join(root,'installation'),source=join(root,'source'),helper=join(root,'helper')
    await bundle(target,'0.7.1');await bundle(source,'0.7.2');await mkdir(helper)
    const plan=await makePlan(target,source,helper,'0.7.2')
    await writeFile(join(target,'private-account.zip'),'personal-sentinel')
    await run({root,target,source,helper,plan})
  }finally{
    assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.equal(dirname(await realpath(root)),await realpath(tmpdir()))
    await rm(root,{recursive:true,force:true})
  }
}
async function child(f,{plan=f.plan,mode='--plan',recovery='2147483647',extra={}}={}){
  const input=join(f.root,'handoff.json'),log=join(f.root,'launches.jsonl'),marker=join(f.root,'preload-ready.txt')
  await atomicJSON(input,plan)
  let code=0,stderr=''
  try{await execute(process.execPath,['--import',pathToFileURL(preload).href,helperScript,mode,input,...(mode==='--recover'?[recovery]:[])],
    {windowsHide:true,timeout:5000,env:{...process.env,JOURNEY_TEST_LAUNCH_LOG:log,JOURNEY_TEST_PRELOAD_MARKER:marker,...extra}})}
  catch(error){assert.equal(error.killed,false,'Helper exceeded the subprocess deadline');code=error.code;stderr=error.stderr}
  assert.equal(await readFile(marker,'utf8').catch(()=>stderr),'application launches suppressed','Test preloader must run before the real helper')
  const launches=await readFile(log,'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),error=>{if(error.code==='ENOENT')return [];throw error})
  assert.ok(launches.every(value=>value.suppressed===true))
  return{code,stderr,launches}
}

test('invalid helper junction in a subprocess cannot write results or request any restart',
  {skip:process.platform!=='win32',timeout:10000},async()=>fixture(async f=>{
    const external=join(f.root,'external');await mkdir(external)
    await rename(f.helper,f.helper+'-owned-original');await symlink(external,f.helper,'junction')
    const outcome=await child(f)
    assert.equal(outcome.code,1);assert.deepEqual(outcome.launches,[]);assert.deepEqual(await readdir(external),[])
    assert.equal(await readFile(join(f.target,'private-account.zip'),'utf8'),'personal-sentinel')
  }))

test('invalid plan or pid fields cause no result write and no restart in independent subprocesses',
  {timeout:15000},async()=>{
    for(const mutation of [{pids:[0]},{pids:'invalid'},{schema:2},{incoming:'invalid'}]) await fixture(async f=>{
      const outcome=await child(f,{plan:{...f.plan,...mutation}})
      assert.equal(outcome.code,1);assert.deepEqual(outcome.launches,[]);assert.deepEqual(await readdir(f.helper),[])
    })
  })

test('install helper requires an existing source before authorizing error output or restart',
  {timeout:10000},async()=>fixture(async f=>{
    await rm(f.source,{recursive:true})
    const outcome=await child(f)
    assert.equal(outcome.code,1);assert.deepEqual(outcome.launches,[]);assert.deepEqual(await readdir(f.helper),[])
  }))

test('subprocess recovery keeps working with source and product missing and suppresses the application launch',
  {timeout:10000},async()=>fixture(async f=>{
    await mkdir(f.plan.backup);await rename(join(f.target,'resources'),join(f.plan.backup,'resources'))
    await atomicJSON(join(f.target,JOURNAL),{...f.plan,phase:'applying',operations:[{name:'resources',existed:true}]})
    await rm(f.source,{recursive:true})
    const outcome=await child(f,{mode:'--recover'})
    assert.equal(outcome.code,0);assert.equal(outcome.launches.length,1)
    assert.equal(outcome.launches[0].executable,join(await realpath(f.target),EXECUTABLE))
    assert.equal(JSON.parse(await readFile(join(f.helper,'result.json'))).phase,'rolled_back')
    assert.equal(JSON.parse(await readFile(join(f.target,'resources/app/product.json'))).version,'0.7.1')
    assert.equal(await readFile(join(f.target,'private-account.zip'),'utf8'),'personal-sentinel')
    assert.deepEqual(await readdir(f.helper),['result.json'])
  }))

test('a bounded wait failure writes an atomic result only after validation and retains the old entry',
  {timeout:10000},async()=>fixture(async f=>{
    const outcome=await child(f,{plan:{...f.plan,pids:[process.pid]},extra:{JOURNEY_TEST_FAST_WAIT:'1'}})
    assert.equal(outcome.code,1);assert.equal(outcome.launches.length,1)
    const result=JSON.parse(await readFile(join(f.helper,'result.json')))
    assert.equal(result.phase,'failed');assert.match(result.error,/has not closed/)
    assert.deepEqual(await readdir(f.helper),['result.json'])
    assert.equal(await readFile(join(f.target,EXECUTABLE),'utf8'),'test-entry-0.7.1')
  }))

test('helper redirected after validation is rechecked in the error branch before any write or restart',
  {skip:process.platform!=='win32',timeout:10000},async()=>fixture(async f=>{
    const external=join(f.root,'external'),marker=join(f.root,'redirected.txt')
    await mkdir(external);await writeFile(join(external,'result.json'),'EXTERNAL RESULT SENTINEL')
    const outcome=await child(f,{plan:{...f.plan,pids:[process.pid]},extra:{JOURNEY_TEST_FAST_WAIT:'1',
      JOURNEY_TEST_REDIRECT_HELPER:f.helper,JOURNEY_TEST_EXTERNAL:external,JOURNEY_TEST_REDIRECT_MARKER:marker}})
    assert.equal(outcome.code,1);assert.deepEqual(outcome.launches,[])
    assert.equal(await readFile(marker,'utf8'),'redirected after validation')
    assert.equal(await readFile(join(external,'result.json'),'utf8'),'EXTERNAL RESULT SENTINEL')
    assert.deepEqual(await readdir(external),['result.json'])
  }))
