import { createHash, sign, verify } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signedRelease } from '../client/client-update.mjs'

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf('='); return [value.slice(0, split).replace(/^--/, ''), value.slice(split + 1)]
}))
if (!['package', 'version', 'key', 'output'].every(name => args[name]) || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(args.version))
  throw new Error('Use --package=FILE --version=X.Y.Z --key=PRIVATE_KEY_FILE --output=FILE')
const filename = `Journey-Desk-${args.version}-Windows-x64.zip`
if (basename(args.package) !== filename) throw new Error('Package name and version do not match')
const trust = JSON.parse(await readFile(fileURLToPath(new URL('../client/client-update.json', import.meta.url)), 'utf8'))
const body = await readFile(args.package)
const deltas = []
if (args.deltas) {
  // The file lists sidecar paths, not user data; only the selected public
  // artifact metadata below is included in the signed release descriptor.
  const paths = JSON.parse(await readFile(args.deltas, 'utf8'))
  if (!Array.isArray(paths) || paths.length > 32) throw Error('Invalid delta sidecar list')
  for (const entry of paths) {
    if (typeof entry !== 'string') throw Error('Invalid delta sidecar path')
    const path = resolve(dirname(args.deltas), entry)
    const item = JSON.parse(await readFile(path, 'utf8'))
    if (item.version !== args.version || item.file !== `Journey-Desk-Delta-${item.from_version}-to-${args.version}-Windows-x64.zip`)
      throw Error('Delta sidecar version or filename mismatch')
    const deltaFile = join(dirname(path), item.file), content = await readFile(deltaFile)
    if (content.length !== item.bytes || createHash('sha256').update(content).digest('hex') !== item.sha256)
      throw Error('Delta artifact changed since generation')
    deltas.push({ from_version: item.from_version, bytes: item.bytes, sha256: item.sha256,
      base_manifest_sha256: item.base_manifest_sha256, target_manifest_sha256: item.target_manifest_sha256,
      url: `https://github.com/${trust.repository}/releases/download/v${args.version}/${item.file}` })
  }
}
const payload = Buffer.from(JSON.stringify({ schema: 1, role: 'client', repository: trust.repository, version: args.version,
  url: `https://github.com/${trust.repository}/releases/download/v${args.version}/${filename}`,
  bytes: (await stat(args.package)).size, sha256: createHash('sha256').update(body).digest('hex'), ...(deltas.length ? { deltas } : {}) }))
const privateKey = await readFile(args.key, 'utf8'), signature = sign(null, payload, privateKey)
if (!verify(null, payload, trust.public_key, signature)) throw new Error('Private key does not match the bundled public key')
signedRelease({ payload: payload.toString('base64'), signature: signature.toString('base64') }, trust, '0.0.0')
await writeFile(args.output, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n')
process.stdout.write(args.output + '\n')
