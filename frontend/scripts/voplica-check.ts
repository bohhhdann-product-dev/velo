import { randomUUID } from 'node:crypto'
import { VOPLICA_BASE_URL, VOPLICA_MODELS, VOPLICA_WORKFLOW, voplicaConfig } from '../server/services/generation/voplica-config'
import { voplicaVideoRequest } from '../server/services/generation/voplica'

// This command cannot start a paid run. A fresh dry-run key is never reused by the worker.
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
async function rpc(service: string, method: string, body: unknown, authenticated = false) {
  const key = voplicaConfig().key
  if (authenticated && !key) throw new Error('missing_api_key')
  const response = await fetch(`${VOPLICA_BASE_URL}/voplica.api.${service}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(typeof data?.code === 'string' && /^[a-z_]{1,50}$/.test(data.code) ? data.code : `provider_http_${response.status}`)
  return data
}
try {
  if (args.some(arg => arg !== '--dry-run') || args.length > 1) throw new Error('usage: pnpm voplica:check [--dry-run]')
  const { workflowVariant: workflow } = await rpc('workflow.WorkflowVariantService', 'GetWorkflowVariant', { idempotencyKey: 'workflow.video.gen.enriched.v1' })
  const type = 'voplica.types.ai.video.BaseVideoGenerationInput'
  if (workflow?.variantId !== VOPLICA_WORKFLOW || workflow?.status !== 'PUBLISHED' || workflow?.inputsSpec?.main?.valueSpec?.literalType?.protoTypeUrl !== type)
    throw new Error('workflow_contract_changed')
  const spec = await rpc('workflow.TypesSpecService', 'GetMessageSpec', { protoTypeUrl: type })
  for (const [field, expected] of Object.entries({ prompt: 'STRING', width: 'INT32', height: 'INT32', num_frames: 'INT32', base_model_id: 'STRING', generation_mode: 'ANY_ENUM' }))
    if (spec.messageSpec?.entries?.[field]?.literalType?.dataType !== expected) throw new Error(`contract_changed_${field}`)
  if (spec.messageSpec?.entries?.references?.listType?.valueSpec?.literalType?.protoTypeUrl !== 'voplica.types.ai.common.MediaReference')
    throw new Error('reference_contract_changed')
  console.log('Workflow and video input contract: verified')
  for (const [id, model] of Object.entries(VOPLICA_MODELS)) {
    const { modelVariant: variant } = await rpc('ai.model.ModelVariantService', 'GetModelVariant', { id: model.variant })
    if (variant?.variantId !== model.variant || variant?.modelFamily !== 'MINIMAX_H3' || variant?.status !== 'PUBLISHED' || !variant?.inferenceEnabled)
      throw new Error(`model_unavailable_${id}`)
    console.log(`${id}: verified (${model.variant})`)
  }
  if (dryRun) {
    const { billingInfo: billing } = await rpc('payment.PaymentService', 'GetBillingInfo', {}, true)
    if (!billing || typeof billing !== 'object') throw new Error('invalid_billing_response')
    const milli = (value: unknown) => typeof value === 'string' && /^\d{1,20}$/.test(value) ? BigInt(value) : 0n
    const subscription = billing?.studioSubscription
    const plan = milli(subscription?.subscriptionLimitCreditsMilli) - milli(subscription?.subscriptionSpentCreditsMilli)
    const available = milli(billing?.permanentCreditsMilli) + milli(billing?.earnedCreditsMilli) + (plan > 0n ? plan : 0n)
    console.log(`API key accepted. API-eligible balance: ${available.toString()} milli-credits.`)
    if (available <= 0n) {
      console.log('Fund the account with plan, Anytime or Earned credits. Free Studio credits cannot fund API calls.')
      throw new Error('api_balance_zero')
    }
    for (const [id, model] of Object.entries(VOPLICA_MODELS)) {
      const request = voplicaVideoRequest({ provider: 'voplica', providerModel: model.variant, providerWorkflow: VOPLICA_WORKFLOW,
        prompt: 'A quiet coastal landscape, gentle camera movement, daylight.', references: [],
        draft: { mode: 'video', modelId: id, prompt: 'A quiet coastal landscape.', trial: false, count: 1,
          aspect: '16:9', imageQuality: '1k', videoQuality: '720p', durationS: 5, referenceId: null } }, [], `dry_run_${randomUUID()}`)
      const result = await rpc('workflow.WorkflowExecutionService', 'ExecuteWorkflow', { ...request, dryRun: true }, true)
      if (typeof result.workflowExecutionId !== 'string' || !result.workflowExecutionId.startsWith('dry_run_')) throw new Error('unexpected_dry_run_response')
      console.log(`${id}: authenticated dry-run passed (no generation, no charge)`)
    }
  }
  if (!dryRun) console.log('Account access/balance not checked. Use --dry-run after saving VOPLICA_API_KEY locally.')
} catch (error) {
  // Never print raw provider responses, tokens, signed URLs, or request headers.
  console.error('Voplica check failed:', error instanceof Error && /^[\w :.[\]-]{1,140}$/.test(error.message) ? error.message : 'connection_or_contract_error')
  process.exitCode = 1
}
