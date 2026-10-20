/**
 * 从 DSH 桌面端内置运行时里导出「客户端槽位目录」。
 *
 * 为什么需要它：`@deepseek-ai/dsh-cordis-client-runner` 的 bundle 内嵌了一份由
 * 源码类型生成的槽位目录（kind / scope / summary / ownerProps / replaceRisk /
 * occupants / example）。判断“某个 UI 位置能不能挂、挂了会不会顶掉官方渲染器”，
 * 查这份目录比读 bundle 猜快得多 —— 本项目 ADR-011 就是靠它否掉了内联方案。
 *
 * 用法：
 *   node scripts/dump-slots.mjs                  # 全部槽位，表格输出
 *   node scripts/dump-slots.mjs chat             # 只在 key/summary 里筛关键词
 *   node scripts/dump-slots.mjs --json           # 机器可读
 *   node scripts/dump-slots.mjs --file <bundle>  # 指定 bundle（默认用桌面端运行时）
 *
 * 只在开发期用；不参与构建，也不打进插件。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 默认 bundle：DSH Desktop 内置运行时的 client-runner。 */
const DEFAULT_BUNDLE = join(
  homedir(),
  'AppData',
  'Local',
  'Programs',
  'DSH Desktop',
  'resources',
  'dsh-runtime',
  'node_modules',
  '@deepseek-ai',
  'dsh-cordis-client-runner',
  'lib',
  'client.js',
)

const args = process.argv.slice(2)
const json = args.includes('--json')
const fileFlag = args.indexOf('--file')
const file = fileFlag === -1 ? DEFAULT_BUNDLE : args[fileFlag + 1]
const filter = args.find((arg, index) => !arg.startsWith('--') && index !== fileFlag + 1) ?? ''

if (!existsSync(file)) {
  console.error(`找不到 bundle: ${file}`)
  console.error('用 --file <path> 指定 DSH 运行时的 dsh-cordis-client-runner/lib/client.js')
  process.exit(1)
}

const source = await readFile(file, 'utf8')

// 目录里每条记录都以 key / kind / scope / summary 顺序出现。
const pattern =
  /key:\s*"([^"]+)",\s*kind:\s*"([^"]+)",\s*scope:\s*"([^"]+)",\s*summary:\s*"((?:[^"\\]|\\.)*)"/g

const rows = []
for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
  rows.push({
    key: match[1],
    kind: match[2],
    scope: match[3],
    summary: match[4].replace(/\\(.)/g, '$1'),
  })
}

if (rows.length === 0) {
  console.error('没有解析到槽位记录 —— 运行时的目录格式可能变了，需要更新本脚本的正则。')
  process.exit(1)
}

const needle = filter.toLowerCase()
const selected =
  needle === ''
    ? rows
    : rows.filter(
        (row) =>
          row.key.toLowerCase().includes(needle) || row.summary.toLowerCase().includes(needle),
      )

if (json) {
  console.log(JSON.stringify(selected, null, 2))
} else {
  for (const row of selected) {
    console.log(`${row.scope.padEnd(13)} ${row.kind.padEnd(6)} ${row.key}`)
    console.log(`${' '.repeat(21)}${row.summary}`)
  }
  console.log(`\n共 ${selected.length} 条（目录总计 ${rows.length} 条）`)
}
