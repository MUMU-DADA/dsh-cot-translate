/**
 * Client 半的最小 API 封装：只跟自己的 host 路由说话（同源、无 CORS）。
 *
 * 不缓存、不重试；失败向上抛，由界面显示。
 */

/** GET 一个 JSON。 */
export async function apiGet<T>(path: string, timeoutMs = 10000): Promise<T> {
  const response = await fetch(path, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** POST 一个 JSON（body 可省略）。 */
export async function apiPost<T>(
  path: string,
  body?: unknown,
  timeoutMs = 20000,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return (await response.json()) as T
}
