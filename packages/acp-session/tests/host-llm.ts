/**
 * Host-shaped llm used by tests. Mirrors dsh-llm `prepareRoutes`:
 * `adapter.providerRetryPolicy(provider) ?? default`. A missing method is a
 * TypeError and the provider never lands in `listProviders()`.
 */
import type { AcpCatalogAdapter, AdapterRegistrationHandle } from '../src/models.ts'

export function createHostLikeLlm() {
  const routes = new Map<string, { id: string; name: string; adapter: AcpCatalogAdapter }>()

  const commit = (providers: string[], adapter: AcpCatalogAdapter, owned: Set<string>): void => {
    for (const provider of providers) {
      if (provider.length === 0) throw new Error('adapter provider names must be non-empty')
      const info = adapter.providerInfo(provider)
      if (typeof info.id !== 'string' || info.id !== provider || typeof info.name !== 'string' || info.name.length === 0) {
        throw new Error(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`)
      }
      // Live miss: TypeError if providerRetryPolicy is not implemented.
      adapter.providerRetryPolicy(provider)
      adapter.imageRequestPricing(provider, '')
    }
    for (const provider of owned) routes.delete(provider)
    owned.clear()
    for (const provider of providers) {
      const info = adapter.providerInfo(provider)
      routes.set(provider, { id: info.id, name: info.name, adapter })
      owned.add(provider)
    }
  }

  return {
    listProviders() {
      return [...routes.values()].map(({ id, name }) => ({ id, name }))
    },
    listModels(provider: string) {
      const route = routes.get(provider)
      if (route === undefined) return Promise.reject(new Error(`no adapter serves provider "${provider}"`))
      return route.adapter.listModels(provider)
    },
    registerAdapter(providers: string[], adapter: AcpCatalogAdapter): AdapterRegistrationHandle {
      const owned = new Set<string>()
      commit(providers, adapter, owned)
      const handle = (() => {
        for (const provider of owned) routes.delete(provider)
        owned.clear()
      }) as AdapterRegistrationHandle
      handle.replace = (next: string[]) => { commit(next, adapter, owned) }
      return handle
    },
  }
}
