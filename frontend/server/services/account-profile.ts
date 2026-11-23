import { z } from 'zod'
import { getDb } from '../utils/db'

const profileSchema = z.object({
  id: z.string(), first_name: z.string().nullable(), last_name: z.string().nullable(),
  username: z.string().nullable(), primary_email_address_id: z.string().nullable(),
  email_addresses: z.array(z.object({ id: z.string(), email_address: z.string() })),
})

/** Profile data is display-only. Authorization always uses the verified Clerk ID. */
export async function syncAccountProfile(ownerId: string) {
  if (process.env.VELA_AUTH_MODE === 'local' || !process.env.CLERK_SECRET_KEY) return
  const db = getDb()
  // Claim a bounded refresh window to avoid repeated calls during an upstream outage.
  const claimed = await db`UPDATE app_users SET profile_synced_at = now() WHERE id = ${ownerId}
    AND (profile_synced_at IS NULL OR profile_synced_at < now() - interval '24 hours') RETURNING id`
  if (!claimed.length) return
  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(ownerId)}`, {
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
      signal: AbortSignal.timeout(5000), redirect: 'error',
    })
    if (!response.ok) throw new Error('Profile lookup unavailable')
    const profile = profileSchema.parse(await response.json())
    if (profile.id !== ownerId) throw new Error('Profile identity mismatch')
    const email = profile.email_addresses.find(item => item.id === profile.primary_email_address_id)?.email_address ?? ''
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || ''
    await db`UPDATE app_users SET display_name = ${name.slice(0, 200)}, email = ${email.slice(0, 320)} WHERE id = ${ownerId}`
  } catch {
    // Keep the last known profile; retry after five minutes without blocking sign-in.
    await db`UPDATE app_users SET profile_synced_at = now() - interval '23 hours 55 minutes' WHERE id = ${ownerId}`
    console.warn('[account-profile] Profile refresh unavailable; cached account identity retained.')
  }
}
