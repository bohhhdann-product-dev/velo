// Execute the actual TS domain/store modules with Nuxt alias resolution.
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import assert from 'node:assert/strict'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('~/'))
      return {
        url: new URL(`../app/${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    if (
      specifier.startsWith('.') &&
      context.parentURL?.endsWith('.ts') &&
      !specifier.endsWith('.ts')
    )
      return next(specifier + '.ts', context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context)
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      shortCircuit: true,
    }
  },
})
const { createPinia, setActivePinia } = await import('pinia')
const { useStudioStore } = await import('../app/stores/studio.ts')
const { defaultDraft, priceCredits, VIDEO_MODELS } = await import(
  '../app/entities/studio/catalog.ts'
)
const { nodeSize, inPort, outPort } = await import('../app/entities/studio/geometry.ts')
setActivePinia(createPinia())
const s = useStudioStore()
s.seed()
const id = s.projects[0].id
const n = s.addGeneratorNode(id, 500, 200, 'video')
assert.equal(n.draft.modelId, 'seedance-2-5')
s.travel(id, 'past')
assert.ok(!s.project(id).nodes.some((v) => v.id === n.id))
s.travel(id, 'future')
assert.ok(s.project(id).nodes.some((v) => v.id === n.id))
assert.equal(priceCredits({ ...n.draft, trial: true }), 1440)
const videoTokenTotals = [4854, 3176, 2542, 1588]
for (const [index, model] of VIDEO_MODELS.entries())
  assert.equal(priceCredits({ ...n.draft, modelId: model.value }), videoTokenTotals[index])
s.updateDraft(id, n.id, { durationS: 30 })
s.updateDraft(id, n.id, { modelId: 'seedance-2-0-mini' })
assert.equal(s.project(id).nodes.find((v) => v.id === n.id).draft.durationS, 15)
const ref = s.addReferenceNode(id, { url: '/demo/test.png', name: 'Test' }, 0, 0)
assert.ok(s.connect(id, ref.id, n.id, 'end'))
s.updateDraft(id, n.id, { prompt: 'Test' })
const balance = s.credits
assert.equal(s.generateFromNode(id, n.id).ok, false)
assert.equal(s.credits, balance)
assert.ok(s.connect(id, ref.id, n.id, 'start'))
assert.ok(!s.connect(id, n.id, ref.id))
const enlarged = { ...n, scale: 2 }
assert.equal(outPort(enlarged).x, n.x + nodeSize(n).w * 2)
assert.equal(inPort(enlarged, 'end').y, n.y + 386)
assert.equal(defaultDraft().modelId, 'seedream-5-pro')
for (let i = 0; i < 70; i++) s.addReferenceNode(id, { url: '/x', name: 'x' }, i, 0)
assert.equal(s.history[id].past.length, 60)
console.log(
  'PASS: model prices, trial, duration clamp, undo/redo, frame validation, reference direction, scaled ports, 60-state limit',
)

// Workflow regression: real store, deterministic queued/running/completed and failed runs.
const { zoomAround, resizeScale, intersects, boundsOf } = await import(
  '../app/entities/studio/geometry.ts'
)
const { computed, effectScope, nextTick } = await import('vue')
const { useCanvasSelection } = await import(
  '../app/features/canvas/composables/useCanvasSelection.ts'
)
setActivePinia(createPinia())
const store = useStudioStore()
store.seed()
const projectId = store.projects[0].id
const project = () => store.project(projectId)
const output = project().nodes.find((n) => n.type === 'take')
const initialCount = project().nodes.length
const next = store.continueFrom(projectId, output.id, 'image')
assert.equal(
  store.connectedReferences(projectId, next.id)[0].url,
  store.findTake(output.takeId).take.url,
)
assert.equal(next.draft.prompt, '')
store.travel(projectId, 'past')
assert.equal(project().nodes.length, initialCount)
assert.ok(
  !project().edges.some((e) => e.to === next.id),
  'continuation creation and edge undo together',
)
store.travel(projectId, 'future')
const gen = project().nodes.find((n) => n.id === next.id)
const timers = [],
  originalTimeout = globalThis.setTimeout,
  originalRandom = Math.random
try {
  globalThis.setTimeout = (callback) => {
    timers.push(callback)
    return 0
  }
  Math.random = () => 0.5
  const before = store.credits
  assert.ok(store.generateFromNode(projectId, gen.id).ok, 'reference-only generation must work')
  const generation = store.generations[0]
  const cost = generation.priceCredits
  assert.equal(store.credits, before - cost)
  assert.ok(!store.generateFromNode(projectId, gen.id).ok, 'double submit must not charge again')
  assert.equal(store.credits, before - cost)
  assert.ok(generation.takes.every((t) => t.status === 'queued'))
  for (let i = 0; i < generation.takes.length; i++) timers.shift()()
  assert.ok(generation.takes.every((t) => t.status === 'running'))
  while (timers.length) timers.shift()()
  assert.ok(generation.takes.every((t) => t.status === 'done'))
  const result = project().nodes.find(
    (n) => n.type === 'take' && n.takeId === generation.takes[0].id,
  )
  assert.match(store.connectionError(projectId, result.id, gen.id), /loop/)
  assert.ok(!store.connect(projectId, result.id, gen.id))
  const video = store.continueFrom(projectId, result.id, 'video')
  const ref2 = store.addReferenceNode(
    projectId,
    { url: '/demo/forest-path.jpg', name: 'Second' },
    0,
    0,
  )
  assert.ok(
    !store.connect(projectId, ref2.id, video.id, 'start'),
    'frames and references are exclusive',
  )
  const ids = [result.id, video.id]
  store.groupNodes(projectId, ids)
  assert.equal(
    project().nodes.find((n) => n.id === result.id).groupId,
    project().nodes.find((n) => n.id === video.id).groupId,
  )
  const copied = store.pasteNodes(projectId, store.copyNodes(projectId, ids), { x: 2500, y: 100 })
  assert.equal(copied.length, 2)
  assert.notEqual(copied[0].groupId, project().nodes.find((n) => n.id === result.id).groupId)
  assert.ok(project().edges.some((e) => e.from === copied[0].id && e.to === copied[1].id))
  store.removeNodes(
    projectId,
    copied.map((n) => n.id),
  )
  assert.ok(!project().edges.some((e) => copied.some((n) => n.id === e.from || n.id === e.to)))
  store.travel(projectId, 'past')
  assert.ok(
    copied.every((n) => project().nodes.some((p) => p.id === n.id)),
    'batch delete is one undo step',
  )
  store.groupNodes(
    projectId,
    copied.map((n) => n.id),
    true,
  )
  assert.ok(copied.every((n) => !project().nodes.find((p) => p.id === n.id).groupId))
  const removedTakeId = result.takeId
  store.removeNode(projectId, result.id)
  assert.ok(store.restoreTakeNode(projectId, removedTakeId, { x: 3000, y: 100 }))
  assert.ok(store.findTake(removedTakeId), 'deleting a node keeps its history result')
  const failure = store.addGeneratorNode(projectId, 0, 2000, 'image')
  store.updateDraft(projectId, failure.id, { prompt: 'Refund test', count: 1 })
  const beforeFailure = store.credits
  assert.ok(store.generateFromNode(projectId, failure.id).ok)
  Math.random = () => 0
  while (timers.length) timers.shift()()
  const failed = store.generations[0].takes[0]
  assert.equal(failed.status, 'failed')
  assert.equal(store.credits, beforeFailure, 'failed take refunded exactly once')
  Math.random = () => 0.5
  assert.ok(store.retryTake(failed.id))
  assert.ok(!store.retryTake(failed.id))
  while (timers.length) timers.shift()()
  assert.equal(failed.status, 'done')
} finally {
  globalThis.setTimeout = originalTimeout
  Math.random = originalRandom
}

// Selection must expand groups, toggle additively and survive undo/removal.
const scope = effectScope()
const selection = scope.run(() =>
  useCanvasSelection(computed(project), (n) => ({ x: n.x, y: n.y, ...nodeSize(n) })),
)
const pair = project()
  .nodes.slice(0, 2)
  .map((n) => n.id)
store.groupNodes(projectId, pair)
selection.pick(pair[0])
assert.ok(pair.every((id) => selection.selectedIds.value.has(id)))
selection.pick(pair[1], true)
assert.equal(selection.selectedIds.value.size, 0)
selection.pick(pair[0])
const selectedBeforeRemoval = [...selection.selectedIds.value]
store.removeNodes(projectId, pair)
await nextTick()
assert.deepEqual(
  [...selection.selectedIds.value],
  selectedBeforeRemoval.filter((id) => !pair.includes(id)),
  'selection drops deleted members and retains surviving group members',
)
scope.stop()

for (const scale of [0.25, 0.5, 1, 2]) {
  const camera = { x: -200, y: 140, scale },
    anchor = { x: 230, y: 400 }
  const zoomed = zoomAround(camera, anchor, scale * 1.2)
  assert.ok(Math.abs((anchor.x - camera.x) / scale - (anchor.x - zoomed.x) / zoomed.scale) < 1e-9)
  assert.ok(Math.abs((anchor.y - camera.y) / scale - (anchor.y - zoomed.y) / zoomed.scale) < 1e-9)
}
assert.equal(resizeScale(1, { w: 200, h: 200 }, { x: 100, y: 100 }), 1.5)
assert.equal(resizeScale(1, { w: 200, h: 200 }, { x: -2000, y: -2000 }), 0.75)
const media = { id: 'ref', type: 'reference', url: '/x', name: 'x', x: 0, y: 0, scale: 3 }
assert.equal(outPort(media).y, 36, 'media port height does not grow with the image')
assert.equal(nodeSize(media).h, 208 * 3 + 40, 'caption stays fixed while media grows')
assert.ok(
  intersects({ x: 0, y: 0, w: 100, h: 100 }, { x: 90, y: 90, w: 30, h: 30 }),
  'marquee catches partial intersection',
)
assert.ok(!intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 30, h: 30 }))
assert.deepEqual(boundsOf([{ x: 10, y: 20, w: 100, h: 80 }], 10), { x: 0, y: 10, w: 120, h: 100 })
assert.deepEqual(store.pasteNodes(projectId, '{"nodes":[null],"edges":[]}', { x: 0, y: 0 }), [])
console.log(
  'PASS: continuation + atomic undo, reference-only lifecycle, duplicate-submit guard, cycles, frame exclusivity, grouping, clipboard remapping, batch delete, history restore, refund/retry, selection, anchored zoom, media resize, marquee bounds',
)

// Reference tags identify actual inputs, rename atomically, and survive clipboard/undo.
const { referenceHandle, mentionAt, insertMention, replaceMentions } = await import(
  '../app/entities/studio/mentions.ts'
)
setActivePinia(createPinia())
const tags = useStudioStore()
tags.seed()
const tagProject = tags.projects[0].id
const refA = tags.addReferenceNode(
  tagProject,
  { name: 'Quiet Forest.jpg', url: '/demo/forest-path.jpg' },
  0,
  0,
)
const refB = tags.addReferenceNode(
  tagProject,
  { name: 'Quiet Forest.jpg', url: '/demo/forest-path.jpg' },
  0,
  400,
)
assert.equal(referenceHandle(refA), 'quiet-forest')
assert.equal(referenceHandle(refB), 'quiet-forest-2')
const tagGen = tags.addGeneratorNode(tagProject, 500, 0)
assert.ok(
  tags.mentionReference(
    tagProject,
    tagGen.id,
    refA.id,
    'Use @quiet-forest, keep @quiet-forest-2 unchanged.',
  ),
)
assert.equal(tags.connectedReferences(tagProject, tagGen.id)[0].id, refA.id)
tags.travel(tagProject, 'past')
assert.equal(tags.connectedReferences(tagProject, tagGen.id).length, 0)
assert.equal(tags.project(tagProject).nodes.find((n) => n.id === tagGen.id).draft.prompt, '')
tags.travel(tagProject, 'future')
tags.renameNode(tagProject, refA.id, 'Silver Forest')
const renamed = tags.project(tagProject).nodes.find((n) => n.id === refA.id)
assert.equal(renamed.name, 'Silver Forest')
assert.equal(renamed.handle, 'silver-forest')
assert.equal(
  tags.project(tagProject).nodes.find((n) => n.id === tagGen.id).draft.prompt,
  'Use @silver-forest, keep @quiet-forest-2 unchanged.',
)
tags.travel(tagProject, 'past')
assert.equal(tags.project(tagProject).nodes.find((n) => n.id === refA.id).name, 'Quiet Forest.jpg')
assert.ok(
  tags
    .project(tagProject)
    .nodes.find((n) => n.id === tagGen.id)
    .draft.prompt.includes('@quiet-forest,'),
)
tags.travel(tagProject, 'future')
const tagCopies = tags.pasteNodes(tagProject, tags.copyNodes(tagProject, [refA.id, tagGen.id]), {
  x: 1000,
  y: 0,
})
const copiedRef = tagCopies.find((n) => n.type === 'reference')
assert.equal(copiedRef.handle, 'silver-forest-2')
assert.ok(tagCopies.find((n) => n.type === 'generator').draft.prompt.includes('@silver-forest-2,'))
const videoGen = tags.addGeneratorNode(tagProject, 0, 800, 'video')
assert.ok(tags.connect(tagProject, refA.id, videoGen.id, 'start'))
assert.equal(tags.mentionReference(tagProject, videoGen.id, refB.id, 'Use @quiet-forest-2'), false)
assert.equal(videoGen.draft.prompt, '', 'blocked reference must not insert an unusable tag')
assert.deepEqual(mentionAt('Use @qui', 8), { start: 4, end: 8, query: 'qui' })
assert.equal(mentionAt('mail@test', 9), null)
assert.equal(mentionAt('Use @quiet', 10, 4), null)
assert.deepEqual(insertMention('Use @qui-forest in frame', { start: 4, end: 8 }, 'silver-forest'), {
  text: 'Use @silver-forest in frame',
  caret: 19,
})
assert.equal(replaceMentions('@ліс and @ліс-2', new Map([['ліс', 'ранок']])), '@ранок and @ліс-2')
assert.equal(
  nodeSize({ id: 't', type: 'take', x: 0, y: 0, scale: 2, takeId: 't', generationId: 'g' }, '16:9')
    .h,
  336,
  'result has no status footer',
)
console.log(
  'PASS: unique reference tags, automatic connection + atomic undo, rename propagation, clipboard tags, framed-video guard, caret insertion, Unicode, footer-free result geometry',
)
assert.equal(tags.promptReferenceError(tagProject, tagGen.id, 'Use @silver-forest'), '')
assert.match(
  tags.promptReferenceError(tagProject, tagGen.id, 'Use @quiet-forest-2'),
  /Connect @quiet-forest-2/,
)
assert.match(tags.promptReferenceError(tagProject, tagGen.id, 'Use @missing'), /No reference named/)
const tagBalance = tags.credits
tags.updateDraft(tagProject, tagGen.id, { prompt: 'Use @missing' })
assert.equal(tags.generateFromNode(tagProject, tagGen.id).ok, false)
assert.equal(tags.credits, tagBalance)
console.log('PASS: missing/disconnected tags block generation without spending mock credits')
assert.deepEqual(
  tags.pasteNodes(
    tagProject,
    JSON.stringify({ nodes: [{ id: 'bad', type: 'reference', url: '/x', x: 0, y: 0 }], edges: [] }),
    { x: 0, y: 0 },
  ),
  [],
)
assert.deepEqual(
  tags.pasteNodes(
    tagProject,
    JSON.stringify({
      nodes: [{ id: 'bad', type: 'generator', draft: { mode: 'image' }, x: 0, y: 0 }],
      edges: [],
    }),
    { x: 0, y: 0 },
  ),
  [],
)

// The minimap uses the same world coordinates as the camera, independent of canvas zoom.
const { fitMinimap, minimapRect, worldToMinimap, minimapToWorld } = await import(
  '../app/entities/studio/minimap.ts'
)
const { viewportBounds, centerViewport } = await import('../app/entities/studio/geometry.ts')
const mapSize = { w: 240, h: 154 }
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
for (const scale of [0.25, 0.8, 1, 2]) {
  const camera = { x: -820, y: 330, scale }
  const canvasSize = { w: 1100, h: 700 }
  const visible = viewportBounds(camera, canvasSize)
  const nodes = [
    { x: -3500, y: -1700, w: 800, h: 600 },
    { x: 4200, y: 2900, w: 200, h: 1000 },
  ]
  const projection = fitMinimap(nodes, visible, mapSize)
  for (const rect of [...nodes, visible]) {
    const projected = minimapRect(rect, projection)
    assert.ok(projected.x >= 12 - 1e-7 && projected.y >= 12 - 1e-7)
    assert.ok(projected.x + projected.w <= 228 + 1e-7)
    assert.ok(projected.y + projected.h <= 142 + 1e-7)
    close(projected.w / projected.h, rect.w / rect.h)
    const restored = minimapToWorld(worldToMinimap(rect, projection), projection)
    close(restored.x, rect.x)
    close(restored.y, rect.y)
  }
  const target = { x: 1250, y: -400 }
  const centered = { ...camera, ...centerViewport(camera, canvasSize, target) }
  assert.equal(centered.scale, scale)
  const after = viewportBounds(centered, canvasSize)
  close(after.x + after.w / 2, target.x)
  close(after.y + after.h / 2, target.y)
  // Holding the projection constant during a drag maps pixel deltas linearly at every zoom.
  const from = minimapToWorld({ x: 80, y: 60 }, projection)
  const to = minimapToWorld({ x: 95, y: 50 }, projection)
  close(to.x - from.x, 15 / projection.scale)
  close(to.y - from.y, -10 / projection.scale)
}
for (const viewport of [
  { x: 0, y: 0, w: 0, h: 0 },
  { x: 100000, y: -100000, w: 800, h: 600 },
]) {
  const projection = fitMinimap([], viewport, mapSize)
  assert.ok(Object.values(projection).every(Number.isFinite))
  assert.ok(projection.scale > 0)
  const projected = minimapRect(viewport, projection)
  close(projected.x + projected.w / 2, mapSize.w / 2)
  close(projected.y + projected.h / 2, mapSize.h / 2)
}
console.log(
  'PASS: minimap bounds, aspect ratio, projection roundtrip, empty/distant canvases, zoom-preserving navigation and stable drag deltas',
)

// Characters are local photo-backed identities; approvals and saved sheets must stay in sync.
const { useCharactersStore } = await import('../app/stores/characters.ts')
const { characterStep, characterPhotos } = await import('../app/entities/character/types.ts')
const { photoFileError, MAX_PHOTO_BYTES } = await import('../app/entities/character/sheet.ts')
const characters = useCharactersStore()
const person = characters.create()
const personId = person.id
assert.equal(characterStep(person), 'identity')
assert.equal(characters.approve(personId, 'body'), false)
characters.updateIdentity(personId, { name: 'Avery' })
assert.equal(person.handle, 'avery')
const secondPerson = characters.create()
characters.updateIdentity(secondPerson.id, { name: 'Avery' })
assert.equal(secondPerson.handle, 'avery-2')
characters.updateIdentity(secondPerson.id, { name: 'Avery Work' })
assert.equal(
  secondPerson.handle,
  'avery-work',
  'An automatic collision suffix keeps following the name',
)
const longName = 'a'.repeat(48)
const longPerson = characters.create()
characters.updateIdentity(longPerson.id, { name: longName })
const longDuplicate = characters.create()
characters.updateIdentity(longDuplicate.id, { name: longName })
assert.equal(longDuplicate.handle.length, 48)
assert.equal(characters.identityError(longDuplicate.id), '')
characters.updateIdentity(secondPerson.id, { handle: '@avery' })
assert.match(characters.identityError(secondPerson.id), /already in use/)
characters.updateIdentity(secondPerson.id, { handle: 'авері' })
assert.equal(characters.identityError(secondPerson.id), '')
assert.equal(characters.approve(personId, 'face'), false)
const photo = { id: 'front', url: '/demo/forest-path.jpg', name: 'QA fixture.jpg' }
characters.setPhoto(personId, 'face', 'front', photo)
assert.equal(characters.approve(personId, 'face'), true)
assert.equal(characterStep(person), 'body')
characters.setPhoto(personId, 'body', 'front', photo)
assert.equal(characters.approve(personId, 'body'), true)
assert.equal(characterStep(person), 'sheet')
assert.match(characters.save(personId), /build the reference sheet/)
assert.equal(characters.setSheet(personId, '/qa-sheet.jpg', person.revision), true)
assert.equal(characters.save(personId), '')
assert.equal(characters.saved.length, 1)
const oldRevision = person.revision
characters.setPhoto(personId, 'face', 'left', { ...photo, id: 'left' })
assert.equal(person.face.approved, false)
assert.equal(person.body.approved, false)
assert.equal(person.sheetUrl, null)
assert.equal(characters.saved.length, 0)
assert.equal(characters.setSheet(personId, '/stale-sheet.jpg', oldRevision), false)
assert.equal(characters.approve(personId, 'body'), false)
characters.approve(personId, 'face')
characters.approve(personId, 'body')
characters.updateNotes(personId, 'body', 'Keep natural proportions')
assert.equal(person.face.approved, true)
assert.equal(person.body.approved, false)
characters.approve(personId, 'body')
characters.setSheet(personId, '/qa-sheet-current.jpg', person.revision)
characters.save(personId)
assert.equal(characterPhotos(person, 'face').length, 2)
characters.updateIdentity(personId, { handle: 'avery-new' })
assert.equal(person.savedAt, null)
assert.equal(person.sheetUrl, '/qa-sheet-current.jpg')
assert.equal(characters.save(personId), '')
assert.equal(photoFileError({ type: 'image/jpeg', size: 4000 }), '')
assert.match(photoFileError({ type: 'image/svg+xml', size: 100 }), /JPG/)
assert.match(photoFileError({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 }), /12 MB/)

// Insertion is atomic, collision-safe, reusable, model-aware, and isolated from provider credits.
const actorProject = tags.createProject('Character mention QA')
const actorGen = actorProject.nodes[0]
const actorId = actorProject.id
const asset = {
  id: `character:${personId}`,
  kind: 'character',
  name: person.name,
  handle: person.handle,
  url: person.sheetUrl,
}
tags.addReferenceNode(actorId, { url: '/fixture.jpg', name: person.handle }, -300, 100)
const option = tags.assetMentionOption(actorId, actorGen.id, asset)
assert.equal(option.handle, 'avery-new-2')
const beforeInsert = JSON.stringify({ nodes: actorProject.nodes, edges: actorProject.edges })
const beforeCredits = tags.credits
const result = tags.mentionAsset(actorId, actorGen.id, asset, 'Scene with @ by the sea', {
  start: 11,
  end: 12,
})
assert.equal(result.ok, true)
assert.equal(actorGen.draft.prompt, 'Scene with @avery-new-2 by the sea')
assert.equal(tags.promptReferenceError(actorId, actorGen.id, actorGen.draft.prompt), '')
assert.equal(tags.credits, beforeCredits)
assert.equal(
  actorProject.nodes.filter((n) => n.type === 'reference' && n.assetId === asset.id).length,
  1,
)
tags.mentionAsset(actorId, actorGen.id, asset, '@', { start: 0, end: 1 })
assert.equal(actorProject.nodes.filter((n) => n.assetId === asset.id).length, 1)
assert.equal(actorProject.edges.filter((e) => e.to === actorGen.id).length, 1)
tags.travel(actorId, 'past')
tags.travel(actorId, 'past')
assert.equal(JSON.stringify({ nodes: actorProject.nodes, edges: actorProject.edges }), beforeInsert)
tags.travel(actorId, 'future')
const attached = actorProject.nodes.find((n) => n.type === 'reference' && n.assetId === asset.id)
assert.ok(attached)
const copiedCharacter = tags.copyNodes(actorId, [attached.id, actorGen.id])
const pastedCharacter = tags.pasteNodes(actorId, copiedCharacter, { x: 1500, y: 100 })
const pastedReference = pastedCharacter.find((n) => n.type === 'reference')
const pastedGenerator = pastedCharacter.find((n) => n.type === 'generator')
assert.equal(pastedReference.assetId, asset.id)
assert.notEqual(pastedReference.handle, attached.handle)
assert.equal(
  tags.promptReferenceError(actorId, pastedGenerator.id, pastedGenerator.draft.prompt),
  '',
)
const characterVideoGen = tags.addGeneratorNode(actorId, 2000, 100, 'video')
tags.connect(actorId, attached.id, characterVideoGen.id, 'start')
const blockedBefore = JSON.stringify(actorProject)
const blocked = tags.mentionAsset(actorId, characterVideoGen.id, asset, '@', { start: 0, end: 1 })
assert.equal(blocked.ok, false)
assert.equal(JSON.stringify(actorProject), blockedBefore)
const snapshotPerson = JSON.parse(JSON.stringify(person))
characters.remove(personId)
assert.equal(characters.find(personId), undefined)
assert.equal(
  tags.promptReferenceError(actorId, pastedGenerator.id, pastedGenerator.draft.prompt),
  '',
)
characters.restore(snapshotPerson)
assert.ok(characters.find(personId)?.savedAt)
console.log(
  'PASS: character approval dependencies, stale-sheet rejection, handles, photo validation, library insertion + atomic undo, deduplication, clipboard, frame guard and deletion isolation',
)
