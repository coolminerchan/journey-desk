import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, mkdir, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { signedRelease, newer, releaseURL, ClientUpdater } from '../client-update.mjs'

const pair = generateKeyPairSync('ed25519')
const trust = { repository: 'example/archive', public_key: pair.publicKey.export({ type: 'spki', format: 'pem' }) }
const data = Buffer.from('fake-package-for-update-orchestration')
const release = { schema: 1, role: 'client', repository: trust.repository, version: '0.6.1',
  url: 'https://github.com/example/archive/releases/download/v0.6.1/package.zip',
  bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
function envelope(value = release) {
  const payload = Buffer.from(JSON.stringify(value))
  return { payload: payload.toString('base64'), signature: sign(null, payload, pair.privateKey).toString('base64') }
}
const app = root => join(root, '..', 'installation', 'resources', 'app')
async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'archive-update-')), root = join(base, 'settings')
  try {
    await mkdir(root); await mkdir(app(root), {recursive:true})
    await writeFile(join(app(root), 'client-update.json'), JSON.stringify(trust))
    await writeFile(join(app(root), 'product.json'), '{"role":"client","version":"0.6.0"}')
    await run(root)
  } finally { await rm(base, { recursive: true, force: true }) }
}

test('updates require our own signature, product identity, bounded size and release URL', () => {
  assert.equal(signedRelease(envelope(), trust, '0.6.0').newer, true)
  assert.equal(signedRelease(envelope(), trust, '0.6.1').newer, false)
  assert.equal(newer('0.10.0', '0.6.1'), true)
  assert.equal(newer('0.6.0', '0.6.0'), false)
  assert.equal(newer('bad', '0.6.0'), false)
  assert.throws(() => signedRelease({ ...envelope(), payload: Buffer.from('{}').toString('base64') }, trust, '0.6.0'), /签名/)
  assert.throws(() => signedRelease(envelope({ ...release, role: 'server' }), trust, '0.6.0'), /格式/)
  assert.throws(() => signedRelease(envelope({ ...release, bytes: 1e12 }), trust, '0.6.0'), /格式/)
  assert.throws(() => releaseURL('https://github.com/other/repo/releases/download/v1/a.zip', trust.repository))
  assert.throws(() => releaseURL('http://github.com/example/archive/releases/download/v1/a.zip', trust.repository))
})

test('private or absent releases are an explicit unavailable state without any account token', async () => fixture(async root => {
  const updater = new ClientUpdater({ here: app(root), userData: root }, { fetcher: async (_url, options) => {
    assert.ok(!('Authorization' in options.headers)); return new Response('', { status: 404 })
  } })
  assert.equal(await updater.check(), false)
  assert.equal(updater.state.phase, 'unavailable')
}))

test('active client prevents checking, downloading and launching an update', async () => {
  const updater = new ClientUpdater({}, { idle: () => false })
  await assert.rejects(updater.check(), /退出游戏/)
  await assert.rejects(updater.prepare(), /退出游戏/)
  await assert.rejects(updater.launch(), /退出游戏/)
})

test('closing can cancel a pending request without waiting for its network timeout', async () => fixture(async root => {
  let started
  const ready = new Promise(ok => { started = ok })
  const updater = new ClientUpdater({ here: app(root), userData: root }, { fetcher: async (_url, options) => {
    started()
    return new Promise((_ok, fail) => options.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }))
  } })
  const task = updater.check()
  await ready; updater.cancel()
  await assert.rejects(task, /aborted/)
  assert.equal(updater.running, false)
}))

test('download is hashed before installation and installs in a new directory', async () => fixture(async root => {
  let calls = 0, installed
  const updater = new ClientUpdater({ here: app(root), userData: root, python: () => 'python',
    command: (_exe, args) => ({ done: (async () => {
      const file = args[args.indexOf('--input') + 1]
      assert.deepEqual(await readFile(file), data)
      installed = args[args.indexOf('--output') + 1]
      await mkdir(installed)
      return JSON.stringify({ path: installed, executable: join(installed, '游戏启动器.exe'), version: '0.6.1' })
    })() }) }, { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response(data) })
  await updater.check(); await updater.prepare()
  assert.equal(updater.state.phase, 'ready')
  assert.ok(installed.startsWith(join(await realpath(root), 'updates', 'version-0.6.1-')))
}))

test('download tampering and untrusted redirects never reach the installer', async () => fixture(async root => {
  let calls = 0, installed = false
  const updater = new ClientUpdater({ here: app(root), userData: root, command: () => { installed = true } },
    { fetcher: async () => ++calls === 1 ? new Response(JSON.stringify(envelope())) : new Response('tampered') })
  await updater.check()
  await assert.rejects(updater.prepare(), /校验/)
  assert.equal(installed, false)
  assert.equal(updater.state.phase, 'failed')
  const redirected = new ClientUpdater({ here: app(root), userData: root }, { fetcher: async () => new Response('', {
    status: 302, headers: { location: 'https://untrusted.example/payload' } }) })
  await assert.rejects(redirected.check(), /重定向地址/)
}))

function installing(root) {
  let count = 0
  const context = { here: app(root), userData: root, python: () => 'python', command: (_exe, args) => ({ done: (async () => {
    assert.deepEqual(await readFile(args[args.indexOf('--input') + 1]), data)
    count++
    const target = args[args.indexOf('--output') + 1]
    await mkdir(target)
    return JSON.stringify({ path: target, executable: join(target, '游戏启动器.exe'), version: release.version })
  })() }) }
  return { context, count: () => count }
}
const isMirror = url => url.hostname === 'gh-proxy.com'
const isFeed = url => url.pathname.endsWith('/client-update.json')

test('a blocked update feed falls back without credentials and prefers that route for the package', async () => fixture(async root => {
  const install = installing(root), calls = []
  const updater = new ClientUpdater(install.context, { fetcher: async (url, options) => {
    calls.push(url.href)
    assert.equal(options.credentials, 'omit')
    assert.ok(!Object.keys(options.headers).some(key => /authorization|cookie/i.test(key)))
    if (!isMirror(url)) throw Error('Direct connection blocked')
    assert.ok(url.href.startsWith('https://gh-proxy.com/https://github.com/example/archive/releases/'))
    return new Response(isFeed(url) ? JSON.stringify(envelope()) : data)
  } })
  await updater.check(); await updater.prepare()
  assert.equal(updater.state.phase, 'ready')
  assert.equal(updater.state.source, 'gh-proxy')
  assert.equal(calls.length, 3)
  assert.equal(install.count(), 1)
}))

test('a timed-out connection switches to the backup feed', { timeout: 3000 }, async () => fixture(async root => {
  let calls = 0
  const updater = new ClientUpdater({ here: app(root), userData: root }, { timeouts: { connectMs: 20 }, fetcher: async (url, options) => {
    calls++
    if (isMirror(url)) return new Response(JSON.stringify(envelope()))
    return new Promise((_ok, fail) => options.signal.addEventListener('abort', () => fail(Error('connection timeout')), { once: true }))
  } })
  await updater.check()
  assert.equal(calls, 2)
  assert.equal(updater.state.phase, 'available')
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('a 404 direct feed still permits a valid signed backup feed', async () => fixture(async root => {
  const updater = new ClientUpdater({ here: app(root), userData: root }, { fetcher: async url =>
    isMirror(url) ? new Response(JSON.stringify(envelope())) : new Response('', { status:404 }) })
  assert.equal(await updater.check(), true)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('backup follows wrapped GitHub CDN redirects while retaining signature verification', async () => fixture(async root => {
  const calls = []
  const redirected = 'https://gh-proxy.com/https://release-assets.githubusercontent.com/github-production-release-asset/1/descriptor?sig=public-download-signature'
  const updater = new ClientUpdater({ here:app(root), userData:root }, { fetcher:async url => {
    calls.push(url.href)
    if (!isMirror(url)) throw Error('Direct blocked')
    if (isFeed(url)) return new Response('', {status:302,headers:{location:redirected}})
    assert.equal(url.href, redirected)
    return new Response(JSON.stringify(envelope()))
  } })
  assert.equal(await updater.check(), true)
  assert.equal(calls.length, 3)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('invalid direct metadata can recover through a separately verified descriptor', async () => fixture(async root => {
  const updater = new ClientUpdater({ here: app(root), userData: root }, { fetcher: async url =>
    new Response(isMirror(url) ? JSON.stringify(envelope()) : '<html>Connection error</html>') })
  assert.equal(await updater.check(), true)
  assert.equal(updater.release.sha256, release.sha256)
}))

test('an interrupted package restarts from zero rather than mixing bytes from both routes', async () => fixture(async root => {
  const install = installing(root), progress = []
  let updater
  updater = new ClientUpdater({ ...install.context, send: () => progress.push([updater.state.source, updater.state.progress]) }, {
    fetcher: async url => {
      if (isFeed(url)) return new Response(JSON.stringify(envelope()))
      if (isMirror(url)) return new Response(data)
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(data.subarray(0, 8))
        setTimeout(() => controller.error(Error('Disconnected mid-transfer')), 20)
      } }))
    }
  })
  await updater.check(); await updater.prepare()
  assert.ok(progress.some(([source, percent]) => source === 'github' && percent > 0 && percent < 100))
  assert.ok(progress.some(([source, percent]) => source === 'gh-proxy' && percent === 0))
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
  assert.ok(!(await readdir(join(root, 'updates'))).some(name => /\.zip(?:\.part)?$/.test(name)))
}))

test('a stalled transfer has its own deadline and can recover on the backup route', { timeout:3000 }, async () => fixture(async root => {
  const install = installing(root)
  const updater = new ClientUpdater(install.context, { timeouts: { idleMs:20 }, fetcher: async (url, options) => {
    if (isFeed(url)) return new Response(JSON.stringify(envelope()))
    if (isMirror(url)) return new Response(data)
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.subarray(0, 8))
      options.signal.addEventListener('abort', () => controller.error(Error('idle timeout')), { once:true })
    } }))
  } })
  await updater.check(); await updater.prepare()
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('same-size package tampering on one route never reaches installation before a correct retry', async () => fixture(async root => {
  const install = installing(root)
  const updater = new ClientUpdater(install.context, { fetcher: async url => {
    if (isFeed(url)) return new Response(JSON.stringify(envelope()))
    return new Response(isMirror(url) ? data : Buffer.alloc(data.length))
  } })
  await updater.check(); await updater.prepare()
  assert.equal(install.count(), 1)
  assert.equal(updater.state.source, 'gh-proxy')
}))

test('unexpected partial content and oversized responses switch routes before installation', async () => fixture(async root => {
  for (const response of [() => new Response(data.subarray(0,4), { status:206 }),
    () => new Response(data, { headers: { 'content-length':String(data.length + 1) } })]) {
    const install = installing(root)
    const updater = new ClientUpdater(install.context, { fetcher: async url => {
      if (isFeed(url)) return new Response(JSON.stringify(envelope()))
      return isMirror(url) ? new Response(data) : response()
    } })
    await updater.check(); await updater.prepare()
    assert.equal(install.count(), 1)
    assert.equal(updater.state.source, 'gh-proxy')
  }
}))

test('the backup cannot supply an unsigned update or redirect to a different proxy target', async () => fixture(async root => {
  for (const response of [() => new Response(JSON.stringify({ ...envelope(), signature:'invalid' })),
    () => new Response(JSON.stringify(envelope({ ...release, repository:'other/repository' }))),
    () => new Response('', { status:302, headers:{ location:'https://gh-proxy.com/https://evil.example/update.json' } }),
    () => new Response('', { status:302, headers:{ location:'https://gh-proxy.com/https://github.com/other/repository/releases/latest/download/client-update.json' } })]) {
    const calls = []
    const updater = new ClientUpdater({ here:app(root), userData:root }, { fetcher: async url => {
      calls.push(url.href)
      return isMirror(url) ? response() : new Response('', { status:503 })
    } })
    await assert.rejects(updater.check(), /签名|重定向地址|格式/)
    assert.equal(updater.release, null)
    assert.equal(calls.length, 2)
    assert.equal(updater.state.phase, 'failed')
  }
}))

test('cancelling a backup download prevents another route and removes partial bytes', async () => fixture(async root => {
  let started, downloads = 0
  const ready = new Promise(resolve => { started = resolve })
  const install = installing(root)
  const updater = new ClientUpdater(install.context, { fetcher: async (url, options) => {
    if (isFeed(url)) {
      if (!isMirror(url)) throw Error('Direct blocked')
      return new Response(JSON.stringify(envelope()))
    }
    downloads++
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.subarray(0,8))
      options.signal.addEventListener('abort', () => controller.error(Error('aborted')), { once:true })
      started()
    } }))
  } })
  await updater.check()
  const task = updater.prepare()
  await ready; updater.cancel()
  await assert.rejects(task, /aborted/)
  assert.equal(downloads, 1)
  assert.equal(install.count(), 0)
  assert.deepEqual(await readdir(join(root,'updates')), [])
}))

test('cancelling after extraction removes only the newly created update stage', async () => fixture(async root => {
  let updater
  const sentinel=join(root,'updates/version-0.5.0-owned-earlier');await mkdir(sentinel,{recursive:true});await writeFile(join(sentinel,'keep.txt'),'keep')
  updater=new ClientUpdater({here:app(root),userData:root,python:()=> 'python',command:(_exe,args)=>({done:(async()=>{
    const target=args[args.indexOf('--output')+1];await mkdir(target);await writeFile(join(target,'large-resource.bin'),'partial staged component')
    updater.cancel()
    return JSON.stringify({path:target,executable:join(target,'游戏启动器.exe'),version:release.version})
  })()})},{fetcher:async url=>new Response(isFeed(url)?JSON.stringify(envelope()):data)})
  await updater.check();await assert.rejects(updater.prepare(),/取消/)
  assert.equal(await readFile(join(sentinel,'keep.txt'),'utf8'),'keep')
  assert.deepEqual(await readdir(join(root,'updates')),['version-0.5.0-owned-earlier'])
}))

test('an extraction failure removes only this attempt and preserves the earlier prepared record', async () => fixture(async root => {
  const updates = join(root, 'updates'), earlier = join(updates, 'version-0.5.0-owned-earlier')
  await mkdir(earlier, { recursive:true }); await writeFile(join(earlier, 'keep.txt'), 'keep')
  await writeFile(join(updates, 'prepared.json'), 'earlier-record')
  const updater = new ClientUpdater({ here:app(root), userData:root, python:()=> 'python', command:(_exe,args)=>({done:(async()=>{
    const target=args[args.indexOf('--output')+1]
    await mkdir(target); await writeFile(join(target,'partial.bin'),'partial')
    throw Error('Injected extraction failure')
  })()}) }, {fetcher:async url=>new Response(isFeed(url)?JSON.stringify(envelope()):data)})
  await updater.check(); await assert.rejects(updater.prepare(), /Injected extraction failure/)
  assert.deepEqual((await readdir(updates)).sort(), ['prepared.json','version-0.5.0-owned-earlier'])
  assert.equal(await readFile(join(updates, 'prepared.json'), 'utf8'), 'earlier-record')
  assert.equal(await readFile(join(earlier, 'keep.txt'), 'utf8'), 'keep')
}))

test('failed-stage cleanup never follows a junction and redirected cache roots are refused',
  {skip:process.platform!=='win32'}, async () => fixture(async root => {
    const external=join(root,'external'); await mkdir(external); await writeFile(join(external,'keep.txt'),'external-sentinel')
    const updater = new ClientUpdater({here:app(root),userData:root,python:()=> 'python',command:(_exe,args)=>({done:(async()=>{
      await symlink(external,args[args.indexOf('--output')+1],'junction')
      throw Error('Injected redirected stage')
    })()})},{fetcher:async url=>new Response(isFeed(url)?JSON.stringify(envelope()):data)})
    await updater.check(); await assert.rejects(updater.prepare(),/Injected redirected stage/)
    assert.deepEqual(await readdir(external),['keep.txt'])
    const settings=join(root,'other-settings'); await mkdir(settings); await symlink(external,join(settings,'updates'),'junction')
    const redirected=new ClientUpdater({here:app(root),userData:settings},{fetcher:async url=>new Response(isFeed(url)?JSON.stringify(envelope()):data)})
    await redirected.check(); await assert.rejects(redirected.prepare(),/redirected/)
    assert.equal(await readFile(join(external,'keep.txt'),'utf8'),'external-sentinel')
    assert.deepEqual(await readdir(external),['keep.txt'])
  }))

test('download and output staging overlaps are rejected before creation, package fetch or extraction', async () => {
  for (const relation of ['inside', 'equal', 'ancestor']) await fixture(async root => {
    const base = dirname(root)
    let here = app(root), userData = resolve(here, '../..')
    if (relation !== 'inside') {
      const installation = join(base, 'updates', ...(relation === 'ancestor' ? ['installation'] : []))
      here = join(installation, 'resources', 'app'); userData = base
      await mkdir(here, {recursive:true})
      await writeFile(join(here, 'client-update.json'), JSON.stringify(trust))
      await writeFile(join(here, 'product.json'), '{"role":"client","version":"0.6.0"}')
    }
    const installation = resolve(here, '../..'), entry = join(installation, '游戏启动器.exe')
    await writeFile(entry, 'original-entry-sentinel')
    let packages = 0, installs = 0
    const updater = new ClientUpdater({here,userData,command:()=>{installs++;throw Error('Installer must not run')}},
      {fetcher:async url=>{
        if (isFeed(url)) return new Response(JSON.stringify(envelope()))
        packages++; return new Response(data)
      }})
    await updater.check(); await assert.rejects(updater.prepare(), /staging overlaps/)
    assert.equal(packages, 0); assert.equal(installs, 0)
    if (relation === 'inside') await assert.rejects(readdir(join(userData, 'updates')), {code:'ENOENT'})
    assert.equal(await readFile(entry, 'utf8'), 'original-entry-sentinel')
  })
})

for (const phase of ['extraction', 'success']) test('directory redirection during ' + phase + ' preserves external download bytes and earlier cache',
  {skip:process.platform!=='win32'}, async()=>fixture(async root=>{
    const updates=join(root,'updates'), moved=updates+'-owned-original', external=join(root,'external')
    await mkdir(join(updates,'version-earlier'),{recursive:true}); await mkdir(external)
    await writeFile(join(updates,'prepared.json'),'earlier-prepared')
    await writeFile(join(updates,'version-earlier','keep.txt'),'earlier-cache')
    const originalProduct=await readFile(join(app(root),'product.json'))
    const sentinel=Buffer.from([0,3,255,7,11]), externalFiles=[]
    let updater
    const redirect=async names=>{
      await rename(updates,moved); await symlink(external,updates,'junction')
      for(const name of names){const path=join(external,name);await writeFile(path,sentinel);externalFiles.push(path)}
    }
    updater=new ClientUpdater({here:app(root),userData:root,python:()=> 'fixture',command:(_exe,args)=>({done:(async()=>{
      const input=args[args.indexOf('--input')+1], output=args[args.indexOf('--output')+1]
      await redirect([basename(input),basename(input)+'.part'])
      if(phase==='success') return JSON.stringify({path:output,version:release.version,executable:join(output,'游戏启动器.exe')})
      throw Error('Injected extraction redirection')
    })()})},{fetcher:async url=>{
      if(isFeed(url)) return new Response(JSON.stringify(envelope()))
      return new Response(data)
    }})
    await updater.check(); await assert.rejects(updater.prepare())
    for(const path of externalFiles) assert.deepEqual(await readFile(path),sentinel)
    assert.equal(await readFile(join(moved,'prepared.json'),'utf8'),'earlier-prepared')
    assert.equal(await readFile(join(moved,'version-earlier','keep.txt'),'utf8'),'earlier-cache')
    assert.deepEqual(await readFile(join(app(root),'product.json')),originalProduct)
    await assert.rejects(readFile(join(external,'prepared.json')),{code:'ENOENT'})
    assert.equal(updater.state.phase,'failed')
  }))

for(const phase of ['pending','zip']) test('cleanup retains a replaced ' + phase + ' file it did not create',async()=>fixture(async root=>{
  const updates=join(root,'updates'), sentinel=Buffer.from('foreign-file-sentinel')
  let replaced, original, changed=false
  const replace=async path=>{original=path+'.owned-original';await rename(path,original);await writeFile(path,sentinel);replaced=path;changed=true}
  const updater=new ClientUpdater({here:app(root),userData:root,python:()=> 'fixture',command:(_exe,args)=>({done:(async()=>{
    await replace(args[args.indexOf('--input')+1]);throw Error('Injected replaced ZIP')
  })()})},{fetcher:async url=>{
    if(isFeed(url)) return new Response(JSON.stringify(envelope()))
    if(phase==='pending'&&!changed){await replace(join(updates,(await readdir(updates)).find(n=>n.endsWith('.part'))));throw Error('Injected replaced partial')}
    return new Response(data)
  }})
  await updater.check();await assert.rejects(updater.prepare())
  assert.deepEqual(await readFile(replaced),sentinel)
  assert.deepEqual(await readFile(original),phase==='zip'?data:Buffer.alloc(0))
  assert.equal(updater.state.phase,'failed')
}))
