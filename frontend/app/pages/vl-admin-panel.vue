<script setup lang="ts">
import { ArrowUpRight, RefreshCw, Search, X } from 'lucide-vue-next'
import { onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue-sonner'
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import VButton from '~/shared/ui/VButton.vue'
import VModal from '~/shared/ui/VModal.vue'
import AdminUserTable from '~/features/admin/AdminUserTable.vue'
import AdminUserPanel from '~/features/admin/AdminUserPanel.vue'
import { createAdminClient } from '~/features/admin/adminClient'
import { useWorkspaceStore } from '~/stores/workspace'
import { useBillingStore } from '~/stores/billing'
import type { AdminFilter, AdminMutation, AdminSort } from '~/entities/admin/types'

definePageMeta({ layout: false })
useHead({ title: 'Users · Vela Admin', meta: [{ name: 'robots', content: 'noindex, nofollow' }] })
const workspace = useWorkspaceStore()
const billing = useBillingStore()
const client = createAdminClient(workspace.request, () => workspace.sessionVersion)
const { directory, detail: account, selectedId, listLoading, detailLoading, listError, detailError, accessError, action, confirmed, locked } = client
const search = shallowRef('')
const filter = shallowRef<AdminFilter>('all')
const sort = shallowRef<AdminSort>('newest')
const page = shallowRef(1)
const dirty = shallowRef(false)
const discardOpen = shallowRef(false)
const pendingSelection = shallowRef<string | null>(null)
const detail = useTemplateRef<HTMLElement>('detail')
const enabled = computed(() => workspace.live && Boolean(workspace.userId))
const rows = computed(() => (directory.value?.users ?? []).map(user => ({ user, balance: user.balance, depositedCents: user.depositedCents })))
const selected = computed(() => account.value?.user)
const pages = computed(() => directory.value ? Math.max(1, Math.ceil(directory.value.total / directory.value.pageSize)) : 1)
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100)
let leaveDecision: ((leave: boolean) => void) | null = null
let searchTimer: ReturnType<typeof setTimeout> | undefined
async function loadDirectory() {
  if (!enabled.value || locked.value) return
  await client.loadUsers({ q: search.value.trim(), filter: filter.value, sort: sort.value, page: page.value })
  if (!selectedId.value && directory.value?.users[0]) await client.loadUser(directory.value.users[0].id)
}
watch(() => workspace.sessionVersion, () => {
  clearTimeout(searchTimer)
  client.clear(); dirty.value = false; discardOpen.value = false
  search.value = ''; filter.value = 'all'; sort.value = 'newest'; page.value = 1
  if (import.meta.client) void loadDirectory()
}, { flush: 'sync' })
watch([search, filter, sort], () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { if (page.value !== 1) page.value = 1; else void loadDirectory() }, 250)
})
watch(page, () => { void loadDirectory() })
onMounted(() => { void loadDirectory(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => {
  clearTimeout(searchTimer); client.clear()
  window.removeEventListener('beforeunload', beforeUnload); leaveDecision?.(false)
})
async function selectUser(id: string) {
  if (locked.value) { toast.message('Confirm the pending account update before switching users.'); return }
  if (id !== selectedId.value && dirty.value) { pendingSelection.value = id; discardOpen.value = true; return }
  if (id !== selectedId.value) { dirty.value = false; void client.loadUser(id) }
  await nextTick()
  if (window.matchMedia('(max-width: 1020px)').matches) {
    detail.value?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
    detail.value?.focus({ preventScroll: true })
  }
}
function discardChanges() {
  dirty.value = false
  const target = pendingSelection.value
  pendingSelection.value = null
  if (leaveDecision) { leaveDecision(true); leaveDecision = null }
  discardOpen.value = false
  if (target) void selectUser(target)
}
watch(discardOpen, open => { if (!open) { pendingSelection.value = null; leaveDecision?.(false); leaveDecision = null } })
onBeforeRouteLeave(() => {
  if (locked.value) { toast.message('Confirm the pending account update before leaving.'); return false }
  if (!dirty.value) return true
  discardOpen.value = true
  return new Promise<boolean>(resolve => { leaveDecision = resolve })
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value || locked.value) { event.preventDefault(); event.returnValue = '' }
}
async function refreshAccount() {
  if (!selectedId.value || locked.value) return
  await client.loadUser(selectedId.value, true)
}
async function refresh() { await loadDirectory(); await refreshAccount() }
async function mutate(input: AdminMutation) {
  const saved = await client.mutate(input)
  if (saved) { toast.success(input.kind === 'grants' ? 'Tokens added to the account' : 'Account updated'); void loadDirectory(); void billing.refresh() }
}
async function retry() {
  if (await client.retry()) { toast.success('Account update confirmed'); void loadDirectory(); void billing.refresh() }
}
</script>

<template>
  <div class="admin-page">
    <header class="admin-topbar">
      <NuxtLink to="/" class="admin-brand" aria-label="Vela home"><VelaBrand /></NuxtLink>
      <span class="admin-divider">/</span><span class="admin-section-label">Admin</span>
      <NuxtLink to="/studio" class="open-studio">Open studio <ArrowUpRight class="size-4" /></NuxtLink>
    </header>
    <main class="admin-main">
      <div v-if="!enabled" class="admin-access-state"><h1>Sign in to manage accounts</h1><p>Administration requires a live Vela workspace and an authorized account.</p><NuxtLink to="/studio" class="access-link">Open sign-in</NuxtLink></div>
      <div v-else-if="accessError" class="admin-access-state"><h1>Administrator access required</h1><p role="alert">{{ accessError }}</p><NuxtLink to="/studio" class="access-link">Back to studio</NuxtLink></div>
      <template v-else>
        <div class="admin-heading"><div><h1>Users<span v-if="directory">{{ directory.stats.totalUsers }}</span></h1><p v-if="directory">{{ directory.stats.activeUsers }} active accounts · {{ money(directory.stats.totalDepositedCents) }} deposited in total</p></div><VButton variant="ghost" size="sm" :disabled="locked || listLoading || detailLoading" @click="refresh"><RefreshCw class="size-3.5" />Refresh</VButton></div>
        <p v-if="listError" class="admin-error" role="alert">{{ listError }} <button type="button" @click="loadDirectory">Try again</button></p>
        <div v-if="!directory && listLoading" class="admin-loading" role="status">Loading accounts…</div>
        <div v-else-if="directory" class="admin-content">
          <section class="user-directory" aria-label="User directory" :aria-busy="listLoading">
            <div class="directory-tools">
              <div class="search-field"><Search class="size-4" aria-hidden="true" /><input v-model="search" :disabled="locked" aria-label="Search users" maxlength="160" placeholder="Name, email or user ID" type="search" autocomplete="off" /><button v-if="search" type="button" :disabled="locked" aria-label="Clear search" @click="search = ''"><X class="size-3.5" /></button></div>
              <select v-model="filter" :disabled="locked" class="directory-select" aria-label="Filter users"><option value="all">All accounts</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="nsfw">NSFW allowed</option><option value="discounted">With discount</option></select>
            </div>
            <div class="directory-sort"><span role="status">{{ listLoading ? 'Updating…' : `${directory.total} ${directory.total === 1 ? 'user' : 'users'}` }}</span><label>Sort by <select v-model="sort" :disabled="locked" aria-label="Sort users"><option value="newest">Newest</option><option value="deposits">Highest deposits</option><option value="balance">Highest balance</option></select></label></div>
            <AdminUserTable :disabled="locked" :rows="rows" :selected-id="selectedId" @select="selectUser" @clear-filters="search = ''; filter = 'all'" />
            <nav v-if="pages > 1" class="directory-pagination" aria-label="User pages"><VButton size="sm" :disabled="page <= 1 || locked || listLoading" @click="page--">Previous</VButton><span>Page {{ directory.page }} of {{ pages }}</span><VButton size="sm" :disabled="page >= pages || locked || listLoading" @click="page++">Next</VButton></nav>
            <p class="directory-caption">Deposits show real payments. Simulated payments and free grants are tracked separately.</p>
          </section>
          <aside ref="detail" tabindex="-1" class="user-detail" aria-label="Selected user settings" :aria-busy="detailLoading">
            <div v-if="action.error" class="admin-error action-notice" role="alert"><p>{{ action.error }}</p><VButton v-if="action.uncertain" size="sm" @click="retry">Check result / retry</VButton><VButton v-else-if="action.conflict" size="sm" :disabled="detailLoading" @click="refreshAccount">Refresh account</VButton></div>
            <p v-if="detailError" class="admin-error" role="alert">{{ detailError }} <button type="button" @click="refreshAccount">Try again</button></p>
            <p v-if="detailLoading && !account" class="detail-empty" role="status">Loading account…</p>
            <AdminUserPanel v-else-if="account" :key="account.user.id" :user="account.user" :balance="account.user.balance" :deposited-cents="account.user.depositedCents" :transactions="account.transactions" :activity="account.activity" :actor-id="directory.actorId" :action="action" :confirmed="confirmed" :history-truncated="account.historyTruncated" :refreshing="detailLoading" @save-settings="mutate({ kind: 'settings', payload: $event })" @grant-tokens="mutate({ kind: 'grants', payload: $event })" @set-blocked="mutate({ kind: 'status', payload: $event })" @dirty-change="dirty = $event" @retry="retry" @refresh="refreshAccount" />
            <p v-else class="detail-empty">Select a user to view their account.</p>
          </aside>
        </div>
      </template>
    </main>
    <VModal v-model:open="discardOpen" title="Discard unsaved changes?">
      <p class="admin-dialog-copy">The settings for {{ selected?.name }} have not been saved.</p>
      <div class="admin-dialog-actions"><VButton @click="discardOpen = false">Keep editing</VButton><VButton variant="primary" @click="discardChanges">Discard changes</VButton></div>
    </VModal>
  </div>
</template>

<style scoped>
.admin-page { min-height: 100dvh; background: var(--canvas); }
.admin-topbar { height: 64px; display: flex; align-items: center; gap: 20px; padding: 0 32px; border-bottom: 1px solid var(--line); }
.admin-brand { display: flex; align-items: center; gap: 9px; font-size: 22px; font-weight: 600; letter-spacing: -.04em; }
.admin-divider { color: var(--ink-3); font-size: 20px; font-weight: 300; }
.admin-section-label { font-size: 14px; color: var(--ink-2); }
.preview-badge { font-size: 11px; color: var(--ink-2); padding: 3px 8px; border: 1px solid var(--line-strong); border-radius: 5px; }
.open-studio { margin-left: auto; display: inline-flex; align-items: center; gap: 7px; color: var(--ink-2); font-size: 12px; }
.open-studio:hover { color: var(--ink); }
.admin-main { max-width: 1620px; padding: 28px 32px 60px; margin: 0 auto; }
.admin-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.admin-heading h1 { display: flex; align-items: center; gap: 12px; font-size: 30px; letter-spacing: -.04em; font-weight: 500; }
.admin-heading h1 > span { border: 1px solid var(--line-strong); border-radius: 6px; font-size: 12px; letter-spacing: 0; padding: 2px 7px; color: var(--ink-2); }
.admin-heading p { margin-top: 5px; font-size: 13px; color: var(--ink-2); }
.preview-context { display: flex; align-items: center; gap: 8px; color: var(--ink-3); margin-top: 18px; font-size: 12px; }
.preview-context > svg { flex-shrink: 0; }
.admin-content { margin-top: 24px; display: grid; grid-template-columns: minmax(0, 1fr) 370px; gap: 28px; align-items: start; }
.user-directory { min-width: 0; }
.directory-tools { display: flex; gap: 10px; }
.search-field { flex: 1; display: flex; align-items: center; gap: 9px; padding: 0 12px; min-width: 0; border: 1px solid var(--line-strong); border-radius: var(--radius-control); height: 38px; color: var(--ink-3); }
.search-field:focus-within { border-color: var(--accent); }
.search-field > svg { flex-shrink: 0; }
.search-field input { width: 100%; min-width: 0; font-size: 13px; background: transparent; color: var(--ink); outline: none; }
.search-field input::-webkit-search-cancel-button { display: none; }
.search-field button { display: grid; place-items: center; flex-shrink: 0; height: 26px; width: 26px; border-radius: 5px; }
.search-field button:hover { color: var(--ink); background: var(--surface-2); }
.directory-select { padding: 0 28px 0 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); background-color: var(--surface); font-size: 12px; max-width: 160px; }
.directory-sort { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin: 18px 0 10px; color: var(--ink-3); font-size: 11px; }
.directory-sort label { display: flex; align-items: center; gap: 5px; }
.directory-sort select { padding: 3px; background: var(--canvas); color: var(--ink-2); }
.directory-caption { margin-top: 14px; font-size: 11px; color: var(--ink-3); }
.user-detail { min-width: 0; scroll-margin-top: 24px; }
.user-detail:focus { outline: none; }
.detail-empty, .admin-loading { padding: 44px 20px; color: var(--ink-2); font-size: 14px; }
.admin-error { margin-top: 16px; border: 1px solid var(--line-strong); border-left: 2px solid var(--warning); padding: 12px 16px; border-radius: 6px; color: var(--ink-2); font-size: 13px; }
.admin-dialog-copy { color: var(--ink-2); font-size: 14px; line-height: 1.6; }
.admin-dialog-actions { margin-top: 24px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
@media (max-width: 1200px) { .admin-content { grid-template-columns: minmax(0, 1fr) 340px; gap: 22px; } .admin-main { padding-inline: 24px; } }
@media (max-width: 1020px) { .admin-content { grid-template-columns: 1fr; gap: 28px; } .user-detail { width: 100%; max-width: 640px; } }
@media (max-width: 600px) { .admin-topbar { padding-inline: 18px; gap: 12px; height: 64px; } .admin-main { padding: 26px 16px 40px; } .admin-heading { align-items: flex-start; } .admin-heading h1 { font-size: 27px; } .admin-heading p { max-width: 210px; line-height: 1.5; } .preview-badge { font-size: 10px; padding-inline: 6px; } .open-studio { font-size: 11px; gap: 4px; } .admin-section-label, .admin-divider { display: none; } .directory-tools { flex-wrap: wrap; } .search-field { min-width: 180px; } .directory-select { height: 38px; flex: 1; max-width: none; } }
.admin-access-state { padding: 100px 24px; text-align: center; }
.admin-access-state h1 { font-size: 25px; font-weight: 500; letter-spacing: -.03em; }
.admin-access-state p { margin: 12px auto 22px; max-width: 420px; font-size: 14px; color: var(--ink-2); line-height: 1.7; }
.access-link { display: inline-block; border: 1px solid var(--line-strong); padding: 10px 16px; border-radius: 8px; font-size: 13px; }
.directory-pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; font-size: 12px; color: var(--ink-2); }
.admin-error button:not(.v-button) { text-decoration: underline; margin-top: 8px; }
.action-notice { margin: 0 0 14px; line-height: 1.6; }
.action-notice > button { margin-top: 12px; }
</style>
