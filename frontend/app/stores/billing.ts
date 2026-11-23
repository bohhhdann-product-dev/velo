import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'
import { useWorkspaceStore } from '~/stores/workspace'
import type { TokenCheckout, TokenWallet } from '~/entities/billing/types'

export const useBillingStore = defineStore('billing', () => {
  const workspace = useWorkspaceStore()
  const wallet = shallowRef<TokenWallet | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  let requestVersion = 0
  const checkoutRequests = new Map<string, string>()

  function reset() {
    requestVersion++
    wallet.value = null
    error.value = ''
    loading.value = false
    checkoutRequests.clear()
  }
  watch(() => workspace.sessionVersion, reset, { flush: 'sync' })

  async function refresh() {
    if (!workspace.live || !workspace.userId) return
    const session = workspace.sessionVersion, version = ++requestVersion
    loading.value = true
    try {
      const result = await workspace.request<TokenWallet>('/api/billing')
      workspace.assertSession(session)
      if (version !== requestVersion) return
      wallet.value = result
      error.value = ''
    } catch (cause) {
      if (session !== workspace.sessionVersion || version !== requestVersion) return
      error.value = cause instanceof Error ? cause.message : 'Could not load your token balance.'
    } finally {
      if (session === workspace.sessionVersion && version === requestVersion) loading.value = false
    }
  }

  async function createCheckout(packId: string) {
    const session = workspace.sessionVersion
    const key = checkoutRequests.get(packId) ?? crypto.randomUUID()
    checkoutRequests.set(packId, key)
    const checkout = await workspace.request<TokenCheckout>('/api/billing/checkouts', {
      method: 'POST', body: { packId, idempotencyKey: key },
    })
    workspace.assertSession(session)
    checkoutRequests.delete(packId)
    return checkout
  }

  async function getCheckout(id: string) {
    const session = workspace.sessionVersion
    const checkout = await workspace.request<TokenCheckout>(`/api/billing/checkouts/${encodeURIComponent(id)}`)
    workspace.assertSession(session)
    return checkout
  }

  async function confirmCheckout(id: string) {
    const session = workspace.sessionVersion
    const result = await workspace.request<{ checkout: TokenCheckout; wallet: TokenWallet }>(
      `/api/billing/checkouts/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {} },
    )
    workspace.assertSession(session)
    // A slower balance request must not undo the confirmed purchase in the UI.
    requestVersion++
    wallet.value = result.wallet
    loading.value = false
    error.value = ''
    return result.checkout
  }

  return { wallet, loading, error, refresh, createCheckout, getCheckout, confirmCheckout }
})
