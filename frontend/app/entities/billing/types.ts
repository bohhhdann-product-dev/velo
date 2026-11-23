export interface TokenPack {
  id: string
  tokens: number
  priceCents: number
  currency: 'USD'
}

export interface TokenWallet {
  availableTokens: number
  reservedTokens: number
  totalTokens: number
  welcomeTokens: number
  tokenUsd: number
  demoCheckoutEnabled: boolean
  packs: TokenPack[]
  ledger: { id: string; kind: string; amount: number; createdAt: number; label: string }[]
}

export interface TokenCheckout extends TokenPack {
  packId: string
  status: 'pending' | 'paid'
  demo: boolean
  createdAt: number
}

export const formatTokens = (value: number) => new Intl.NumberFormat('en-US').format(value)
export const formatPrice = (cents: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(cents / 100)
