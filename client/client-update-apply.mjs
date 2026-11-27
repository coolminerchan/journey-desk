import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { alive, apply, atomicJSON, product, rollback, validatePlan } from './client-update-install.mjs'

const pause = ms => new Promise(ok => setTimeout(ok, ms))
async function wait(pids) {
  const started = Date.now()
  while (pids.some(pid => alive(pid))) {
    if (Date.now() - started > 60000) throw Error('The previous application has not closed')
    await pause(200)
  }
}
async function launch(executable) {
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false, cwd: dirname(executable) })
  await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) }); child.unref()
}
let plan
try {
  const [mode, path, recoveryPid] = process.argv.slice(2)
  if (!['--plan','--recover'].includes(mode) || !path || !isAbsolute(path)) throw Error('Invalid update handoff')
  plan = JSON.parse(await readFile(path, 'utf8'))
  await validatePlan(plan)
  if (!Array.isArray(plan.pids) || plan.pids.some(pid => !Number.isSafeInteger(pid) || pid < 1) ||
      (mode === '--recover' && !/^[1-9]\d*$/.test(recoveryPid || ''))) throw Error('Invalid process wait list')
  await wait(mode === '--recover' ? [Number(recoveryPid)] : plan.pids)
  if (mode === '--recover') await rollback(plan)
  else await apply(plan)
  await atomicJSON(join(plan.helper, 'result.json'), { kind:'client_update_result',phase:mode === '--recover'?'rolled_back':'committed',pid:process.pid })
  await launch(join(plan.target, '游戏启动器.exe'))
} catch (error) {
  if (plan?.helper) await writeFile(join(plan.helper, 'result.json'), JSON.stringify({ kind:'client_update_result',phase:'failed',pid:process.pid,error:error.message })).catch(() => {})
  if (plan?.target) {
    try {
      const journal = JSON.parse(await readFile(join(plan.target,'.client-update.json'),'utf8').catch(() => '{}'))
      if (journal.phase !== 'applying' && (await product(plan.target)).version === plan.previousVersion)
        await launch(join(plan.target,'游戏启动器.exe'))
    } catch {}
  }
  process.exitCode = 1
}
