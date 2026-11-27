import { createHash, sign, verify } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const split = value.indexOf('='); return [value.slice(0, split).replace(/^--/, ''), value.slice(split + 1)]
}))
if (!['package', 'version', 'key', 'output'].every(name => args[name]) || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(args.version))
  throw new Error('Use --package=FILE --version=X.Y.Z --key=PRIVATE_KEY_FILE --output=FILE')
const filename = `Journey-Desk-${args.version}-Windows-x64.zip`
if (basename(args.package) !== filename) throw new Error('Package name and version do not match')
const trust = JSON.parse(await readFile(fileURLToPath(new URL('../client/client-update.json', import.meta.url)), 'utf8'))
const body = await readFile(args.package)
const payload = Buffer.from(JSON.stringify({ schema: 1, role: 'client', repository: trust.repository, version: args.version,
  url: `https://github.com/${trust.repository}/releases/download/v${args.version}/${filename}`,
  bytes: (await stat(args.package)).size, sha256: createHash('sha256').update(body).digest('hex') }))
const privateKey = await readFile(args.key, 'utf8'), signature = sign(null, payload, privateKey)
if (!verify(null, payload, trust.public_key, signature)) throw new Error('Private key does not match the bundled public key')
await writeFile(args.output, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n')
process.stdout.write(args.output + '\n')
