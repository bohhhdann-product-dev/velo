import { createHash, randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { z } from 'zod'
import type { Draft, GeneratorNode } from '../../app/entities/studio/types'
import { nodeSize, takeBodySize } from '../../app/entities/studio/geometry'
import { mentionedHandles, referenceHandle } from '../../app/entities/studio/mentions'
import { getDb } from '../utils/db'
import { idSchema, parseProjectUpdate, type ProjectBoard } from '../utils/project-validation'
import { assetUrl, fail, lockOwner, ownedAsset, assertMediaQuota, type Db } from './media'
import { projectSnapshot, hydrateProject, type DurableProject, type ProjectRow } from './projects'
import { validateProjectReferences } from './project-media'
import { replayReceipt } from './mutation-receipts'
import { generationConfig, generationCapabilities } from './generation/config'
import { capabilitiesForModel } from '../../app/entities/studio/generation'
import { VOPLICA_MODELS, voplicaConfig } from './generation/voplica-config'
import { generatedMediaReservation } from './generated-media'
import type { GenerationManifest, GenerationReference } from './generation/provider'

const requestSchema = z.object({ generatorId: idSchema, expectedRevision: z.number().int().positive(), clientMutationId: idSchema }).strict()
const ACTIVE = ['queued', 'preparing', 'submitting', 'running', 'ingesting', 'unknown']
export async function generationDto(db: Db, ownerId: string, id: string) {
  const [generation] = await db`SELECT * FROM generations WHERE id::text = ${id} AND owner_id = ${ownerId}`
  if (!generation) fail(404, 'not_found', 'Generation not found')
  const takes = await db`SELECT t.*, a.preview_key FROM generation_takes t LEFT JOIN assets a ON a.id = t.output_asset_id
    WHERE t.generation_id = ${generation.id} ORDER BY t.created_at, t.id`
  return { id: generation.id as string, projectId: generation.project_id as string, generatorId: generation.generator_id as string,
    createdAt: new Date(generation.created_at).getTime(), draft: generation.draft as Draft, priceCredits: null,
    takes: takes.map(take => ({ id: take.id as string, generationId: generation.id as string,
      status: ['preparing', 'submitting', 'ingesting'].includes(take.status) ? 'running' : take.status,
      assetId: take.output_asset_id as string | null,
      url: take.output_asset_id ? assetUrl(take.output_asset_id, 'source') : null,
      posterUrl: take.output_asset_id && generation.draft.mode === 'video' && take.preview_key ? assetUrl(take.output_asset_id) : null,
      favorite: Boolean(take.favorite), ...(take.error_message ? { errorMessage: take.error_message as string } : {}) })) }
}
export async function listGenerations(ownerId: string) {
  const db = getDb()
  const rows = await db`SELECT id FROM generations WHERE owner_id = ${ownerId} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`
  return Promise.all(rows.map(row => generationDto(db, ownerId, row.id)))
}

async function manifestFor(tx: postgres.TransactionSql, ownerId: string, board: ProjectBoard, generator: GeneratorNode): Promise<GenerationManifest> {
  const config = generationConfig()
  const draft = structuredClone(generator.draft)
  const catalog = generationCapabilities()
  const capabilities = capabilitiesForModel(catalog, draft)
  if (draft.trial || (draft.mode === 'image' ? draft.modelId !== catalog.imageModel : !catalog.videoModels.includes(draft.modelId)))
    fail(400, 'unsupported_model', 'Choose a connected model. Draft mode is not supported yet.')
  if (!capabilities.enabled) fail(503, 'model_disabled', capabilities.reason ?? 'This model is not connected yet.')
  const voplicaModel = VOPLICA_MODELS[draft.modelId as keyof typeof VOPLICA_MODELS]
  if (draft.mode === 'video') {
    const { min, max, step } = capabilities.videoDuration
    if (draft.durationS < min || draft.durationS > max || (draft.durationS - min) % step)
      fail(400, 'invalid_duration', `Choose a duration from ${min} to ${max} seconds in ${step}-second steps.`)
    if (!capabilities.videoQualities.includes(draft.videoQuality)) fail(400, 'invalid_quality', 'Choose a supported video resolution.')
  }
  if (draft.mode === 'image' && !draft.prompt.trim()) fail(400, 'prompt_required', 'Add a prompt describing the image to create.')
  const edges = board.edges.filter(edge => edge.to === generator.id)
  if (edges.length > (draft.mode === 'video' ? capabilities.maxVideoReferences : capabilities.maxImageReferences))
    fail(400, 'too_many_references', 'This model has too many reference images.')
  if (edges.some(edge => edge.slot) && !capabilities.referenceModes.includes('start-end'))
    fail(400, 'unsupported_reference_mode', 'Beta7 uses identity references. Choose MiniMax H3 for start/end frames.')
  if (!draft.prompt.trim() && !edges.length) fail(400, 'prompt_required', 'Add a prompt or a reference image.')
  if (edges.some(edge => edge.slot === 'end') && !edges.some(edge => edge.slot === 'start')) fail(400, 'missing_start_frame', 'Add a start frame before an end frame.')
  const handles = new Map<string, string>()
  const references: GenerationReference[] = []
  for (const edge of edges) {
    const node = board.nodes.find(node => node.id === edge.from)!
    let assetId: string
    let characterVersionId: string | undefined
    if (node.type === 'reference') {
      if (draft.mode === 'video' && !capabilities.characterVideo && node.assetKind === 'character') fail(400, 'portrait_verification_required', 'Character video requires a verified BytePlus portrait asset. This character sheet is available for image generation.')
      assetId = node.assetId
      characterVersionId = node.characterVersionId
      handles.set(referenceHandle(node), voplicaModel ? `@[ref${references.length + 1}](reference:ref${references.length + 1})` : `image ${references.length + 1}`)
    } else if (node.type === 'take') {
      const [take] = await tx`SELECT t.output_asset_id FROM generation_takes t JOIN generations g ON g.id = t.generation_id
        WHERE t.id::text = ${node.takeId} AND g.id::text = ${node.generationId} AND g.owner_id = ${ownerId} AND t.status = 'done'`
      if (!take?.output_asset_id) fail(400, 'result_not_ready', 'Wait for the connected result to finish first.')
      assetId = take.output_asset_id
    } else fail(400, 'invalid_reference', 'Choose an image reference or a finished result.')
    const asset = await ownedAsset(tx, ownerId, assetId)
    if (draft.mode === 'video' && !capabilities.characterVideo && asset.kind === 'sheet') fail(400, 'portrait_verification_required', 'Character sheets need verified BytePlus portrait assets for video generation.')
    references.push({ nodeId: node.id, assetId, ...(characterVersionId ? { characterVersionId } : {}),
      ...(voplicaModel ? { name: `ref${references.length + 1}`, identitySheet: asset.kind === 'sheet' } : {}),
      role: edge.slot === 'start' ? 'first_frame' : edge.slot === 'end' ? 'last_frame' : 'reference_image' })
  }
  for (const handle of mentionedHandles(draft.prompt)) if (!handles.has(handle)) fail(400, 'missing_reference', `Connect @${handle} to this generator first.`)
  const prompt = draft.prompt.replace(/(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]+)/gu,
    (match, boundary: string, handle: string) => handles.has(handle) ? `${boundary}${handles.get(handle)}` : match).trim()
  return { draft, prompt, references, provider: voplicaModel ? 'voplica' : 'modelark',
    providerModel: voplicaModel ? voplicaModel.variant : draft.mode === 'image' ? config.imageModel : config.videoModel,
    ...(voplicaModel ? { providerWorkflow: voplicaConfig().workflow } : {}) }
}
export async function createGeneration(ownerId: string, projectId: string, input: unknown) {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) fail(400, 'invalid_generation', 'A saved generator, revision, and unique request ID are required.')
  const value = parsed.data
  const fingerprint = createHash('sha256').update(JSON.stringify([projectId, value.generatorId, value.expectedRevision])).digest('hex')
  const accepted = await getDb().begin(async tx => {
    await lockOwner(tx, ownerId)
    const scope = `projects:${projectId}:generate`
    const [receipt] = await tx`SELECT fingerprint, reply, created_at > now() - interval '7 days' AS replayable FROM mutation_receipts
      WHERE owner_id = ${ownerId} AND scope = ${scope} AND client_mutation_id = ${value.clientMutationId}`
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail(409, 'mutation_id_reused', 'This request ID was already used for different generation inputs.')
      return replayReceipt(receipt.reply, receipt.replayable) as { generationId: string; project: DurableProject }
    }
    const config = generationConfig()
    if (!config.enabled) fail(503, 'generation_disabled', config.reason!)
    const [row] = await tx<(ProjectRow & { owner_id: string })[]>`SELECT * FROM projects WHERE id = ${projectId} AND owner_id = ${ownerId} AND deleted_at IS NULL FOR UPDATE`
    if (!row) fail(404, 'not_found', 'Project not found')
    if (row.revision !== value.expectedRevision) fail(409, 'revision_conflict', 'This project changed. Reload it before generating.')
    const generator = row.board.nodes.find(node => node.id === value.generatorId && node.type === 'generator') as GeneratorNode | undefined
    if (!generator) fail(404, 'not_found', 'Generator not found')
    const [total] = await tx`SELECT count(*)::int AS count FROM generations WHERE owner_id = ${ownerId} AND deleted_at IS NULL`
    if (total!.count >= 500) fail(413, 'generation_quota', 'Your saved generation limit is reached. Remove unused projects before generating more.')
    const [active] = await tx`SELECT count(*)::int AS count FROM generation_takes t JOIN generations g ON g.id = t.generation_id
      WHERE g.owner_id = ${ownerId} AND t.status IN ${tx(ACTIVE)}`
    if (active!.count + generator.draft.count > 12) fail(429, 'generation_limit', 'Wait for your current generations to finish.')
    const [running] = await tx`SELECT 1 FROM generation_takes t JOIN generations g ON g.id = t.generation_id
      WHERE g.owner_id = ${ownerId} AND g.project_id = ${projectId} AND g.generator_id = ${generator.id} AND t.status IN ${tx(ACTIVE)} LIMIT 1`
    if (running) fail(409, 'generation_active', 'This generator already has an active or unconfirmed generation.')
    await validateProjectReferences(tx, ownerId, row.board.nodes)
    const manifest = await manifestFor(tx, ownerId, row.board, generator)
    const reservedBytes = generatedMediaReservation(manifest.draft.mode)
    await assertMediaQuota(tx, ownerId, reservedBytes * generator.draft.count, generator.draft.count)
    const generationId = randomUUID()
    await tx`INSERT INTO generations(id, owner_id, project_id, generator_id, draft, manifest)
      VALUES (${generationId}, ${ownerId}, ${projectId}, ${generator.id}, ${tx.json(manifest.draft as unknown as postgres.JSONValue)}, ${tx.json(manifest as unknown as postgres.JSONValue)})`
    const board = structuredClone(row.board)
    const size = takeBodySize(generator.draft.aspect)
    let x = Math.max(generator.x + nodeSize(generator).w + 80, ...board.nodes.filter(node => node.type === 'take').map(node => node.x + 380))
    for (let index = 0; index < generator.draft.count; index++) {
      const id = randomUUID()
      await tx`INSERT INTO generation_takes(id, generation_id, reserved_bytes) VALUES (${id}, ${generationId}, ${reservedBytes})`
      board.nodes.push({ id: `take_${id}`, type: 'take', takeId: id, generationId, x, y: generator.y })
      board.edges.push({ id: `output_${id}`, from: generator.id, to: `take_${id}` })
      x += size.w + 40
    }
    parseProjectUpdate({ title: row.title, nodes: board.nodes, edges: board.edges, viewport: row.viewport,
      expectedRevision: row.revision, clientMutationId: value.clientMutationId })
    const [updated] = await tx<ProjectRow[]>`UPDATE projects SET board = ${tx.json(board)}, revision = revision + 1, updated_at = now()
      WHERE id = ${projectId} AND owner_id = ${ownerId} RETURNING *`
    const reply = { generationId, project: projectSnapshot(updated!) }
    await tx`INSERT INTO mutation_receipts(owner_id, scope, client_mutation_id, fingerprint, reply)
      VALUES (${ownerId}, ${scope}, ${value.clientMutationId}, ${fingerprint}, ${tx.json(reply as unknown as postgres.JSONValue)})`
    return reply
  })
  return { generation: await generationDto(getDb(), ownerId, accepted.generationId), project: await hydrateProject(ownerId, accepted.project) }
}
export async function favoriteTake(ownerId: string, id: string, takeId: string, favorite: unknown) {
  if (typeof favorite !== 'boolean') fail(400, 'invalid_favorite', 'Favorite must be true or false')
  await getDb().begin(async tx => {
    await lockOwner(tx, ownerId)
    const [take] = await tx`UPDATE generation_takes t SET favorite = ${favorite} FROM generations g
      WHERE t.generation_id = g.id AND g.owner_id = ${ownerId} AND g.id::text = ${id} AND t.id::text = ${takeId} RETURNING t.id`
    if (!take) fail(404, 'not_found', 'Generation result not found')
  })
  return generationDto(getDb(), ownerId, id)
}
