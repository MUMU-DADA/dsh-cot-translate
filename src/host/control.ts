/**
 * 设置/模型/自测的编排层：host 路由背后的大脑。
 *
 * 职责：
 * - 持有当前设置（持久化在 `~/.dsh/cot-translate/settings.json`）；
 * - 按设置重建 `Translator`（模型改了要停掉旧的 llama-server 再起新的）；
 * - 提供模型列表/下载/删除、速度自测、provider 状态。
 *
 * 设置改动立即生效：重建 Translator 会清空译文 LRU，客户端下次请求就用新配置。
 */

import type { ProviderState, TranslateResponse } from '../shared'
import { Translator } from './chain'
import type { CotConfig, ProviderId } from './config'
import { normalizeConfig } from './config'
import {
  adoptLegacyModel,
  deleteModel,
  downloadModel,
  downloadStateOf,
  listModels,
  resolveModelPath,
  type DownloadState,
  type ModelStatus,
} from './models'
import type { FetchLike, TranslateContext } from './providers'
import { stopLocalServer } from './runtime'
import type { RuntimeDeps } from './runtime'
import { createSessionModelProvider } from './session-model'
import type { SessionModelHooks } from './session-model'
import { loadSettings, patchSettings, type CotSettings } from './settings'

export interface ControlDeps {
  /** profile patch 里的静态配置（baseURL、timeout 等）。 */
  staticConfig?: unknown
  fetchImpl?: FetchLike
  log?: (message: string) => void
  /** 「用当前对话的模型翻译」的宿主能力；缺省则该档不可用。 */
  sessionModel?: SessionModelHooks
  /** 本地服务拉起/停止的测试注入。 */
  launchDeps?: RuntimeDeps
}

/** 设置页一次读取的全部状态。 */
export interface ControlState {
  settings: CotSettings
  models: ModelStatus[]
  download: DownloadState[]
  /** 当前生效的 provider 链（排障用）。 */
  chain: string[]
  enabled: boolean
  target: string
  /** 插件自带模型是否就位（缺失时设置页会提示）。 */
  bundledReady: boolean
}

/** 自测结果。 */
export interface SelfTestResult {
  ok: boolean
  provider: string
  /** 整批耗时（毫秒）。 */
  ms: number
  /** 平均每段耗时（毫秒）。 */
  perSegmentMs: number
  segments: number
  error?: string
}

/** 自测用的固定样本（短、含术语与代码），不涉及用户内容。 */
const SELF_TEST_SAMPLES = [
  'I should check the repository layout first.',
  'The failing test is caused by a stale lockfile.',
  'Run `npm test` before touching the host half.',
]

export class Control {
  private settings: CotSettings
  private translator: Translator

  constructor(private readonly deps: ControlDeps = {}) {
    adoptLegacyModel()
    this.settings = loadSettings()
    this.translator = this.buildTranslator()
  }

  /** 设置 → Translator 配置。 */
  private buildConfig(): CotConfig {
    const base = normalizeConfig(this.deps.staticConfig)
    const modelPath = resolveModelPath(this.settings.modelId) ?? ''
    // 静态配置里的 chain 是底线（测试/自定义部署用它锁定来源）；
    // 「用对话模型翻译」只会在最前面插一档。
    const chain: ProviderId[] = [...base.chain]
    if (this.settings.useSessionModel && this.deps.sessionModel !== undefined) {
      if (!chain.includes('session')) chain.unshift('session')
    } else {
      const index = chain.indexOf('session')
      if (index >= 0) chain.splice(index, 1)
    }
    return {
      ...base,
      enabled: base.enabled && this.settings.enabled,
      target: this.settings.target,
      chain,
      llamacpp: { ...base.llamacpp, modelPath },
    }
  }

  /** 用当前设置重建 Translator（同时清空 LRU）。 */
  private buildTranslator(): Translator {
    const config = this.buildConfig()
    const extraProviders =
      this.deps.sessionModel === undefined
        ? []
        : [createSessionModelProvider(this.deps.sessionModel)]
    return new Translator({
      config,
      ...(this.deps.fetchImpl === undefined ? {} : { fetchImpl: this.deps.fetchImpl }),
      ...(this.deps.log === undefined ? {} : { log: this.deps.log }),
      ...(this.deps.launchDeps === undefined ? {} : { localRuntime: this.deps.launchDeps }),
      extraProviders,
    })
  }

  /** 只停掉本插件拉起的本地服务（换模型/关闭时）。 */
  private stopLocal(): void {
    stopLocalServer(this.buildConfig().llamacpp.baseURL)
  }

  /** 当前生效配置（路由要读 enabled/target/chain）。 */
  configView(): CotConfig {
    return this.buildConfig()
  }

  /** 设置页需要的状态。 */
  state(): ControlState {
    const config = this.buildConfig()
    const models = listModels()
    return {
      settings: this.settings,
      models,
      download: models.map((model) => downloadStateOf(model.id)),
      chain: [...config.chain],
      enabled: config.enabled,
      target: config.target,
      bundledReady: models.some((model) => model.bundled && model.installed),
    }
  }

  /** 合并设置并立即生效。 */
  update(patch: unknown): ControlState {
    const previous = this.settings
    this.settings = patchSettings(patch)
    const modelChanged = previous.modelId !== this.settings.modelId
    const behaviorChanged =
      previous.useSessionModel !== this.settings.useSessionModel ||
      previous.enabled !== this.settings.enabled ||
      previous.target !== this.settings.target ||
      modelChanged
    if (modelChanged) this.stopLocal()
    if (behaviorChanged) this.translator = this.buildTranslator()
    return this.state()
  }

  /** 翻译入口（路由调用）。 */
  translate(segments: readonly string[], target?: string, sessionId?: string): Promise<TranslateResponse> {
    const context: TranslateContext | undefined =
      sessionId === undefined || sessionId === '' ? undefined : { sessionId }
    return target === undefined
      ? this.translator.translate(segments, this.settings.target, context)
      : this.translator.translate(segments, target, context)
  }

  /**
   * 下载/更新模型。返回的 promise 结束后会按需重启本地服务。
   * 下载进度通过 `downloadStateOf` 轮询（路由不阻塞等待）。
   */
  async download(id: string): Promise<void> {
    await downloadModel(id, this.deps.fetchImpl)
    // 如果下的正是当前模型，停掉旧服务让下次请求用新文件。
    if (id === this.settings.modelId) {
      this.stopLocal()
      this.translator = this.buildTranslator()
    }
  }

  /** 删除一个下载的模型；自带模型不可删。删掉的若是当前模型则回退自带。 */
  remove(id: string): ControlState {
    const removed = deleteModel(id)
    if (removed && id === this.settings.modelId) {
      this.update({ modelId: 'hy-mt2-1.8b-q4' })
    }
    return this.state()
  }

  /** 停掉本地服务并清空缓存；下次请求会按当前设置重新拉起。 */
  restart(): ControlState {
    this.stopLocal()
    this.translator = this.buildTranslator()
    return this.state()
  }

  /** 本地模型速度自测（固定样本，不碰用户内容）。 */
  async selftest(): Promise<SelfTestResult> {
    const started = Date.now()
    try {
      const result = await this.translator.translate(SELF_TEST_SAMPLES)
      const ms = Date.now() - started
      if (result.provider === '') {
        return {
          ok: false,
          provider: '',
          ms,
          perSegmentMs: Math.round(ms / SELF_TEST_SAMPLES.length),
          segments: SELF_TEST_SAMPLES.length,
          error: '所有 provider 都不可用',
        }
      }
      return {
        ok: true,
        provider: result.provider,
        ms,
        perSegmentMs: Math.round(ms / SELF_TEST_SAMPLES.length),
        segments: SELF_TEST_SAMPLES.length,
      }
    } catch (error) {
      const ms = Date.now() - started
      return {
        ok: false,
        provider: '',
        ms,
        perSegmentMs: ms,
        segments: SELF_TEST_SAMPLES.length,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** 各 provider 的健康状态。 */
  providerStates(): Promise<ProviderState[]> {
    return this.translator.providerStates()
  }

  /** 本地模型列表（llama-server 或 ollama）。 */
  modelsList(): Promise<string[]> {
    return this.translator.models()
  }
}
