import { assertAccountActive, getAccountPolicy } from '../account-policy'
import { fail, type Db } from '../media'

/** Restricts declared adult models; provider moderation remains in force. */
export async function assertGenerationPolicy(db: Db, ownerId: string, modelId: string) {
  await assertAccountActive(db, ownerId)
  if (modelId === 'h3-eros-max' && !(await getAccountPolicy(db, ownerId)).nsfwEnabled)
    fail(403, 'nsfw_disabled', '18+ model access is not enabled for your account.')
}
