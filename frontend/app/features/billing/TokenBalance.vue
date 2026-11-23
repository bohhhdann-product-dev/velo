<script setup lang="ts">
import { Coins, Plus } from 'lucide-vue-next'
import { useBillingStore } from '~/stores/billing'
import { useWorkspaceStore } from '~/stores/workspace'
import { formatTokens } from '~/entities/billing/types'

const billing = useBillingStore()
const workspace = useWorkspaceStore()
onMounted(() => void billing.refresh())
function refreshOnFocus() { void billing.refresh() }
onMounted(() => window.addEventListener('focus', refreshOnFocus))
onBeforeUnmount(() => window.removeEventListener('focus', refreshOnFocus))
</script>

<template>
  <NuxtLink v-if="workspace.live" to="/billing" class="token-balance" aria-label="Token balance and purchases" title="Tokens · Buy tokens">
    <Coins class="size-[17px] shrink-0" />
    <span class="sidebar-label token-balance-copy">
      <strong>{{ billing.error ? 'Balance unavailable' : billing.wallet ? `${formatTokens(billing.wallet.availableTokens)} tokens` : 'Loading balance…' }}</strong>
      <small>Buy tokens</small>
    </span>
    <Plus class="size-4 sidebar-label" />
  </NuxtLink>
</template>

<style scoped>
.token-balance { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: var(--radius-xs); padding: 12px; margin-bottom: 14px; color: var(--ink-2); transition: background .15s, border-color .15s; }
.token-balance:hover, .token-balance.router-link-active { background: var(--surface-2); border-color: var(--line-strong); color: var(--ink); }
.token-balance-copy { flex: 1; min-width: 0; }
.token-balance-copy strong { display: block; font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.token-balance-copy small { display: block; font-size: 12px; margin-top: 3px; color: var(--accent); }
</style>
