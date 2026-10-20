import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.types.json'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
mkdirSync('lib/client/locales', { recursive: true })
for (const file of readdirSync('src/client/locales')) {
  if (file.endsWith('.json')) copyFileSync(`src/client/locales/${file}`, `lib/client/locales/${file}`)
}
