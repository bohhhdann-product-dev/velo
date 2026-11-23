<script setup lang="ts">
import { ArrowLeft, ArrowUpRight, Coins } from 'lucide-vue-next'
import VButton from '~/shared/ui/VButton.vue'
import { useBillingStore } from '~/stores/billing'
import { useWorkspaceStore } from '~/stores/workspace'
import { formatTokens, formatPrice } from '~/entities/billing/types'

useHead({ title: 'Tokens · Vela' })
const billing = useBillingStore()
const workspace = useWorkspaceStore()
const pending = shallowRef<string | null>(null)
const checkoutError = shallowRef('')
onMounted(() => void billing.refresh())
async function buy(packId: string) {
  if (pending.value) return
  pending.value = packId
  checkoutError.value = ''
  try {
    const checkout = await billing.createCheckout(packId)
    await navigateTo(`/billing/checkout/${checkout.id}`)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return
    checkoutError.value = cause instanceof Error ? cause.message : 'Could not open checkout. Try again.'
  } finally { pending.value = null }
}
function dateLabel(value: number) {
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <div class="billing-page">
    <NuxtLink to="/studio" class="billing-back"><ArrowLeft class="size-4" /> Back to studio</NuxtLink>
    <header class="billing-heading">
      <div><h1>Tokens</h1><p>One balance for your images and videos.</p></div>
      <div v-if="billing.wallet" class="wallet-summary" aria-live="polite">
        <span>Available</span><strong>{{ formatTokens(billing.wallet.availableTokens) }} <small>tokens</small></strong>
        <span v-if="billing.wallet.reservedTokens">{{ formatTokens(billing.wallet.reservedTokens) }} reserved for generations</span>
      </div>
    </header>
    <div v-if="!workspace.live" class="billing-message">Token purchases are available in a signed-in workspace. This is a temporary canvas demo.</div>
    <div v-else-if="billing.error" class="billing-message" role="alert">{{ billing.error }} <button class="billing-text-button" @click="billing.refresh">Try again</button></div>
    <div v-else-if="!billing.wallet" class="billing-message" role="status">Loading your balance…</div>
    <template v-if="billing.wallet">
      <div v-if="billing.wallet.demoCheckoutEnabled" class="billing-notice"><span class="demo-label">Test payments</span><p>Try buying tokens without a charge. Test purchases do not enable paid generation.</p></div>
      <div v-else class="billing-notice"><p>Purchases are not available yet. You can still view your balance and generation prices.</p></div>
      <section aria-labelledby="token-packs-heading">
        <div class="billing-section-heading"><h2 id="token-packs-heading">Buy tokens</h2><span>1,000 tokens = $1 · No subscription</span></div>
        <div class="token-packs">
          <article v-for="pack in billing.wallet.packs" :key="pack.id" class="token-pack">
            <Coins class="size-5" aria-hidden="true" />
            <h3>{{ formatTokens(pack.tokens) }} <span>tokens</span></h3>
            <p class="pack-price">{{ formatPrice(pack.priceCents) }} <span>{{ pack.currency }}</span></p>
            <VButton variant="primary" :disabled="Boolean(pending) || !billing.wallet.demoCheckoutEnabled" @click="buy(pack.id)">
              {{ pending === pack.id ? 'Opening checkout…' : 'Buy tokens' }}<ArrowUpRight v-if="pending !== pack.id" class="size-4" />
            </VButton>
          </article>
        </div>
        <p v-if="checkoutError" class="billing-error" role="alert">{{ checkoutError }}</p>
        <p class="billing-fineprint">Every account starts with {{ formatTokens(billing.wallet.welcomeTokens) }} welcome tokens. The generator shows the price for your model, quality, references and output count before you run it.</p>
      </section>
      <section class="token-activity" aria-labelledby="token-activity-heading">
        <div class="billing-section-heading"><h2 id="token-activity-heading">Token activity</h2><button class="billing-text-button" :disabled="billing.loading" @click="billing.refresh">{{ billing.loading ? 'Refreshing…' : 'Refresh' }}</button></div>
        <div v-if="!billing.wallet.ledger.length" class="billing-message">Your token activity will appear here.</div>
        <ul v-else class="activity-list">
          <li v-for="entry in billing.wallet.ledger" :key="entry.id">
            <div><span>{{ entry.label }}</span><time :datetime="new Date(entry.createdAt).toISOString()">{{ dateLabel(entry.createdAt) }}</time></div>
            <strong v-if="entry.kind === 'reserve' || entry.kind === 'release'">{{ entry.kind === 'reserve' ? 'Reserved' : 'Released' }}</strong>
            <strong v-else :class="{ positive: entry.amount > 0 }">{{ entry.amount > 0 ? '+' : '' }}{{ formatTokens(entry.amount) }} <small>tokens</small></strong>
          </li>
        </ul>
        <p class="billing-fineprint">Tokens are reserved when a generation starts. Failed or cancelled outputs release their reservation. Unconfirmed requests stay reserved until their outcome is known.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.billing-page { max-width: 1080px; margin: 0 auto; padding: 36px clamp(20px, 4vw, 56px) 64px; }
.billing-back { display: inline-flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: 13px; margin-bottom: 32px; }
.billing-back:hover { color: var(--ink); }
.billing-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 30px; }
.billing-heading h1 { margin: 0 0 8px; font-size: 30px; font-weight: 500; letter-spacing: -.035em; }
.billing-heading p { font-size: 14px; color: var(--ink-2); }
.wallet-summary { display: flex; flex-direction: column; gap: 6px; text-align: right; }
.wallet-summary > span { font-size: 12px; color: var(--ink-2); }
.wallet-summary strong { font-size: 25px; font-weight: 500; font-variant-numeric: tabular-nums; }
.wallet-summary small { font-size: 14px; font-weight: 400; color: var(--ink-2); }
.billing-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-xs); margin-bottom: 34px; font-size: 13px; color: var(--ink-2); }
.demo-label { color: var(--ink); font-weight: 500; }
.billing-section-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.billing-section-heading h2 { font-size: 16px; font-weight: 500; }
.billing-section-heading > span { font-size: 12px; color: var(--ink-2); }
.token-packs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.token-pack { padding: 22px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
.token-pack > svg { color: var(--ink-2); margin-bottom: 22px; }
.token-pack h3 { font-size: 25px; font-weight: 500; letter-spacing: -.025em; white-space: nowrap; }
.token-pack h3 span { font-size: 13px; color: var(--ink-2); font-weight: 400; letter-spacing: 0; }
.pack-price { font-size: 20px; margin: 12px 0 24px; }
.pack-price span { color: var(--ink-2); font-size: 12px; }
.token-pack button { width: 100%; }
.billing-fineprint { margin-top: 16px; max-width: 720px; font-size: 13px; line-height: 1.65; color: var(--ink-2); }
.token-activity { margin-top: 46px; }
.activity-list { list-style: none; padding: 0; }
.activity-list li { display: flex; justify-content: space-between; gap: 18px; padding: 17px 0; border-bottom: 1px solid var(--line); }
.activity-list li > div { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.activity-list time { color: var(--ink-3); font-size: 12px; }
.activity-list strong { white-space: nowrap; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }
.activity-list small { color: var(--ink-2); font-size: 12px; font-weight: 400; }
.activity-list .positive { color: var(--accent); }
.billing-text-button { color: var(--ink-2); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
.billing-text-button:disabled { opacity: .5; }
.billing-message { padding: 24px 0; font-size: 14px; line-height: 1.6; color: var(--ink-2); }
.billing-error { margin-top: 14px; font-size: 13px; color: var(--danger); }
@media (max-width: 850px) { .token-packs { grid-template-columns: 1fr; } .token-pack { display: grid; grid-template-columns: 1fr auto; gap: 10px 16px; align-items: center; } .token-pack > svg { display: none; } .token-pack h3 { font-size: 22px; } .pack-price { margin: 0; text-align: right; } .token-pack button { grid-column: 1 / -1; margin-top: 8px; } }
@media (max-width: 520px) { .billing-heading { flex-direction: column; gap: 20px; } .wallet-summary { text-align: left; } .activity-list strong small { display: block; text-align: right; } }
</style>
