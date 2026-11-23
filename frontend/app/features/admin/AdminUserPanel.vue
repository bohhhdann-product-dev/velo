<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { Ban, Check, Gift, LockKeyholeOpen, ReceiptText } from 'lucide-vue-next'
import type { AdminActionState, AdminActivity, AdminTransaction, AdminUser } from '~/entities/admin/types'
import VButton from '~/shared/ui/VButton.vue'
import VModal from '~/shared/ui/VModal.vue'
import AdminGrantTokens from './AdminGrantTokens.vue'

const props = defineProps<{
  user: Readonly<AdminUser>
  balance: number
  depositedCents: number
  transactions: readonly AdminTransaction[]
  activity: readonly AdminActivity[]
  actorId: string
  action: AdminActionState
  confirmed: { kind: string; sequence: number } | null
  historyTruncated: boolean
  refreshing: boolean
}>()
const emit = defineEmits<{
  saveSettings: [payload: { nsfwEnabled: boolean; discountPercent: number }]
  grantTokens: [payload: { amount: number; note: string }]
  setBlocked: [payload: { blocked: boolean; reason: string }]
  dirtyChange: [dirty: boolean]
  retry: []
  refresh: []
}>()
const nsfw = shallowRef(props.user.nsfwEnabled)
const discount = shallowRef<string | number>(String(props.user.discountPercent))
const settingsError = shallowRef('')
const grantOpen = shallowRef(false)
const blockOpen = shallowRef(false)
const blockReason = shallowRef('')
const desiredBlocked = shallowRef(false)
const blockError = shallowRef('')
const locked = computed(() => props.action.pending || props.action.uncertain || props.refreshing)
const protectedAccount = computed(() => props.user.isAdmin || props.user.id === props.actorId)
const blockModalOpen = computed({ get: () => blockOpen.value, set: value => { if (!locked.value) blockOpen.value = value } })
const grantConfirmed = computed(() => props.confirmed?.kind === 'grants' ? props.confirmed.sequence : 0)
const tab = shallowRef<'payments' | 'activity'>('payments')
const paymentsTab = useTemplateRef<HTMLButtonElement>('payments-tab')
const activityTab = useTemplateRef<HTMLButtonElement>('activity-tab')
const discountNumber = computed(() => Number(discount.value))
const validDiscount = computed(() => String(discount.value).trim() !== '' && Number.isInteger(discountNumber.value)
  && discountNumber.value >= 0 && discountNumber.value <= 100)
const dirty = computed(() => nsfw.value !== props.user.nsfwEnabled || !validDiscount.value || discountNumber.value !== props.user.discountPercent)
const examplePrice = computed(() => validDiscount.value ? Math.ceil(80 * (100 - discountNumber.value) / 100) : null)
const deposits = computed(() => props.transactions.filter(item => item.kind === 'deposit' || item.kind === 'test_purchase').toSorted((a, b) => b.createdAt - a.createdAt))
const recentActivity = computed(() => [...props.activity].sort((a, b) => b.createdAt - a.createdAt))
const initials = computed(() => props.user.name.split(' ').map(part => part[0]).slice(0, 2).join(''))
const number = (value: number) => value.toLocaleString('en-US')
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
const date = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value)
const activityDate = (value: number) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value)
watch(dirty, value => emit('dirtyChange', value), { immediate: true })
watch([() => props.user.nsfwEnabled, () => props.user.discountPercent], (_value, previous) => {
  // A refresh after a revision conflict must not discard the administrator's draft.
  if (String(discount.value).trim() !== '' && nsfw.value === previous[0] && Number(discount.value) === previous[1]) resetSettings()
})
watch(() => props.confirmed, value => {
  if (value?.kind === 'settings') resetSettings()
  if (value?.kind === 'status') blockOpen.value = false
})
function resetSettings() {
  nsfw.value = props.user.nsfwEnabled
  discount.value = String(props.user.discountPercent)
  settingsError.value = ''
}
function saveSettings() {
  if (locked.value || props.action.conflict) return
  if (!validDiscount.value) {
    settingsError.value = 'Enter a whole percentage from 0 to 100.'
    return
  }
  settingsError.value = ''
  emit('saveSettings', { nsfwEnabled: nsfw.value, discountPercent: discountNumber.value })
}
function openBlockDialog() {
  desiredBlocked.value = !props.user.blocked
  blockReason.value = ''
  blockError.value = ''
  blockOpen.value = true
}
function confirmBlocked() {
  if (locked.value || props.action.conflict || protectedAccount.value) return
  if (desiredBlocked.value && !blockReason.value.trim()) {
    blockError.value = 'Add a short reason for blocking this user.'
    return
  }
  blockError.value = ''
  emit('setBlocked', { blocked: desiredBlocked.value, reason: blockReason.value.trim() })
}
async function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  tab.value = event.key === 'Home' ? 'payments' : event.key === 'End' ? 'activity' : tab.value === 'payments' ? 'activity' : 'payments'
  await nextTick()
  ;(tab.value === 'payments' ? paymentsTab.value : activityTab.value)?.focus()
}
</script>

<template>
  <section class="user-panel" aria-labelledby="admin-user-name">
    <header class="user-header">
      <div class="user-avatar" aria-hidden="true">{{ initials }}</div>
      <div class="user-identity"><h2 id="admin-user-name" :title="user.name">{{ user.name }}</h2><p v-if="user.email !== user.name">{{ user.email }}</p></div>
      <span class="user-state" :class="{ blocked: user.blocked }">{{ user.blocked ? 'Blocked' : 'Active' }}</span>
    </header>
    <div class="user-meta"><span>{{ user.id }}</span><span>Joined {{ date(user.joinedAt) }}</span></div>
    <div v-if="user.blocked" class="blocked-note"><Ban class="size-4 shrink-0" /><p>{{ user.blockReason || 'This account is blocked.' }}</p></div>

    <section class="user-wallet" aria-label="Account balance">
      <div class="wallet-values"><div><span>Token balance</span><strong>{{ number(balance) }}</strong></div><div><span>Total deposits</span><strong>{{ money(depositedCents) }}</strong></div></div>
      <p v-if="user.reservedTokens" class="wallet-note">{{ number(user.reservedTokens) }} tokens reserved for pending generations.</p>
      <p v-if="user.testDepositedCents" class="wallet-note">{{ money(user.testDepositedCents) }} in simulated payments · excluded from deposits</p>
      <VButton variant="primary" class="grant-button" :disabled="locked || action.conflict" @click="grantOpen = true"><Gift class="size-4" />Add free tokens</VButton>
    </section>

    <form class="user-settings" novalidate @submit.prevent="saveSettings">
      <h3 class="section-title">Account settings</h3>
      <div class="nsfw-setting"><div><label id="admin-nsfw-label">NSFW / 18+</label><p id="admin-nsfw-description">Enable where the selected provider permits it.</p></div><button type="button" class="setting-switch" :disabled="locked" role="switch" :aria-checked="nsfw" aria-labelledby="admin-nsfw-label" aria-describedby="admin-nsfw-description" @click="nsfw = !nsfw"><span /></button></div>
      <div class="discount-setting"><label for="admin-discount">Generation discount</label><div class="discount-field"><input id="admin-discount" v-model="discount" :disabled="locked" type="number" inputmode="numeric" min="0" max="100" step="1" :aria-invalid="Boolean(settingsError)" :aria-describedby="settingsError ? 'admin-settings-error' : 'admin-discount-example'" @input="settingsError = ''" /><span aria-hidden="true">%</span></div></div>
      <p v-if="settingsError" id="admin-settings-error" class="form-error" role="alert">{{ settingsError }}</p>
      <p id="admin-discount-example" class="discount-example">{{ examplePrice === null ? 'Choose a percentage to preview the price.' : `An 80-token generation would cost ${examplePrice} tokens.` }} Token pack prices stay the same.</p>
      <div class="settings-actions"><span v-if="dirty" class="unsaved-label">Unsaved changes</span><span v-else class="saved-label"><Check class="size-3.5" />Saved</span><VButton v-if="dirty" variant="ghost" size="sm" :disabled="locked" @click="resetSettings">Cancel</VButton><VButton type="submit" size="sm" :disabled="!dirty || locked || action.conflict">{{ action.pending && action.kind === 'settings' ? 'Saving…' : 'Save changes' }}</VButton></div>
    </form>

    <section class="user-history">
      <div class="history-tabs" role="tablist" aria-label="User records" @keydown="tabKey">
        <button id="admin-payments-tab" ref="payments-tab" role="tab" type="button" :aria-selected="tab === 'payments'" :tabindex="tab === 'payments' ? 0 : -1" aria-controls="admin-user-records" @click="tab = 'payments'">Payments <span>{{ deposits.length }}</span></button>
        <button id="admin-activity-tab" ref="activity-tab" role="tab" type="button" :aria-selected="tab === 'activity'" :tabindex="tab === 'activity' ? 0 : -1" aria-controls="admin-user-records" @click="tab = 'activity'">Activity <span>{{ recentActivity.length }}</span></button>
      </div>
      <div id="admin-user-records" class="history-content" role="tabpanel" :aria-labelledby="tab === 'payments' ? 'admin-payments-tab' : 'admin-activity-tab'" tabindex="0">
        <template v-if="tab === 'payments'">
          <div v-if="!deposits.length" class="history-empty"><ReceiptText class="size-5" /><p>No payments yet</p><span>Free token grants appear in Activity.</span></div>
          <ul v-else class="payment-list"><li v-for="payment in deposits" :key="payment.id"><div><strong>{{ money(payment.amountCents) }}<small v-if="payment.kind === 'test_purchase'" class="test-payment">Simulated</small></strong><span>{{ number(payment.amountTokens) }} tokens</span></div><time :datetime="new Date(payment.createdAt).toISOString()">{{ date(payment.createdAt) }}</time></li></ul>
        </template>
        <template v-else><p v-if="!recentActivity.length" class="activity-empty">No admin changes yet.</p><ol v-else class="activity-list"><li v-for="entry in recentActivity" :key="entry.id"><p>{{ entry.label }}</p><time :datetime="new Date(entry.createdAt).toISOString()">{{ activityDate(entry.createdAt) }}</time><span class="activity-actor">By {{ entry.actorId }}</span></li></ol></template>
      </div>
      <p v-if="historyTruncated" class="history-limit">Showing the most recent records. Deposit totals include all payments.</p>
    </section>
    <footer class="user-access"><div><h3>{{ user.blocked ? 'Restore access' : 'Account access' }}</h3><p>{{ protectedAccount ? 'Administrator accounts cannot be blocked here.' : user.blocked ? 'Restore access and keep account settings.' : 'Block access while keeping balance and history.' }}</p></div><VButton :variant="user.blocked ? 'soft' : 'danger'" size="sm" :disabled="locked || action.conflict || protectedAccount" @click="openBlockDialog"><component :is="user.blocked ? LockKeyholeOpen : Ban" class="size-4" />{{ user.blocked ? 'Unblock' : 'Block user' }}</VButton></footer>
  </section>

  <AdminGrantTokens v-model:open="grantOpen" :user-name="user.name" :balance="balance" :action="action" :confirmed="grantConfirmed" @retry="emit('retry')" @refresh="emit('refresh')" @grant="emit('grantTokens', $event)" />
  <VModal v-model:open="blockModalOpen" :title="desiredBlocked ? 'Block user?' : 'Unblock user?'" :initial-focus="desiredBlocked ? 'admin-block-reason' : 'admin-unblock-cancel'">
    <form class="block-form" novalidate @submit.prevent="confirmBlocked">
      <p class="block-description"><strong>{{ user.name }}</strong> {{ desiredBlocked ? 'will lose access to Vela immediately.' : 'will regain access to Vela.' }} Their token balance and payment history will stay intact.</p>
      <template v-if="desiredBlocked"><label class="block-label" for="admin-block-reason">Reason</label><textarea id="admin-block-reason" v-model="blockReason" :disabled="locked" class="block-reason" rows="3" maxlength="160" placeholder="Why is this account being blocked?" :aria-invalid="Boolean(blockError)" :aria-describedby="blockError ? 'admin-block-error' : undefined" @input="blockError = ''" /><p v-if="blockError" id="admin-block-error" class="form-error" role="alert">{{ blockError }}</p></template>
      <p v-if="action.kind === 'status' && action.error" class="form-error" role="alert">{{ action.error }}</p>
      <div class="block-actions"><VButton id="admin-unblock-cancel" variant="ghost" :disabled="locked" @click="blockOpen = false">Cancel</VButton><VButton v-if="action.uncertain" @click="emit('retry')">Check result / retry</VButton><VButton v-else-if="action.conflict" @click="emit('refresh')">Refresh account</VButton><VButton v-else type="submit" :variant="desiredBlocked ? 'danger' : 'primary'" :disabled="locked">{{ action.pending ? 'Saving…' : desiredBlocked ? 'Block user' : 'Unblock user' }}</VButton></div>
    </form>
  </VModal>
</template>

<style scoped>
.user-panel { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.user-header { display: flex; align-items: center; gap: 10px; padding: 22px 22px 0; }
.user-avatar { width: 38px; height: 38px; display: grid; place-items: center; flex: none; border: 1px solid var(--line-strong); background: var(--surface-2); border-radius: 11px; color: var(--ink-2); font-size: 13px; font-weight: 500; }
.user-identity { min-width: 0; flex: 1; }
.user-identity h2 { font-size: 16px; font-weight: 500; letter-spacing: -.025em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-identity p { color: var(--ink-2); font-size: 12px; overflow-wrap: anywhere; margin-top: 3px; }
.user-state { flex-shrink: 0; color: var(--ink-2); border: 1px solid var(--line-strong); border-radius: 5px; padding: 3px 6px; font-size: 11px; }
.user-state.blocked { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 25%, transparent); }
.user-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--ink-3); font-size: 11px; padding: 14px 22px 20px; }
.user-meta > span { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.blocked-note { display: flex; align-items: flex-start; gap: 8px; padding: 12px; margin: 0 22px 18px; background: color-mix(in srgb, var(--danger) 6%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 18%, transparent); border-radius: 8px; color: var(--ink-2); font-size: 12px; }
.blocked-note svg { color: var(--danger); }
.blocked-note p { overflow-wrap: anywhere; }
.user-wallet { padding: 20px 22px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.wallet-values { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
.wallet-values > div { display: flex; flex-direction: column; gap: 6px; }
.wallet-values > div + div { border-left: 1px solid var(--line); padding-left: 20px; }
.wallet-values span { font-size: 12px; color: var(--ink-2); }
.wallet-values strong { font-size: 24px; font-weight: 500; letter-spacing: -.035em; font-variant-numeric: tabular-nums; }
.grant-button { width: 100%; }
.wallet-note { margin: 0 0 14px; font-size: 11px; color: var(--ink-3); line-height: 1.6; }
.test-payment { margin-left: 7px; font-size: 10px; color: var(--ink-3); border: 1px solid var(--line-strong); padding: 2px 5px; border-radius: 4px; }
.activity-actor { display: block; font-size: 10px; color: var(--ink-3); overflow-wrap: anywhere; margin-top: 3px; }
.history-limit { padding: 12px 22px; font-size: 11px; color: var(--ink-3); border-top: 1px solid var(--line); }
.setting-switch:disabled { opacity: .5; cursor: not-allowed; }
.user-settings { padding: 22px; }
.section-title { font-size: 13px; font-weight: 500; margin-bottom: 19px; }
.nsfw-setting { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 23px; }
.nsfw-setting label, .discount-setting > label { color: var(--ink); font-size: 13px; }
.nsfw-setting p { color: var(--ink-3); font-size: 12px; margin-top: 5px; }
.setting-switch { width: 36px; height: 22px; flex: none; padding: 3px; border-radius: 12px; background: var(--surface-3); border: 1px solid var(--line-strong); }
.setting-switch span { display: block; width: 14px; height: 14px; border-radius: 50%; background: var(--ink-2); transition: transform 160ms, background-color 160ms; }
.setting-switch[aria-checked="true"] { background: var(--accent); border-color: var(--accent); }
.setting-switch[aria-checked="true"] span { transform: translateX(14px); background: var(--ink-inverse); }
.discount-setting { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
.discount-field { display: flex; align-items: center; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--canvas); height: 36px; width: 84px; flex: none; }
.discount-field input { width: 100%; min-width: 0; padding: 8px 0 8px 11px; border-radius: var(--radius-control); font-size: 13px; background: transparent; color: var(--ink); appearance: textfield; -moz-appearance: textfield; }
.discount-field input::-webkit-inner-spin-button { appearance: none; }
.discount-field span { color: var(--ink-3); font-size: 12px; padding-right: 10px; }
.discount-field:has(input[aria-invalid="true"]) { border-color: var(--danger); }
.discount-example { color: var(--ink-3); font-size: 12px; line-height: 1.6; margin-top: 11px; }
.settings-actions { display: flex; align-items: center; gap: 5px; margin-top: 20px; }
.unsaved-label, .saved-label { margin-right: auto; font-size: 11px; color: var(--ink-3); display: flex; align-items: center; gap: 4px; }
.unsaved-label { color: var(--ink-2); }
.form-error { color: var(--danger); font-size: 12px; margin-top: 8px; }
.user-history { border-top: 1px solid var(--line); }
.history-tabs { display: flex; gap: 24px; padding: 0 22px; border-bottom: 1px solid var(--line); }
.history-tabs button { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-3); border-bottom: 2px solid transparent; padding: 15px 0 12px; }
.history-tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink-2); }
.history-tabs button span { font-size: 11px; color: var(--ink-3); }
.history-content { max-height: 245px; min-height: 112px; overflow-y: auto; padding: 0 22px; }
.payment-list, .activity-list { list-style: none; padding: 0; margin: 0; }
.payment-list li { padding: 13px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); }
.payment-list li:last-child, .activity-list li:last-child { border-bottom: 0; }
.payment-list li > div { display: flex; flex-direction: column; gap: 3px; }
.payment-list strong { font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
.payment-list span, .payment-list time, .activity-list time { font-size: 11px; color: var(--ink-3); }
.activity-list li { padding: 13px 0; border-bottom: 1px solid var(--line); }
.activity-list p { font-size: 12px; line-height: 1.6; color: var(--ink-2); overflow-wrap: anywhere; margin-bottom: 3px; }
.history-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 25px 0; color: var(--ink-3); }
.history-empty p { font-size: 13px; color: var(--ink-2); }
.history-empty span, .activity-empty { font-size: 12px; color: var(--ink-3); }
.activity-empty { padding: 25px 0; }
.user-access { padding: 18px 22px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.user-access h3 { color: var(--ink-2); font-size: 12px; font-weight: 500; }
.user-access p { color: var(--ink-3); font-size: 11px; line-height: 1.6; margin-top: 4px; }
.block-description { color: var(--ink-2); font-size: 14px; line-height: 1.65; margin-bottom: 22px; overflow-wrap: anywhere; }
.block-description strong { color: var(--ink); font-weight: 500; }
.block-label { display: block; font-size: 13px; margin-bottom: 8px; }
.block-reason { display: block; width: 100%; resize: vertical; min-height: 88px; max-height: 180px; padding: 10px 12px; color: var(--ink); background: var(--canvas); border: 1px solid var(--line-strong); border-radius: var(--radius-control); font-size: 13px; line-height: 1.6; }
.block-reason::placeholder { color: var(--ink-3); }
.block-reason[aria-invalid="true"] { border-color: var(--danger); }
.block-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
@media (max-width: 400px) { .user-header { gap: 8px; } .user-state { margin-left: 0; } .user-header, .user-settings, .user-wallet, .user-access { padding-left: 18px; padding-right: 18px; } .user-meta { padding-left: 18px; padding-right: 18px; } .user-avatar { display: none; } .user-identity h2 { font-size: 15px; } .wallet-values strong { font-size: 23px; } }
@media (prefers-reduced-motion: reduce) { .setting-switch span { transition: none; } }
</style>
