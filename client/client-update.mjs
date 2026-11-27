import { createHash, randomUUID, verify } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { startApply, verifyBasePackage } from './client-update-install.mjs'

const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/
const SOURCES = [
  { id: 'github', label: 'GitHub 直连', prefix: '' },
  { id: 'gh-proxy', label: '备用加速（GH-Proxy）', prefix: 'https://gh-proxy.com/' }
]
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
function allowedTransport(current, source, original) {
  const secure = url => url.protocol === 'https:' && !url.username && !url.password && !url.port
  if (!secure(current)) return false
  if (DOWNLOAD_HOSTS.has(current.hostname)) return true
  if (!source.prefix || !current.href.startsWith(source.prefix)) return false
  try {
    // The proxy also wraps GitHub's signed CDN redirects. Check that inner URL
    // independently; allowing the proxy host alone would allow arbitrary sites.
    const target = new URL(current.href.slice(source.prefix.length))
    if (!secure(target) || !DOWNLOAD_HOSTS.has(target.hostname)) return false
    if (target.hostname !== 'github.com') return true
    const root = new URL(original).pathname.replace(/\/releases\/(?:latest\/download\/|download\/).*/, '/releases/')
    return !target.search && !target.hash && target.pathname.startsWith(root)
  } catch { return false }
}
export function newer(candidate, current) {
  if (![candidate, current].every(v => typeof v === 'string' && VERSION.test(v))) return false
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
export function releaseURL(value, repository) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/' + repository + '/releases/download/')) throw new Error('更新下载地址无效')
  return url.href
}
export function signedRelease(envelope, trust, currentVersion) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 32768 || typeof envelope.signature !== 'string' ||
      !verify(null, Buffer.from(envelope.payload, 'base64'), trust.public_key, Buffer.from(envelope.signature, 'base64')))
    throw new Error('更新签名验证失败')
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8'))
  if (payload.schema !== 1 || payload.role !== 'client' || payload.repository !== trust.repository || typeof payload.version !== 'string' || !VERSION.test(payload.version) ||
      typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256) || typeof payload.url !== 'string' || !Number.isSafeInteger(payload.bytes) || payload.bytes < 1 || payload.bytes > 512 * 1024 * 1024)
    throw new Error('更新信息格式无效')
  releaseURL(payload.url, trust.repository)
  if (payload.deltas !== undefined) {
    if (!Array.isArray(payload.deltas) || payload.deltas.length > 32) throw Error('增量更新信息无效')
    const versions = new Set()
    for (const delta of payload.deltas) {
      if (!delta || !VERSION.test(delta.from_version) || !newer(payload.version, delta.from_version) || versions.has(delta.from_version) ||
          !Number.isSafeInteger(delta.bytes) || delta.bytes < 1 || delta.bytes > 512 * 1024 * 1024 ||
          ![delta.sha256, delta.base_manifest_sha256, delta.target_manifest_sha256].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)))
        throw Error('增量更新信息无效')
      releaseURL(delta.url, trust.repository)
      versions.add(delta.from_version)
    }
  }
  return { ...payload, newer: newer(payload.version, currentVersion) }
}

async function request(original, source, limit, receive, fetcher = fetch, signal, timeouts = {}) {
  if (signal?.aborted) throw new Error('更新已取消')
  const entry = source.prefix + original
  let url = entry
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeouts.totalMs ?? 600000)
  let idleTimer
  const deadline = ms => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(), ms) }
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const current = new URL(url)
      if (!allowedTransport(current, source, original))
        throw new Error('更新重定向地址无效')
      deadline(timeouts.connectMs ?? 12000)
      const response = await fetcher(current, { redirect: 'manual', signal: controller.signal,
        credentials: 'omit', headers: { 'User-Agent': 'journey-desk', 'Cache-Control': 'no-cache' } })
      deadline(timeouts.idleMs ?? 20000)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = new URL(response.headers.get('location'), current).href
        continue
      }
      if (response.status === 404) { await response.body?.cancel(); return false }
      const length = Number(response.headers.get('content-length') || 0)
      if (response.status !== 200 || !Number.isSafeInteger(length) || length < 0 || length > limit || !response.body) {
        await response.body?.cancel(); throw new Error('更新服务器返回的内容无效或不完整')
      }
      let total = 0
      for await (const chunk of response.body) {
        total += chunk.length
        if (total > limit) { controller.abort(); throw new Error('更新下载超过大小上限') }
        await receive(chunk, total)
        deadline(timeouts.idleMs ?? 20000)
      }
      return true
    }
    throw new Error('更新重定向次数过多')
  } finally { clearTimeout(timeout); clearTimeout(idleTimer); controller.abort(); signal?.removeEventListener('abort', abort) }
}

export class ClientUpdater {
  constructor(context, { idle = () => true, fetcher, timeouts } = {}) {
    this.ctx = context; this.idle = idle; this.fetcher = fetcher; this.timeouts = timeouts
    this.state = { phase: 'idle', repository: 'https://github.com/coolminerchan/journey-desk' }
  }
  get root() { return join(this.ctx.userData, 'updates') }
  async config() {
    const trust = JSON.parse(await readFile(join(this.ctx.here, 'client-update.json'), 'utf8'))
    if (!/^[\w.-]+\/[\w.-]+$/.test(trust.repository)) throw new Error('更新仓库配置无效')
    const version = JSON.parse(await readFile(join(this.ctx.here, 'product.json'), 'utf8')).version
    return { trust, version }
  }
  set(fields) { Object.assign(this.state, fields); this.ctx.send?.() }
  sources(preferred) { return [...SOURCES].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)) }
  route(source, attempt) {
    this.set({ source: source.id, sourceLabel: source.label,
      hint: attempt ? `当前线路未完成，正在切换至${source.label}。` : `正在通过${source.label}连接。` })
  }
  cancel() { this.abort?.abort() }
  async guarded(action) {
    if (!this.idle() || this.running) throw new Error('请先退出游戏并等待保存完成，再操作更新')
    this.running = true; this.abort = new AbortController()
    try { return await action() } catch (error) {
      this.set({ phase: 'failed', hint: '请检查网络后重试，或从发行页手动下载完整包。',
        error: '更新未能完成，当前版本和备份均已保留。请稍后重试。' })
      throw error
    } finally { this.running = false; this.abort = null }
  }
  async check() { return this.guarded(async () => {
    this.release = null; this.releaseSource = null
    this.set({ phase: 'checking', error: '', source: null, sourceLabel: '', availableVersion: '', fallback: false, updateKind: '', downloadBytes: 0 })
    const { trust, version } = await this.config()
    const feed = `https://github.com/${trust.repository}/releases/latest/download/client-update.json`
    let lastError
    for (const [attempt, source] of this.sources().entries()) {
      this.route(source, attempt)
      try {
        const chunks = []
        const found = await request(feed, source, 65536, async chunk => chunks.push(chunk), this.fetcher, this.abort.signal,
          { ...this.timeouts, totalMs: this.timeouts?.totalMs ?? 20000 })
        if (!found) continue
        const release = signedRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), trust, version)
        this.release = release; this.releaseSource = source.id
        const delta = release.deltas?.find(part => part.from_version === version && part.bytes < release.bytes)
        this.set({ phase: release.newer ? 'available' : 'current', version, availableVersion: release.version,
          updateKind: delta ? 'delta' : 'full', downloadBytes: delta?.bytes ?? release.bytes, fullBytes: release.bytes,
          hint: release.newer ? '发现新版本，下载后会验证签名、文件校验值和包内容。' : '当前已是最新版本。' })
        return true
      } catch (error) { if (this.abort.signal.aborted) throw error; lastError = error }
    }
    if (lastError) throw lastError
    this.set({ phase: 'unavailable', hint: '尚无可公开下载的版本。' }); return false
  }) }
  async prepare() { return this.guarded(async () => {
    if (!this.release?.newer) throw new Error('请先检查可用的新版本')
    const release = this.release
    const { version } = await this.config()
    const delta = release.deltas?.find(part => part.from_version === version && part.bytes < release.bytes)
    if (delta) {
      const base = resolve(this.ctx.here, '../..')
      this.set({ phase: 'verifying', hint: '正在核对本机文件，未改动的文件将直接复用。', fallback: false })
      try {
        await verifyBasePackage(base, version, delta.base_manifest_sha256)
        if (this.abort.signal.aborted) throw Error('更新已取消')
        await this.prepareArtifact({ ...delta, version: release.version }, { ...delta, base })
        return true
      } catch (error) {
        if (this.abort.signal.aborted) throw error
        this.set({ fallback: true, hint: '增量更新未能完成，已改用完整更新。' })
      }
    }
    return this.prepareArtifact(release)
  }) }
  async prepareArtifact(release, delta = null) {
    await mkdir(this.root, { recursive: true })
    const file = join(this.root, `client-${release.version}-${randomUUID()}.zip`), pending = file + '.part'
    this.set({ phase: 'downloading', progress: 0, error: '', updateKind: delta ? 'delta' : 'full', downloadBytes: release.bytes })
    let handle, target, prepared = false
    try {
      let downloaded = false, lastError
      for (const [attempt, source] of this.sources(this.releaseSource).entries()) {
        this.route(source, attempt); this.set({ progress: 0 })
        try {
          handle = await open(pending, 'wx')
          const hash = createHash('sha256')
          const found = await request(release.url, source, release.bytes, async (chunk, bytes) => {
            await handle.writeFile(chunk); hash.update(chunk)
            const progress = Math.floor(bytes / release.bytes * 100)
            if (progress !== this.state.progress) this.set({ progress })
          }, this.fetcher, this.abort.signal, this.timeouts)
          if (!found || (await handle.stat()).size !== release.bytes || hash.digest('hex') !== release.sha256) throw new Error('更新文件校验失败')
          await handle.sync(); await handle.close(); handle = null
          downloaded = true; break
        } catch (error) {
          await handle?.close().catch(() => {}); handle = null
          await unlink(pending).catch(() => {})
          if (this.abort.signal.aborted) throw error
          lastError = error
        }
      }
      if (!downloaded) throw lastError
      await rename(pending, file)
      this.set({ phase: 'verifying' })
      target = join(this.root, `version-${release.version}-${randomUUID()}`)
      const args = ['-B', '-X', 'utf8', join(this.ctx.here, 'client_update_package.py'), '--input', file,
        '--output', target, '--version', release.version, '--sha256', release.sha256]
      if (delta) args.push('--base-installation', delta.base, '--from-version', delta.from_version,
        '--base-manifest-sha256', delta.base_manifest_sha256, '--target-manifest-sha256', delta.target_manifest_sha256)
      if (this.abort.signal.aborted) throw Error('更新已取消')
      const installed = JSON.parse(await this.ctx.command(this.ctx.python(), args, { persistent: true }).done)
      if (this.abort.signal.aborted) throw Error('更新已取消')
      if (!installed.executable || installed.version !== release.version || installed.path !== target || (delta && installed.kind !== 'delta')) throw new Error('更新包安装验证失败')
      await writeFile(join(this.root, 'prepared.json'), JSON.stringify({ version: release.version, path: target, sha256: release.sha256 }))
      this.installed = installed
      prepared = true
      this.set({ phase: 'ready', hint: '新版本已验证。点击更新后将关闭窗口并替换当前目录的程序，原有入口和快捷方式继续使用。' })
      return true
    } finally {
      await handle?.close().catch(() => {})
      await unlink(pending).catch(() => {})
      await unlink(file).catch(() => {})
      // Only this attempt's uniquely named, unredirected stage is disposable.
      // Earlier prepared versions and the installed application remain intact.
      if (target && !prepared) {
        const path = resolve(target), root = await realpath(this.root)
        if (dirname(path).toLowerCase() === root.toLowerCase() && /^version-\d+\.\d+\.\d+-[a-f0-9-]{36}$/.test(basename(path))) {
          const entry = await lstat(path).catch(() => null)
          if (entry?.isDirectory() && !entry.isSymbolicLink() && (await realpath(path)).toLowerCase() === path.toLowerCase())
            await rm(path, { recursive: true, force: true, maxRetries: 3 })
        }
      }
    }
  }
  async launch() { return this.guarded(async () => {
    if (this.state.phase !== 'ready' || !this.installed || !this.ctx.quit) throw new Error('请先下载并验证新版本')
    await startApply({ here: this.ctx.here, userData: this.ctx.userData, source: this.installed.path,
      version: this.installed.version, quit: () => this.ctx.quit() })
    this.set({ phase: 'restarting', hint: '正在关闭窗口并更新原目录；完成后会自动重新打开。' })
    return true
  }) }
}
