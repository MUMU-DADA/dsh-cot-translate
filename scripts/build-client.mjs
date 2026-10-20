/**
 * 打包 client 半为 DSH 模块加载器可消费的 bundle。
 *
 * bundle 必须包在 window.__ModuleLoader__.load({ id, factory }) 里：
 * - id 必须等于 package.json 的 name（profile composer 按包名提供资源）
 * - factory 接收 require，返回 module.exports
 * - React / react-dom 由 shell 的 PLATFORM_MODULES 提供，不能打进 bundle
 *
 * 打包手法参考 dsh-better-reasoning-effort（MIT）的 build-client.mjs。
 */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const { name: ID, version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const BANNER = `window.__ModuleLoader__.load({
\tid: "${ID}",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`
const FOOTER = `
\t\treturn module.exports;
\t}
});
`

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'react',
  target: 'es2020',
  sourcemap: true,
  minify: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  outfile: 'lib/client.js',
  define: { __COTX_VERSION__: JSON.stringify(VERSION) },
  banner: { js: BANNER },
  footer: { js: FOOTER },
})

const content = await readFile('lib/client.js', 'utf8')
if (!content.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('client bundle wrapper missing __ModuleLoader__.load preamble')
}
console.log(`built lib/client.js (${content.length} bytes)`)
