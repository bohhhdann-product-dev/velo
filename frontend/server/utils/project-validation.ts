import { createError } from 'h3'
import { z } from 'zod'

export const idSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
const position = z.number().finite().min(-1_000_000).max(1_000_000)
const base = {
  id: idSchema,
  x: position,
  y: position,
  scale: z.number().finite().min(0.05).max(8).optional(),
  groupId: idSchema.optional(),
  title: z.string().max(240).optional(),
}

const draftSchema = z.object({
  modelId: idSchema,
  trial: z.boolean(),
  mode: z.enum(['image', 'video']),
  prompt: z.string().max(12_000),
  aspect: z.enum(['1:1', '16:9', '9:16']),
  imageQuality: z.enum(['1k', '2k']),
  videoQuality: z.enum(['480p', '720p']),
  durationS: z.number().int().min(1).max(30),
  count: z.number().int().min(1).max(4),
  referenceId: idSchema.nullable(),
}).strict()

const referenceSchema = z.object({
  ...base,
  type: z.literal('reference'),
  assetId: idSchema,
  assetKind: z.enum(['image', 'character']).default('image'),
  characterVersionId: idSchema.optional(),
  handle: z.string().min(1).max(48).regex(/^[\p{L}\p{M}\p{N}_-]+$/u).optional(),
  name: z.string().min(1).max(240),
}).strict()

const nodeSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('generator'), number: z.number().int().min(1).max(100_000).optional(), draft: draftSchema }).strict(),
  referenceSchema,
  z.object({ ...base, type: z.literal('take'), takeId: idSchema, generationId: idSchema }).strict(),
])
const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  slot: z.enum(['start', 'end']).optional(),
}).strict()
export const viewportSchema = z.object({ x: position, y: position, scale: z.number().finite().min(0.05).max(8) }).strict()
const documentFields = {
  title: z.string().trim().min(1).max(160),
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(2_000),
  viewport: viewportSchema,
  clientMutationId: idSchema,
}
const createSchema = z.object({ ...documentFields, id: idSchema.optional() }).strict()
const updateSchema = z.object({ ...documentFields, expectedRevision: z.number().int().min(1).max(2_147_483_646) }).strict()
const deleteSchema = z.object({ expectedRevision: z.number().int().min(1).max(2_147_483_646), clientMutationId: idSchema }).strict()

export type DurableCanvasNode = z.infer<typeof nodeSchema>
export type ProjectCreate = z.infer<typeof createSchema>
export type ProjectUpdate = z.infer<typeof updateSchema>
export type ProjectDelete = z.infer<typeof deleteSchema>
export type ProjectBoard = { schemaVersion: 1; nodes: DurableCanvasNode[]; edges: z.infer<typeof edgeSchema>[] }

function invalid(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Invalid project', data: { code: 'invalid_project', message } })
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) invalid('Project fields are missing, unsupported, or exceed their limits.')
  return result.data
}

function validateGraph(document: ProjectCreate | ProjectUpdate) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  if (nodes.size !== document.nodes.length) invalid('Node IDs must be unique.')
  if (new Set(document.edges.map((edge) => edge.id)).size !== document.edges.length) invalid('Edge IDs must be unique.')
  const handles = new Set<string>()
  for (const node of document.nodes) {
    if (node.type === 'reference') {
      if (node.assetKind === 'character' && !node.characterVersionId) invalid('Character references must pin a published version.')
      if (node.assetKind === 'image' && node.characterVersionId) invalid('Image references cannot claim character versions.')
      if (node.handle) {
        const normalized = node.handle.normalize('NFC').toLocaleLowerCase('en-US')
        if (handles.has(normalized)) invalid('Reference handles must be unique.')
        handles.add(normalized)
      }
    } else if (node.type === 'generator' && node.draft.referenceId !== null && nodes.get(node.draft.referenceId)?.type !== 'reference') {
      invalid('A draft reference must point to a reference node in this project.')
    }
  }
  const connections = new Set<string>()
  const inputs = new Map<string, typeof document.edges>()
  for (const edge of document.edges) {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    const input = (from?.type === 'reference' || from?.type === 'take') && to?.type === 'generator'
    const output = from?.type === 'generator' && to?.type === 'take' && !edge.slot
    if ((!input && !output) || edge.from === edge.to) invalid('Connect a reference or result to a generator, or a generator to its result.')
    if (output) continue
    if (edge.slot && (to?.type !== 'generator' || to.draft.mode !== 'video')) invalid('Frame slots require a video generator.')
    const key = `${edge.from}:${edge.to}:${edge.slot ?? ''}`
    if (connections.has(key)) invalid('Duplicate connections are not allowed.')
    connections.add(key)
    const incoming = inputs.get(edge.to) ?? []
    incoming.push(edge)
    inputs.set(edge.to, incoming)
  }
  for (const [nodeId, edges] of inputs) {
    const node = nodes.get(nodeId)!
    if (node.type !== 'generator') continue
    const frames = edges.filter((edge) => edge.slot)
    const references = edges.filter((edge) => !edge.slot)
    if (frames.length && references.length) invalid('Use references or start/end frames, not both.')
    if (new Set(frames.map((edge) => edge.slot)).size !== frames.length) invalid('A frame slot has more than one input.')
    if (references.length > (node.draft.mode === 'image' ? 6 : 15)) invalid('This generator has too many references.')
  }
}

export function parseProjectCreate(value: unknown): ProjectCreate {
  const result = parse(createSchema, value)
  validateGraph(result)
  return result
}
export function parseProjectUpdate(value: unknown): ProjectUpdate {
  const result = parse(updateSchema, value)
  validateGraph(result)
  return result
}
export function parseProjectDelete(value: unknown): ProjectDelete { return parse(deleteSchema, value) }
export function parseProjectId(value: unknown): string { return parse(idSchema, value) }
