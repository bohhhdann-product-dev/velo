<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import VModal from '~/shared/ui/VModal.vue'
import VButton from '~/shared/ui/VButton.vue'
import type { AdminActionState } from '~/entities/admin/types'

const props = defineProps<{ userName: string; balance: number; action: AdminActionState; confirmed: number }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ grant: [payload: { amount: number; note: string }]; retry: []; refresh: [] }>()
const amount = shallowRef<string | number>('1000')
const note = shallowRef('')
const error = shallowRef('')
const noteError = shallowRef('')
const locked = computed(() => props.action.pending || props.action.uncertain)
const modalOpen = computed({ get: () => open.value, set: value => { if (!locked.value) open.value = value } })
const parsedAmount = computed(() => Number(amount.value))
const validAmount = computed(() => String(amount.value).trim() !== '' && Number.isSafeInteger(parsedAmount.value)
  && parsedAmount.value >= 1 && parsedAmount.value <= 1_000_000)
const number = (value: number) => value.toLocaleString('en-US')
watch(open, (value) => {
  if (!value) return
  amount.value = '1000'
  note.value = ''
  error.value = ''
  noteError.value = ''
})
watch(() => props.confirmed, () => { open.value = false })
function submit() {
  if (locked.value || props.action.conflict) return
  if (!validAmount.value) {
    error.value = 'Enter a whole number between 1 and 1,000,000.'
    return
  }
  error.value = ''
  if (!note.value.trim()) {
    noteError.value = 'Add a short reason for this grant.'
    return
  }
  noteError.value = ''
  emit('grant', { amount: parsedAmount.value, note: note.value.trim() })
}
</script>

<template>
  <VModal v-model:open="modalOpen" title="Add free tokens" initial-focus="admin-grant-amount">
    <form class="grant-form" novalidate @submit.prevent="submit">
      <p class="grant-description">Add tokens to <strong>{{ userName }}</strong> without a payment.</p>
      <label class="grant-label" for="admin-grant-amount">Tokens to add</label>
      <input id="admin-grant-amount" v-model="amount" :disabled="locked" class="grant-input" type="number" inputmode="numeric" min="1" max="1000000" step="1" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'admin-grant-error' : undefined" @input="error = ''" />
      <div class="grant-presets" aria-label="Quick token amounts">
        <button v-for="preset in [500, 1000, 5000]" :key="preset" type="button" :disabled="locked" :aria-pressed="parsedAmount === preset" @click="amount = String(preset); error = ''">{{ number(preset) }}</button>
      </div>
      <p v-if="error" id="admin-grant-error" class="grant-error" role="alert">{{ error }}</p>
      <label class="grant-label" for="admin-grant-note">Reason <span>Required for the audit log</span></label>
      <input id="admin-grant-note" v-model="note" :disabled="locked" class="grant-input" type="text" maxlength="140" placeholder="e.g. Welcome bonus" :aria-invalid="Boolean(noteError)" :aria-describedby="noteError ? 'admin-grant-note-error' : undefined" @input="noteError = ''" />
      <p v-if="noteError" id="admin-grant-note-error" class="grant-error" role="alert">{{ noteError }}</p>
      <div class="grant-total"><span>Balance after grant</span><strong>{{ validAmount ? number(balance + parsedAmount) : '—' }} <small>tokens</small></strong></div>
      <p class="grant-footnote">Recorded as a free grant. Total deposits stay the same.</p>
      <p v-if="action.kind === 'grants' && action.error" class="grant-error" role="alert">{{ action.error }}</p>
      <div class="grant-actions">
        <VButton variant="ghost" :disabled="locked" @click="open = false">Cancel</VButton>
        <VButton v-if="action.uncertain" variant="primary" @click="emit('retry')">Check result / retry</VButton>
        <VButton v-else-if="action.conflict" @click="emit('refresh')">Refresh account</VButton>
        <VButton v-else type="submit" variant="primary" :disabled="locked"><Plus class="size-4" />{{ action.pending ? 'Adding…' : 'Add tokens' }}</VButton>
      </div>
    </form>
  </VModal>
</template>

<style scoped>
.grant-description { color: var(--ink-2); font-size: 14px; line-height: 1.6; margin-bottom: 22px; overflow-wrap: anywhere; }
.grant-description strong { color: var(--ink); font-weight: 500; }
.grant-label { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; font-weight: 500; margin: 18px 0 8px; }
.grant-label span { color: var(--ink-3); font-weight: 400; }
.grant-input { width: 100%; min-width: 0; height: 42px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background: var(--canvas); color: var(--ink); padding: 0 12px; font-size: 14px; }
.grant-input::placeholder { color: var(--ink-3); }
.grant-input[aria-invalid="true"] { border-color: var(--danger); }
.grant-presets { display: flex; gap: 8px; margin-top: 10px; }
.grant-presets button { padding: 6px 12px; font-size: 12px; color: var(--ink-2); border: 1px solid var(--line); border-radius: 6px; }
.grant-presets button:hover, .grant-presets button[aria-pressed="true"] { color: var(--ink); background: var(--surface-2); border-color: var(--line-strong); }
.grant-error { color: var(--danger); font-size: 12px; margin-top: 8px; }
.grant-total { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; border-top: 1px solid var(--line); margin-top: 24px; padding-top: 20px; font-size: 13px; }
.grant-total > span { color: var(--ink-2); }
.grant-total strong { font-weight: 500; font-variant-numeric: tabular-nums; }
.grant-total small { font-size: 12px; font-weight: 400; color: var(--ink-2); }
.grant-footnote { color: var(--ink-3); font-size: 12px; margin-top: 9px; }
.grant-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 26px; }
</style>
