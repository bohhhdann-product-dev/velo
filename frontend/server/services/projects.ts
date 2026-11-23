import { createHash, randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type postgres from 'postgres'
import type { Project } from '../../app/entities/studio/types'
import { getDb } from '../utils/db'
import { retireUnusedGenerations } from './generation/lifecycle'
import { replayReceipt } from './mutation-receipts'
import { hydrateProjectReferences, validateProjectReferences } from './project-media'
import type { ProjectBoard, ProjectCreate, ProjectDelete, ProjectUpdate } from '../utils/project-validation'

export type ProjectDTO = Project & { revision: number; updatedAt: number }
export type DurableProject = Omit<ProjectDTO, 'nodes'> & { nodes: ProjectBoard['nodes'] }
export type ProjectRow = {
  id: string; title: string; board: ProjectBoard; viewport: Project['viewport']; revision: number
  created_at: Date; updated_at: Date
}

export function projectSnapshot(row: ProjectRow): DurableProject {
  return {
    id: row.id,
    title: row.title,
    nodes: row.board.nodes,
    edges: row.board.edges,
    viewport: row.viewport,
    revision: row.revision,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export async function hydrateProject(ownerId: string, project: DurableProject): Promise<ProjectDTO> {
  return { ...project, nodes: await hydrateProjectReferences(ownerId, project.nodes) as Project['nodes'] }
}

function notFound(): never { throw createError({ statusCode: 404, statusMessage: 'Project not found' }) }
function conflict(revision: number): never {
  throw createError({ statusCode: 409, statusMessage: 'Project changed in another session', data: { code: 'revision_conflict', currentRevision: revision } })
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Receipt lookup precedes revisions; the owner lock also serializes asset deletion. */
async function mutate<T extends object>(
  ownerId: string,
  scope: string,
  input: { clientMutationId: string },
  operation: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const fingerprint = createHash('sha256').update(canonical(input)).digest('hex')
  return await getDb().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`
    const [receipt] = await tx`SELECT fingerprint, reply, created_at > now() - interval '7 days' AS replayable FROM mutation_receipts
      WHERE owner_id = ${ownerId} AND scope = ${scope} AND client_mutation_id = ${input.clientMutationId}`
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        throw createError({ statusCode: 409, statusMessage: 'Mutation ID was already used', data: { code: 'mutation_reused' } })
      }
      return replayReceipt(receipt.reply as T | null, receipt.replayable)
    }
    const result = await operation(tx)
    await tx`INSERT INTO mutation_receipts (owner_id, scope, client_mutation_id, fingerprint, reply)
      VALUES (${ownerId}, ${scope}, ${input.clientMutationId}, ${fingerprint}, ${tx.json(result as postgres.JSONValue)})`
    return result
  }) as T
}

export async function listProjects(ownerId: string): Promise<ProjectDTO[]> {
  const rows = await getDb()<ProjectRow[]>`SELECT id, title, board, viewport, revision, created_at, updated_at
    FROM projects WHERE owner_id = ${ownerId} AND deleted_at IS NULL ORDER BY updated_at DESC, id`
  return await Promise.all(rows.map((row) => hydrateProject(ownerId, projectSnapshot(row))))
}

export async function getProject(ownerId: string, id: string): Promise<ProjectDTO> {
  const [row] = await getDb()<ProjectRow[]>`SELECT id, title, board, viewport, revision, created_at, updated_at
    FROM projects WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL`
  if (!row) notFound()
  return await hydrateProject(ownerId, projectSnapshot(row))
}

export async function createProject(ownerId: string, input: ProjectCreate): Promise<ProjectDTO> {
  const project = await mutate(ownerId, 'projects:create', input, async (tx) => {
    await validateProjectReferences(tx, ownerId, input.nodes)
    const id = input.id ?? randomUUID()
    const board: ProjectBoard = { schemaVersion: 1, nodes: input.nodes, edges: input.edges }
    const [row] = await tx<ProjectRow[]>`INSERT INTO projects (id, owner_id, title, board, viewport)
      VALUES (${id}, ${ownerId}, ${input.title}, ${tx.json(board)}, ${tx.json(input.viewport)})
      ON CONFLICT (id) DO NOTHING RETURNING id, title, board, viewport, revision, created_at, updated_at`
    if (!row) throw createError({ statusCode: 409, statusMessage: 'Project ID is unavailable', data: { code: 'project_exists' } })
    return projectSnapshot(row)
  })
  return await hydrateProject(ownerId, project)
}

export async function updateProject(ownerId: string, id: string, input: ProjectUpdate): Promise<ProjectDTO> {
  const project = await mutate(ownerId, `projects:${id}:update`, input, async (tx) => {
    const [current] = await tx<ProjectRow[]>`SELECT id, revision FROM projects WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL FOR UPDATE`
    if (!current) notFound()
    if (current.revision !== input.expectedRevision) conflict(current.revision)
    await validateProjectReferences(tx, ownerId, input.nodes)
    const board: ProjectBoard = { schemaVersion: 1, nodes: input.nodes, edges: input.edges }
    const [row] = await tx<ProjectRow[]>`UPDATE projects SET title = ${input.title}, board = ${tx.json(board)},
      viewport = ${tx.json(input.viewport)}, revision = revision + 1, updated_at = now()
      WHERE id = ${id} AND owner_id = ${ownerId}
      RETURNING id, title, board, viewport, revision, created_at, updated_at`
    await retireUnusedGenerations(tx, ownerId)
    return projectSnapshot(row!)
  })
  return await hydrateProject(ownerId, project)
}

export async function deleteProject(ownerId: string, id: string, input: ProjectDelete): Promise<{ deleted: true; id: string }> {
  return await mutate(ownerId, `projects:${id}:delete`, input, async (tx) => {
    const [current] = await tx<ProjectRow[]>`SELECT id, revision FROM projects WHERE id = ${id} AND owner_id = ${ownerId} AND deleted_at IS NULL FOR UPDATE`
    if (!current) notFound()
    if (current.revision !== input.expectedRevision) conflict(current.revision)
    await tx`UPDATE projects SET deleted_at = now(), updated_at = now(), revision = revision + 1
      WHERE id = ${id} AND owner_id = ${ownerId}`
    await retireUnusedGenerations(tx, ownerId)
    return { deleted: true as const, id }
  })
}
