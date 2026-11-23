import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProjectCreate, parseProjectUpdate, parseProjectDelete } from '../../server/utils/project-validation'

export const generator = {
  id: 'gen_1', type: 'generator', x: 0, y: 0,
  draft: { modelId: 'seedream-5-pro', trial: false, mode: 'image', prompt: '', aspect: '1:1', imageQuality: '1k', videoQuality: '720p', durationS: 6, count: 2, referenceId: null },
}
export const project = { title: 'Test', nodes: [generator], edges: [], viewport: { x: 0, y: 0, scale: 1 }, clientMutationId: 'mutation_1' }
const invalid = (value: unknown) => assert.throws(() => parseProjectCreate(value), { statusCode: 400 })

test('accepts bounded project documents and immutable character references', () => {
  assert.equal(parseProjectCreate(project).nodes.length, 1)
  assert.equal(parseProjectCreate({ ...project, title: ' Test ' }).title, 'Test')
  assert.equal(parseProjectCreate({ ...project, nodes: [{ id: 'ref', type: 'reference', x: 0, y: 1, name: 'Character', assetId: 'sheet_1', assetKind: 'character', characterVersionId: 'version_1' }] }).nodes.length, 1)
})

test('rejects owner claims, arbitrary URLs, invalid coordinates, fake results and excessive limits', () => {
  invalid({ ...project, ownerId: 'another-user' })
  for (const x of [NaN, Infinity, -Infinity, 1_000_001]) invalid({ ...project, nodes: [{ ...generator, x }] })
  for (const url of ['blob:private', 'data:image/png;base64,AAAA', 'https://example.com/image.jpg', '/api/assets/x/file']) {
    invalid({ ...project, nodes: [{ id: 'ref', type: 'reference', x: 0, y: 0, name: 'Image', assetId: 'asset', url }] })
  }
  invalid({ ...project, nodes: [{ id: 'take', type: 'take', x: 0, y: 0, generationId: 'g', takeId: 't', url: 'https://fake.example/result' }] })
  invalid({ ...project, title: 'a'.repeat(161) })
  invalid({ ...project, nodes: [{ ...generator, draft: { ...generator.draft, prompt: 'x'.repeat(12_001) } }] })
  invalid({ ...project, nodes: Array.from({ length: 501 }, (_, index) => ({ ...generator, id: `g_${index}` })) })
  invalid({ ...project, viewport: { x: 0, y: 0, scale: 0 } })
})

test('rejects broken graph identities, connections and character pins', () => {
  const reference = { id: 'ref', type: 'reference', x: 0, y: 0, name: 'Image', assetId: 'asset', handle: 'image' }
  const edge = { id: 'edge', from: 'ref', to: 'gen_1' }
  const valid = { ...project, nodes: [reference, generator], edges: [edge] }
  assert.equal(parseProjectCreate(valid).edges.length, 1)
  invalid({ ...valid, nodes: [reference, reference, generator] })
  invalid({ ...valid, nodes: [reference, { ...reference, id: 'ref_2' }, generator] })
  invalid({ ...valid, edges: [edge, { ...edge, id: 'edge_2' }] })
  invalid({ ...valid, edges: [edge, { id: 'edge', from: 'other', to: 'gen_1' }] })
  invalid({ ...valid, edges: [{ ...edge, from: 'missing' }] })
  invalid({ ...valid, edges: [{ ...edge, from: 'gen_1', to: 'ref' }] })
  invalid({ ...valid, edges: [{ ...edge, from: 'gen_1' }] })
  invalid({ ...valid, edges: [{ ...edge, slot: 'start' }] })
  invalid({ ...project, nodes: [{ ...generator, draft: { ...generator.draft, referenceId: 'missing' } }] })
  invalid({ ...project, nodes: [{ ...reference, assetKind: 'character' }] })
  invalid({ ...project, nodes: [{ ...reference, assetKind: 'image', characterVersionId: 'version' }] })
})

test('rejects mixed frame inputs and occupied frame slots', () => {
  const nodes = [
    { ...generator, draft: { ...generator.draft, mode: 'video' } },
    { id: 'r1', type: 'reference', x: 0, y: 0, name: 'Image', assetId: 'asset1' },
    { id: 'r2', type: 'reference', x: 0, y: 0, name: 'Image', assetId: 'asset2' },
  ]
  const start = { id: 'e1', from: 'r1', to: 'gen_1', slot: 'start' }
  invalid({ ...project, nodes, edges: [start, { id: 'e2', from: 'r2', to: 'gen_1' }] })
  invalid({ ...project, nodes, edges: [start, { id: 'e2', from: 'r2', to: 'gen_1', slot: 'start' }] })
})

test('requires revision and mutation identity for updates and deletes', () => {
  assert.throws(() => parseProjectUpdate(project), { statusCode: 400 })
  assert.throws(() => parseProjectDelete({ clientMutationId: 'delete' }), { statusCode: 400 })
  assert.throws(() => parseProjectDelete({ expectedRevision: 1 }), { statusCode: 400 })
  assert.equal(parseProjectDelete({ expectedRevision: 1, clientMutationId: 'delete' }).expectedRevision, 1)
})
