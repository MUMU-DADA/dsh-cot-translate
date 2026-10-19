/**
 * 打包 host 半为 ESM bundle。
 *
 * - 本插件自己的模块内联进产物；
 * - @deepseek-ai/* 保持 external（由 profile composer / 运行时提供），
 *   这样 bundle 不会把某个 harness 版本钉死。
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  external: ['@deepseek-ai/*'],
  outfile: 'lib/index.js',
})

console.log('built lib/index.js')
