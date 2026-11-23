export interface AdminUser {
  id: string
  name: string
  email: string
  joinedAt: number
  nsfwEnabled: boolean
  discountPercent: number
  blocked: boolean
  blockReason: string
  revision: number
  isAdmin: boolean
  balance: number
  reservedTokens: number
  depositedCents: number
  testDepositedCents: number
}
export interface AdminTransaction {
  id: string
  userId: string
  kind: 'deposit' | 'test_purchase' | 'grant' | 'spend'
  amountTokens: number
  amountCents: number
  createdAt: number
  note: string
}
export interface AdminActivity {
  id: string
  userId: string
  createdAt: number
  label: string
  actorId: string
}
export interface AdminUserDetail {
  user: AdminUser
  transactions: AdminTransaction[]
  activity: AdminActivity[]
  historyTruncated: boolean
}
export type AdminFilter = 'all' | 'active' | 'blocked' | 'nsfw' | 'discounted'
export type AdminSort = 'newest' | 'deposits' | 'balance'
export interface AdminQuery { q: string; filter: AdminFilter; sort: AdminSort; page: number }
export interface AdminDirectory {
  users: AdminUser[]
  total: number
  page: number
  pageSize: number
  stats: { totalUsers: number; activeUsers: number; totalDepositedCents: number }
  actorId: string
}
export type AdminMutation =
  | { kind: 'settings'; payload: { nsfwEnabled: boolean; discountPercent: number } }
  | { kind: 'grants'; payload: { amount: number; note: string } }
  | { kind: 'status'; payload: { blocked: boolean; reason: string } }
export interface AdminActionState {
  kind: AdminMutation['kind'] | null
  pending: boolean
  uncertain: boolean
  conflict: boolean
  error: string
}
