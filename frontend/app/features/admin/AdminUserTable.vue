<script setup lang="ts">
import { ChevronRight, SearchX } from 'lucide-vue-next'
import type { AdminUser } from '~/entities/admin/types'

defineProps<{
  rows: readonly { user: Readonly<AdminUser>; balance: number; depositedCents: number }[]
  selectedId: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{ select: [id: string]; clearFilters: [] }>()
const number = (value: number) => value.toLocaleString('en-US')
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100)
const initials = (name: string) => name.split(' ').map(part => part[0]).slice(0, 2).join('')
</script>

<template>
  <div class="admin-table-wrap">
    <table v-if="rows.length" class="admin-user-table">
      <caption class="sr-only">Users. Select a user to manage their account.</caption>
      <thead><tr><th scope="col">User</th><th scope="col">Status</th><th scope="col" class="nsfw-column">NSFW</th><th scope="col">Discount</th><th scope="col" class="numeric">Deposited</th><th scope="col" class="numeric balance-column">Tokens</th><th scope="col"><span class="sr-only">Open user</span></th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.user.id" :class="{ selected: selectedId === row.user.id }" @click="!disabled && emit('select', row.user.id)">
          <td class="user-column">
            <button type="button" class="user-select" :disabled="disabled" :aria-label="`Manage ${row.user.name}`" :aria-pressed="selectedId === row.user.id" @click.stop="emit('select', row.user.id)">
              <span class="user-avatar" aria-hidden="true">{{ initials(row.user.name) }}</span>
              <span class="user-identity"><strong>{{ row.user.name }}</strong><span v-if="row.user.email !== row.user.name">{{ row.user.email }}</span></span>
            </button>
          </td>
          <td data-label="Status"><span class="user-status" :class="{ blocked: row.user.blocked }">{{ row.user.blocked ? 'Blocked' : 'Active' }}</span></td>
          <td class="nsfw-column" data-label="NSFW"><span :class="row.user.nsfwEnabled ? 'nsfw-on' : 'muted'">{{ row.user.nsfwEnabled ? 'Allowed' : 'Off' }}</span></td>
          <td data-label="Discount"><span :class="{ muted: !row.user.discountPercent }">{{ row.user.discountPercent ? `${row.user.discountPercent}%` : '—' }}</span></td>
          <td class="numeric" data-label="Deposited">{{ money(row.depositedCents) }}</td>
          <td class="numeric balance-column" data-label="Tokens">{{ number(row.balance) }}</td>
          <td class="row-arrow"><ChevronRight class="size-4" aria-hidden="true" /></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="admin-empty">
      <SearchX class="size-6" aria-hidden="true" /><h2>No users found</h2><p>Try another name, email or filter.</p>
      <button type="button" class="clear-filters" :disabled="disabled" @click="emit('clearFilters')">Clear filters</button>
    </div>
  </div>
</template>

<style scoped>
.admin-table-wrap { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; }
.admin-user-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; font-variant-numeric: tabular-nums; }
.admin-user-table th { padding: 13px 12px; color: var(--ink-3); font-size: 11px; font-weight: 500; white-space: nowrap; border-bottom: 1px solid var(--line); background: var(--surface); }
.admin-user-table th:first-child { padding-left: 18px; }
.admin-user-table td { padding: 17px 12px; border-bottom: 1px solid var(--line); }
.admin-user-table tbody tr:last-child td { border-bottom: 0; }
.admin-user-table tbody tr { cursor: pointer; transition: background-color .15s; }
.admin-user-table tbody tr:hover { background: var(--surface); }
.admin-user-table tbody tr.selected { background: color-mix(in srgb, var(--accent) 6%, var(--canvas)); }
.admin-user-table tr.selected .user-column { box-shadow: inset 2px 0 0 var(--accent); }
.admin-user-table .numeric { text-align: right; white-space: nowrap; }
.admin-user-table .user-column { padding-left: 18px; }
.user-select { display: flex; align-items: center; text-align: left; gap: 11px; width: 100%; min-width: 0; }
.user-avatar { display: grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface-2); color: var(--ink-2); font-size: 11px; font-weight: 500; }
.user-identity { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.user-identity strong { font-size: 13px; font-weight: 500; white-space: nowrap; }
.user-identity > span { color: var(--ink-3); font-size: 11px; overflow-wrap: anywhere; }
.user-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.user-status::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--ink-3); }
.user-status.blocked { color: var(--danger); }
.user-status.blocked::before { background: var(--danger); }
.nsfw-on { color: var(--ink); font-size: 12px; }
.muted { color: var(--ink-3); }
.row-arrow { width: 18px; color: var(--ink-3); }
.selected .row-arrow { color: var(--accent); }
.admin-empty { padding: 64px 20px; text-align: center; color: var(--ink-2); }
.admin-empty > svg { margin: 0 auto 16px; }
.admin-empty h2 { font-size: 16px; font-weight: 500; color: var(--ink); }
.admin-empty p { margin-top: 5px; font-size: 13px; }
.clear-filters { margin-top: 20px; padding: 8px 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-control); font-size: 12px; }
@media (min-width: 1021px) and (max-width: 1370px) { .balance-column { display: none; } .admin-user-table th, .admin-user-table td { padding-left: 9px; padding-right: 9px; } .user-avatar { display: none; } }
@media (max-width: 650px) { .balance-column, .nsfw-column { display: none; } .user-avatar { display: none; } .admin-user-table th, .admin-user-table td { padding-left: 8px; padding-right: 8px; } .admin-user-table .user-column, .admin-user-table th:first-child { padding-left: 12px; } .user-identity strong { white-space: normal; } .row-arrow { display: none; } }
@media (max-width: 430px) { .admin-user-table thead { display: none; } .admin-user-table tbody { display: block; } .admin-user-table tr { display: grid; grid-template-columns: 1fr 1fr 1fr; padding: 16px; gap: 14px; border-bottom: 1px solid var(--line); } .admin-user-table tbody tr:last-child { border-bottom: 0; } .admin-user-table td { padding: 0; border: 0; } .admin-user-table .user-column { grid-column: 1 / -1; padding: 0; } .admin-user-table tr.selected .user-column { box-shadow: none; } .admin-user-table tr.selected { box-shadow: inset 2px 0 0 var(--accent); } .admin-user-table td[data-label]::before { content: attr(data-label); display: block; color: var(--ink-3); font-size: 10px; margin-bottom: 5px; } .admin-user-table .numeric { text-align: left; } .user-avatar { display: grid; } .user-identity > span { font-size: 12px; } }
@media (prefers-reduced-motion: reduce) { .admin-user-table tbody tr { transition: none; } }
</style>
