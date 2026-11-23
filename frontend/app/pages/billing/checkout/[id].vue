<script setup lang="ts">
import { ArrowLeft, Check, Coins } from 'lucide-vue-next'
import VButton from '~/shared/ui/VButton.vue'
import { useBillingStore } from '~/stores/billing'
import { useWorkspaceStore } from '~/stores/workspace'
import { formatTokens, formatPrice, type TokenCheckout } from '~/entities/billing/types'

useHead({ title: 'Test checkout · Vela' })
const route = useRoute()
const billing = useBillingStore()
const workspace = useWorkspaceStore()
const checkout = shallowRef<TokenCheckout | null>(null)
const loading = shallowRef(true)
const confirming = shallowRef(false)
const error = shallowRef('')
let version = 0
async function load() {
  const current = ++version
  checkout.value = null
  loading.value = true
  error.value = ''
  try {
    const result = await billing.getCheckout(String(route.params.id))
    if (current === version) checkout.value = result
    if (result.status === 'paid') void billing.refresh()
  } catch (cause) {
    if (current !== version || (cause instanceof DOMException && cause.name === 'AbortError')) return
    error.value = cause instanceof Error ? cause.message : 'Could not load this checkout.'
  } finally { if (current === version) loading.value = false }
}
onMounted(load)
watch(() => route.params.id, load)
watch(() => workspace.sessionVersion, () => { version++; checkout.value = null; error.value = ''; confirming.value = false })
onBeforeUnmount(() => { version++ })
async function confirm() {
  if (!checkout.value || confirming.value || checkout.value.status === 'paid') return
  const current = version
  confirming.value = true
  error.value = ''
  try {
    const result = await billing.confirmCheckout(checkout.value.id)
    if (current === version) checkout.value = result
  } catch (cause) {
    if (current !== version || (cause instanceof DOMException && cause.name === 'AbortError')) return
    error.value = cause instanceof Error ? cause.message : 'We could not confirm the payment. Retry to check the same purchase.'
  } finally { if (current === version) confirming.value = false }
}
</script>

<template>
  <div class="checkout-page">
    <NuxtLink to="/billing" class="checkout-back"><ArrowLeft class="size-4" /> Back to tokens</NuxtLink>
    <div v-if="loading" class="checkout-loading" role="status">Loading checkout…</div>
    <section v-else-if="checkout" class="checkout-card" :aria-busy="confirming">
      <template v-if="checkout.status === 'paid'">
        <Check class="checkout-symbol" aria-hidden="true" />
        <h1>Tokens added</h1>
        <p role="status">{{ formatTokens(checkout.tokens) }} tokens are now in your account.</p>
        <div class="checkout-total"><span>Available balance</span><strong>{{ billing.wallet ? formatTokens(billing.wallet.availableTokens) : '…' }} tokens</strong></div>
        <NuxtLink to="/studio" class="checkout-primary">Back to studio</NuxtLink>
        <p class="checkout-caption">This was a test payment. No money was charged. Test tokens do not enable paid generation.</p>
      </template>
      <template v-else>
        <Coins class="checkout-symbol" aria-hidden="true" />
        <h1>Test checkout</h1>
        <p>Complete a simulated purchase. No card details or real payment needed.</p>
        <dl class="checkout-summary"><div><dt>Token pack</dt><dd>{{ formatTokens(checkout.tokens) }} tokens</dd></div><div><dt>One-time price</dt><dd>{{ formatPrice(checkout.priceCents) }} {{ checkout.currency }}</dd></div></dl>
        <div class="checkout-total"><span>Charged today</span><strong>$0.00</strong></div>
        <VButton variant="primary" size="lg" class="checkout-confirm" :disabled="confirming || !checkout.demo" @click="confirm">{{ confirming ? 'Confirming…' : 'Complete test purchase' }}</VButton>
        <p class="checkout-caption">Your tokens will be added after confirmation. Retrying this purchase will not add them twice.</p>
      </template>
      <p v-if="error" class="checkout-error" role="alert">{{ error }}</p>
    </section>
    <div v-else-if="error" class="checkout-loading" role="alert"><p>{{ error }}</p><VButton class="mt-4" @click="load">Try again</VButton></div>
  </div>
</template>

<style scoped>
.checkout-page { max-width: 560px; margin: 0 auto; padding: 36px 24px 64px; }
.checkout-back { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: 13px; margin-bottom: 32px; }
.checkout-back:hover { color: var(--ink); }
.checkout-card { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: clamp(22px, 4vw, 36px); background: var(--surface); }
.checkout-symbol { color: var(--accent); width: 28px; height: 28px; margin-bottom: 24px; }
.checkout-card h1 { margin: 0 0 12px; font-size: 26px; font-weight: 500; letter-spacing: -.025em; }
.checkout-card > p { color: var(--ink-2); font-size: 14px; line-height: 1.65; }
.checkout-summary { margin: 28px 0 0; }
.checkout-summary > div { display: flex; justify-content: space-between; gap: 20px; margin: 14px 0; font-size: 14px; }
.checkout-summary dt { color: var(--ink-2); }
.checkout-summary dd { text-align: right; }
.checkout-total { display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid var(--line); padding: 22px 0; margin-top: 22px; font-size: 14px; }
.checkout-total span { color: var(--ink-2); }
.checkout-total strong { font-weight: 500; text-align: right; }
.checkout-confirm { width: 100%; }
.checkout-primary { display: flex; justify-content: center; padding: 12px 20px; border-radius: var(--radius-xs); background: var(--accent); color: #000; font-size: 14px; font-weight: 500; }
.checkout-primary:hover { background: var(--accent-hover); }
.checkout-card .checkout-caption { font-size: 12px; margin-top: 18px; }
.checkout-card .checkout-error { color: var(--danger); margin-top: 18px; }
.checkout-loading { color: var(--ink-2); font-size: 14px; padding: 32px 0; }
</style>
