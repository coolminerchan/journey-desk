// Runs only in isolated helper test processes. All application launches are
// recorded and suppressed; no real executable can be started by these tests.
import * as children from 'node:child_process'
import { appendFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'

children.default.spawn = (executable, args, options) => {
  appendFileSync(process.env.JOURNEY_TEST_LAUNCH_LOG, JSON.stringify({executable,args,options,suppressed:true})+'\n')
  const child = new EventEmitter()
  child.unref = () => {}
  queueMicrotask(() => child.emit('spawn'))
  return child
}
syncBuiltinESMExports()
writeFileSync(process.env.JOURNEY_TEST_PRELOAD_MARKER,'application launches suppressed')
if (process.env.JOURNEY_TEST_FAST_WAIT === '1') {
  const epoch=Date.now();let ticks=0
  Date.now=()=>epoch+(++ticks)*61001
}
if (process.env.JOURNEY_TEST_REDIRECT_HELPER) {
  const kill=process.kill
  let redirected=false
  process.kill=function(pid,signal){
    const value=kill.call(process,pid,signal)
    if(!redirected&&signal===0){
      const helper=process.env.JOURNEY_TEST_REDIRECT_HELPER
      renameSync(helper,helper+'-owned-original')
      symlinkSync(process.env.JOURNEY_TEST_EXTERNAL,helper,'junction')
      writeFileSync(process.env.JOURNEY_TEST_REDIRECT_MARKER,'redirected after validation')
      redirected=true
    }
    return value
  }
}
