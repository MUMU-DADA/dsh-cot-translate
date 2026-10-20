/**
 * 输出每种语言的翻译进度（缺哪些 key），供翻译人员/CI 使用。
 *
 * 用法：`npm run i18n:status`
 * 规则：
 * - `zh.json` 是权威 key 清单；
 * - `en.json` 必须与 zh 完全一致（少 key 视为错误，多 key 视为错误）；
 * - 其它语言可以只翻一部分，缺的回退 en；出现 zh 里没有的 key 视为错误（防拼写错）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src', 'client', 'locales')
const read = (file) => JSON.parse(readFileSync(join(DIR, file), 'utf8'))

const zh = read('zh.json')
const zhKeys = Object.keys(zh).sort()
const files = readdirSync(DIR).filter((name) => name.endsWith('.json'))

let hasError = false
console.log(`基准（zh）: ${zhKeys.length} keys\n`)
for (const file of files) {
  const id = file.replace(/\.json$/, '')
  const dictionary = read(file)
  const keys = Object.keys(dictionary)
  const missing = zhKeys.filter((key) => !(key in dictionary))
  const unknown = keys.filter((key) => !(key in zh))
  const percent = Math.round(((zhKeys.length - missing.length) / zhKeys.length) * 100)
  const status = missing.length === 0 ? '✅' : '🟡'
  console.log(`${status} ${id.padEnd(8)} ${String(percent).padStart(3)}%  ${keys.length}/${zhKeys.length}`)
  if (unknown.length > 0) {
    hasError = true
    console.log(`   ✗ 未知 key: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ' …' : ''}`)
  }
  if (id === 'en' && missing.length > 0) {
    hasError = true
    console.log(`   ✗ en 缺少 key: ${missing.join(', ')}`)
  }
}

process.exitCode = hasError ? 1 : 0
