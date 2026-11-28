import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, atomicJSON, canonicalDirectory, cleanupHelpers, createManifest, EXECUTABLE,
  JOURNAL, makePlan, product, rollback, validatePlan, verifyBasePackage, digest, MANIFEST } from '../client-update-install.mjs'

const execute = promisify(execFile)
async function shortPath(path) {
  const script = 'import ctypes,sys; k=ctypes.windll.kernel32; b=ctypes.create_unicode_buffer(32768); n=k.GetShortPathNameW(ctypes.c_wchar_p(sys.argv[1]),b,len(b)); assert n and n<len(b); print(b.value)'
  const { stdout } = await execute(process.env.OVERFIELD_TEST_PYTHON || 'python', ['-B', '-X', 'utf8', '-c', script, path], { windowsHide: true })
  const short = stdout.trim()
  assert.notEqual(short.toLowerCase(), (await realpath(path)).toLowerCase(), 'A real 8.3 alias is required')
  assert.equal(await realpath(short), await realpath(path))
  return short
}
async function bundle(path, version) {
  await mkdir(join(path, 'resources/app'), { recursive: true }); await mkdir(join(path, 'runtime'))
  for (const [name, body] of [[EXECUTABLE, 'host-' + version], ['runtime/node.exe', 'runtime-' + version],
    ['resources/app/main.mjs', 'app-' + version], ['resources/app/product.json', JSON.stringify({ role: 'client', version })],
    ['resources/app/client-update.json', JSON.stringify({ repository: 'fixture/test', public_key: 'fixture-key' })]])
    await writeFile(join(path, name), body)
  await createManifest(path, version)
}
async function fixture(run, temporary = tmpdir()) {
  const root = await mkdtemp(join(temporary, 'journey-path-contract-'))
  try {
    const target = join(root, 'installed 中文目录'), source = join(root, 'staged package'), helper = join(root, 'helper')
    await bundle(target, '0.7.1'); await bundle(source, '0.7.2'); await mkdir(helper)
    await writeFile(join(target, 'private-account.zip'), 'personal-sentinel')
    await run({ root, target, source, helper })
  } finally {
    assert.equal(dirname(resolve(root)), resolve(temporary))
    assert.equal(dirname(await realpath(root)), await realpath(temporary))
    await rm(root, { recursive: true, force: true })
  }
}

test('real short aliases, case, spaces and Chinese produce canonical plans and keep the original entry',
  { skip: process.platform !== 'win32' }, async () => fixture(async f => {
    const short = await shortPath(f.root)
    const plan = await makePlan(join(short, basename(f.target)).toUpperCase(), join(short, basename(f.source)), join(short, 'helper'), '0.7.2')
    for (const name of ['target', 'source', 'helper']) assert.equal(plan[name], await realpath(f[name]))
    await verifyBasePackage(join(short, basename(f.target)), '0.7.1', await digest(join(f.target, MANIFEST)))
    const installed = await apply(plan)
    assert.equal(installed.executable, join(await realpath(f.target), EXECUTABLE))
    assert.equal(await readFile(join(f.target, 'private-account.zip'), 'utf8'), 'personal-sentinel')
    assert.equal((await product(f.target)).version, '0.7.2')
  }, process.env.OVERFIELD_TEST_ALIAS_TEMP || tmpdir()))

for (const type of ['junction', 'dir']) test(type + ' leaf, ancestor and hidden parent traversal are rejected for all plan roles',
  { skip: process.platform !== 'win32' }, async () => fixture(async f => {
    for (const role of ['target', 'source', 'helper']) {
      const link = join(f.root, role + '-' + type)
      await symlink(f[role], link, type)
      for (const path of [link, join(link, role === 'helper' ? 'child' : 'resources')]) {
        if (role === 'helper') await mkdir(join(f.helper, 'child'), { recursive: true })
        await assert.rejects(makePlan(...['target', 'source', 'helper'].map(name => name === role ? path : f[name]), '0.7.2'), /redirected/)
      }
      const hidden = link + sep + '..' + sep + basename(f[role])
      await assert.rejects(makePlan(...['target', 'source', 'helper'].map(name => name === role ? hidden : f[name]), '0.7.2'), /parent traversal/)
      await rm(link)
    }
    assert.equal(await readFile(join(f.target, 'private-account.zip'), 'utf8'), 'personal-sentinel')
    assert.equal((await product(f.target)).version, '0.7.1')
  }))

test('all equal and ancestor relations are rejected, including helper ancestors; prefix siblings work', async () => fixture(async f => {
  await assert.rejects(canonicalDirectory(''), /parent traversal/)
  assert.equal(await canonicalDirectory('.'), await realpath('.'))
  const original = await makePlan(f.target, f.source, f.helper, '0.7.2')
  for (const [a, b] of [['target', 'source'], ['target', 'helper'], ['source', 'helper']]) {
    for (const [parent, child] of [[a, b], [b, a]]) {
      for (const path of [f[parent], join(f[parent], 'nested')]) {
        await mkdir(path, { recursive: true })
        const values = { ...f, [child]: path }
        await assert.rejects(makePlan(values.target, values.source, values.helper, '0.7.2'), /overlap/)
        await assert.rejects(validatePlan({ ...original, [child]: path }), /overlap/)
      }
    }
  }
  const sibling = f.target + '-helper'; await mkdir(sibling)
  await validatePlan(await makePlan(f.target, f.source, sibling, '0.7.2'))
}))

test('real short and long aliases of each directory pair cannot conceal equal locations',
  {skip:process.platform!=='win32'}, async()=>fixture(async f=>{
    const short = await shortPath(f.root)
    for (const [a,b] of [['target','source'],['target','helper'],['source','helper']]) {
      const values = {...f,[b]:join(short,basename(f[a]))}
      await assert.rejects(makePlan(values.target,values.source,values.helper,'0.7.2'),/overlap/)
    }
  },process.env.OVERFIELD_TEST_ALIAS_TEMP || tmpdir()))

test('legacy plans recover with source and product missing without changing recorded transaction paths', async () => fixture(async f => {
  const current = await makePlan(f.target, f.source, f.helper, '0.7.2')
  // Simulate a previously persisted plan using the original (possibly short)
  // spelling, and a crash after resources were moved into the backup.
  const plan = { ...current, target: f.target, source: f.source, helper: f.helper,
    incoming: join(f.target, '.client-incoming-' + current.id), backup: join(f.target, '.client-backup-' + current.id) }
  await mkdir(plan.backup); await rename(join(f.target, 'resources'), join(plan.backup, 'resources'))
  await atomicJSON(join(f.target, JOURNAL), { ...plan, phase: 'applying', operations: [{ name: 'resources', existed: true }] })
  await rm(f.source, { recursive: true })
  const before = JSON.stringify(plan)
  await validatePlan(plan)
  await assert.rejects(apply(plan), { code: 'ENOENT' })
  await rollback(plan)
  assert.equal(JSON.stringify(plan), before)
  assert.equal((await product(f.target)).version, '0.7.1')
  assert.equal(JSON.parse(await readFile(join(f.target, JOURNAL))).phase, 'rolled_back')
  assert.equal(await readFile(join(f.target, 'private-account.zip'), 'utf8'), 'personal-sentinel')
}))

test('source removed during replacement cannot prevent rollback; transaction paths remain exact', async () => fixture(async f => {
  const plan = await makePlan(f.target, f.source, f.helper, '0.7.2')
  await assert.rejects(apply(plan, { beforeReplace: async name => {
    if (name === 'resources') { await rm(f.source, { recursive: true }); throw Error('Injected source removal') }
  } }), /Injected source removal/)
  assert.equal((await product(f.target)).version, '0.7.1')
  assert.equal(await readFile(join(f.target, EXECUTABLE), 'utf8'), 'host-0.7.1')
  for (const field of ['incoming', 'backup'])
    await assert.rejects(validatePlan({ ...plan, [field]: join(f.root, 'outside-' + field) }), /transaction paths/)
}))

test('helper cleanup refuses redirected roots and redirected children while preserving external sentinels',
  { skip: process.platform !== 'win32' }, async () => fixture(async f => {
    const external = join(f.root, 'external'), userData = join(f.root, 'settings')
    const name = 'apply-' + '1'.repeat(32)
    await mkdir(join(external, name), { recursive: true }); await mkdir(userData)
    await atomicJSON(join(external, name, 'result.json'), { kind: 'client_update_result', phase: 'committed', pid: 2147483647 })
    await symlink(external, join(userData, 'updates'), 'junction')
    await cleanupHelpers(userData)
    assert.equal((await readdir(external))[0], name)
    await rm(join(userData, 'updates')); await mkdir(join(userData, 'updates'))
    await symlink(join(external, name), join(userData, 'updates', name), 'junction')
    await cleanupHelpers(userData)
    assert.equal((await readdir(external))[0], name)
    await assert.rejects(canonicalDirectory(join(userData, 'updates', name)), /redirected/)
  }))
