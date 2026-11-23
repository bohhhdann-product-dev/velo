import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useWorkspaceStore } from '~/stores/workspace'
import { useBillingStore } from '~/stores/billing'
import { quoteGeneration } from '~/entities/studio/pricing'
import { useProjectPersistence } from '~/shared/persistence/useProjectPersistence'
import { projectPayload } from '~/shared/persistence/projectPayload'
import { requiresReload } from '~/shared/api/workspace'
import { photoFileError } from '~/entities/character/sheet'
import type {
  CanvasEdge,
  CanvasNode,
  Draft,
  Generation,
  GeneratorNode,
  LibraryItem,
  Project,
  Mode,
  Take,
  TakeNode,
  ReferenceNode,
} from '~/entities/studio/types'
import type { MentionAsset } from '~/entities/studio/prompt'
import { defaultDraft, priceCredits, videoModel } from '~/entities/studio/catalog'
import { GENERATOR_W, nodeSize, takeBodySize, intersects } from '~/entities/studio/geometry'
import {
  referenceHandle,
  uniqueHandle,
  replaceMentions,
  mentionedHandles,
  insertMention,
} from '~/entities/studio/mentions'
import { mockImageUrl, mockVideo } from '~/entities/studio/mockMedia'
import { CHARACTER_VIDEO_REASON, GENERATION_UNCONFIGURED, capabilitiesForModel, normalizeModelDraft, preferredVideoModel, type GenerationCapabilities } from '~/entities/studio/generation'

/* Canvas editing is shared by demo and live workspaces. Only demo mode runs
   the simulated generation lifecycle; live documents use the save coordinator. */

let idCounter = 0
function makeId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

const FAIL_RATE = 0.08

const SPAWN_GAP = 28
const SPAWN_OFFSET = 96

export const useStudioStore = defineStore('studio', () => {
  const workspace = useWorkspaceStore()
  const billing = useBillingStore()
  const live = computed(() => workspace.live)
  const credits = ref(workspace.live ? 0 : 500)
  const tokens = computed(() => workspace.live ? billing.wallet?.availableTokens ?? 0 : credits.value)
  const projects = ref<Project[]>([])
  const generations = ref<Generation[]>([])
  const library = ref<LibraryItem[]>([])
  const generationCapabilities = ref<GenerationCapabilities>({ ...GENERATION_UNCONFIGURED })
  function generatorDraft(mode?: Mode): Draft {
    if (!workspace.live) return { ...defaultDraft(), mode: mode ?? 'image', modelId: mode === 'video' ? 'seedance-2-5' : 'seedream-5-pro' }
    const caps = generationCapabilities.value
    const video = preferredVideoModel(caps)
    const selectedMode = mode ?? (capabilitiesForModel(caps, { modelId: caps.imageModel }).enabled || !video ? 'image' : 'video')
    return normalizeModelDraft({ ...defaultDraft(), mode: selectedMode, modelId: selectedMode === 'image' ? caps.imageModel : video ?? caps.videoModels[0] ?? 'seedance-2-5' }, caps)
  }
  function referenceLimit(draft: Draft) {
    const caps = capabilitiesForModel(generationCapabilities.value, draft)
    return workspace.live ? (draft.mode === 'image' ? caps.maxImageReferences : caps.maxVideoReferences) : draft.mode === 'image' ? 6 : videoModel(draft).maxReferences
  }
  const generationSubmissions = ref<Record<string, { status: 'submitting' | 'unconfirmed' | 'error' | 'expired'; message?: string }>>({})
  const generationPollError = ref('')
  const favoritePending = ref<Record<string, boolean>>({})
  let generationTimer: ReturnType<typeof setTimeout> | undefined
  let generationEpoch = 0
  let generationRequest = 0
  const copySnapshots = new Map<string, ReturnType<typeof projectPayload>>()
  const persistence = useProjectPersistence(projects)
  const saveStates = persistence.states
  const reloads = persistence.reloads
  function hydrateLive(loaded: Project[], assets: LibraryItem[], jobs: Generation[] = [], capabilities = GENERATION_UNCONFIGURED) {
    stopGenerationPolling()
    persistence.reset()
    copySnapshots.clear()
    projects.value = loaded
    library.value = assets
    credits.value = 0
    generations.value = jobs
    generationCapabilities.value = { ...capabilities }
    generationSubmissions.value = {}
    persistence.start()
    scheduleGenerationPoll()
  }
  function resetPrivate() {
    stopGenerationPolling()
    persistence.reset()
    copySnapshots.clear()
    projects.value = []
    generations.value = []
    library.value = []
    history.value = {}
    credits.value = workspace.live ? 0 : 500
    generationSubmissions.value = {}
    favoritePending.value = {}
    generationCapabilities.value = { ...GENERATION_UNCONFIGURED }
  }
  function stopGenerationPolling() {
    generationEpoch++
    clearTimeout(generationTimer)
    generationPollError.value = ''
  }
  function upsertGeneration(incoming: Generation) {
    const existing = generations.value.find((item) => item.id === incoming.id)
    if (!existing) { generations.value.unshift(incoming); return incoming }
    const takes = incoming.takes.map((take) => {
      const current = existing.takes.find((item) => item.id === take.id)
      return current ? Object.assign(current, take) : take
    })
    Object.assign(existing, incoming, { takes })
    return existing
  }
  function scheduleGenerationPoll() {
    clearTimeout(generationTimer)
    if (workspace.live && generations.value.some((job) => job.takes.some((take) => ['queued', 'running'].includes(take.status))))
      generationTimer = setTimeout(() => void refreshGenerations(), 3000)
  }
  async function refreshGenerations() {
    if (!workspace.live) return
    const session = workspace.sessionVersion, epoch = generationEpoch, request = ++generationRequest
    try {
      const result = await workspace.request<{ generations: Generation[] }>('/api/generations')
      workspace.assertSession(session)
      if (epoch !== generationEpoch || request !== generationRequest) return
      result.generations.forEach(upsertGeneration)
      void billing.refresh()
      generationPollError.value = ''
    } catch (cause) {
      if (session !== workspace.sessionVersion || epoch !== generationEpoch || request !== generationRequest) return
      generationPollError.value = 'Could not refresh generation status. Checking again shortly.'
    }
    scheduleGenerationPoll()
  }
  function generationBlocked(projectId: string, generatorId: string) {
    const target = project(projectId)
    const node = target?.nodes.find((item): item is GeneratorNode => item.id === generatorId && item.type === 'generator')
    if (!node || !target) return 'Generator not found.'
    const draft = node.draft, caps = capabilitiesForModel(generationCapabilities.value, draft)
    const references = target.edges.filter((edge) => edge.to === generatorId)
    if (draft.mode === 'video' && references.some((edge) => target.nodes.some((item) => item.id === edge.from && item.type === 'reference' && item.assetKind === 'character')) && !caps.characterVideo)
      return CHARACTER_VIDEO_REASON
    if (!caps.enabled) return caps.reason || 'This model is not connected yet.'
    if (generations.value.some((job) => job.projectId === projectId && job.generatorId === generatorId && job.takes.some((take) => take.status === 'unknown')))
      return 'A previous provider outcome is unconfirmed. Check its status before starting another generation.'
    if (activeCount(projectId, generatorId)) return 'Generation in progress'
    if (!(draft.mode === 'image' ? [caps.imageModel] : caps.videoModels).includes(draft.modelId)) return 'Choose a supported model.'
    if (!caps.aspects.includes(draft.aspect) || !caps.counts.includes(draft.count)) return 'Choose a supported format and output count.'
    if (draft.trial && !caps.trial) return 'Trial generation is unavailable. Turn off trial to continue.'
    if (draft.mode === 'video' && (draft.durationS < caps.videoDuration.min || draft.durationS > caps.videoDuration.max || (draft.durationS - caps.videoDuration.min) % caps.videoDuration.step !== 0)) return 'Choose a supported duration.'
    if (draft.mode === 'image' ? !caps.imageQualities.includes(draft.imageQuality) : !caps.videoQualities.includes(draft.videoQuality)) return 'Choose a supported quality.'
    if (draft.mode === 'image' && !draft.prompt.trim()) return 'Add a prompt describing the image to create.'
    if (!draft.prompt.trim() && !references.length) return 'Add a prompt or reference first.'
    if (references.some((edge) => !sourceMedia(projectId, edge.from))) return 'A connected reference is not available yet.'
    const frames = references.filter((edge) => edge.slot)
    if (frames.length && !caps.referenceModes.includes('start-end')) return 'This model does not support start/end frames.'
    if (references.some((edge) => !edge.slot) && !caps.referenceModes.includes('images')) return 'This model does not support reference images.'
    if (frames.some((edge) => edge.slot === 'end') && !frames.some((edge) => edge.slot === 'start')) return 'Add a start image first.'
    if (frames.length && references.some((edge) => !edge.slot)) return 'Use reference images or start/end frames, not both.'
    const limit = draft.mode === 'image' ? caps.maxImageReferences : caps.maxVideoReferences
    if (references.filter((edge) => !edge.slot).length > limit) return `Remove extra references (maximum ${limit}).`
    const referenceError = promptReferenceError(projectId, generatorId, draft.prompt)
    if (referenceError) return referenceError
    const quote = generationQuote(projectId, generatorId)
    if (!quote) return 'Pricing is being confirmed for this model.'
    if (!billing.wallet || billing.error) return 'Your token balance is unavailable. Open Tokens to refresh it.'
    if (quote.totalTokens > tokens.value) return 'Not enough tokens for this generation.'
    return ''
  }
  async function generateFromNodeAsync(projectId: string, generatorId: string) {
    if (!workspace.live) return generateFromNode(projectId, generatorId)
    const session = workspace.sessionVersion
    const key = `generation:${projectId}:${generatorId}`
    if (generationSubmissions.value[generatorId]?.status === 'submitting') return
    const replay = workspace.hasPendingMutation(key)
    if (!replay) {
      const blocked = generationBlocked(projectId, generatorId)
      if (blocked) throw new Error(blocked)
    }
    generationSubmissions.value[generatorId] = { status: 'submitting' }
    let held = false
    try {
      if (!replay) await persistence.flush(projectId)
      workspace.assertSession(session)
      persistence.hold(projectId)
      held = true
      const quote = generationQuote(projectId, generatorId)
      const result = await workspace.mutate<{ generation: Generation; project: Project }>(key, `/api/projects/${projectId}/generations`, {
        method: 'POST', body: { generatorId, expectedRevision: project(projectId)?.revision, clientMutationId: crypto.randomUUID(),
          expectedPriceTokens: quote?.totalTokens, pricingVersion: quote?.version },
      })
      workspace.assertSession(session)
      upsertGeneration(result.generation)
      persistence.mergeGeneration(result.project, result.generation.id)
      delete generationSubmissions.value[generatorId]
      scheduleGenerationPoll()
    } catch (cause) {
      workspace.assertSession(session)
      const retained = workspace.hasPendingMutation(key)
      generationSubmissions.value[generatorId] = {
        status: requiresReload(cause) ? 'expired' : retained ? 'unconfirmed' : 'error',
        message: cause instanceof Error ? cause.message : 'Could not submit generation.',
      }
      if (held && !retained) persistence.release(projectId)
      throw cause
    } finally {
      if (session === workspace.sessionVersion) void billing.refresh()
    }
  }
  async function createProjectAsync(
    title?: string,
    source?: Project,
    mutationKey = 'project:create',
  ) {
    if (!workspace.live) return createProject(title)
    const session = workspace.sessionVersion
    const draft: Project = source
      ? { ...source, title: title ?? source.title }
      : {
          id: crypto.randomUUID(),
          title: title ?? `Untitled ${projects.value.length + 1}`,
          createdAt: Date.now(),
          nodes: [
            {
              id: makeId('node'),
              type: 'generator',
              x: 120,
              y: 160,
              draft: generatorDraft(),
            },
          ],
          edges: [],
          viewport: { x: 0, y: 0, scale: 1 },
        }
    const { project: created } = await workspace.mutate<{ project: Project }>(
      mutationKey,
      '/api/projects',
      {
        method: 'POST',
        body: {
          ...projectPayload(draft),
          clientMutationId: crypto.randomUUID(),
        },
      },
    )
    workspace.assertSession(session)
    const existing = project(created.id)
    if (existing) return existing
    persistence.register(created)
    projects.value.unshift(created)
    return created
  }
  async function deleteProjectAsync(id: string) {
    const session = workspace.sessionVersion
    if (workspace.live) {
      const key = `project:delete:${id}`
      if (!workspace.hasPendingMutation(key)) await persistence.flush(id)
      workspace.assertSession(session)
      persistence.hold(id)
      try {
        await workspace.mutate(key, `/api/projects/${id}`, {
          method: 'DELETE',
          body: {
            expectedRevision: project(id)?.revision,
            clientMutationId: crypto.randomUUID(),
          },
        })
      } catch (cause) {
        workspace.assertSession(session)
        if (!workspace.hasPendingMutation(key)) persistence.release(id)
        throw cause
      }
    }
    workspace.assertSession(session)
    persistence.remove(id)
    deleteProject(id)
    delete history.value[id]
    if (workspace.live) void billing.refresh()
  }
  async function reloadProject(id: string) {
    await persistence.reload(id)
    for (const node of project(id)?.nodes ?? []) if (node.type === 'generator') {
      workspace.forgetMutation(`generation:${id}:${node.id}`)
      delete generationSubmissions.value[node.id]
    }
    delete history.value[id]
    if (workspace.live) await refreshGenerations()
  }
  async function keepProjectCopy(id: string) {
    const source = project(id)
    if (!source) throw new Error('Project not found.')
    const session = workspace.sessionVersion
    const key = `project:copy:${id}`
    if (!workspace.hasPendingMutation(key)) copySnapshots.set(id, projectPayload(source))
    const snapshot = copySnapshots.get(id)
    try {
      const copy = await createProjectAsync(`${source.title} (copy)`, source, key)
      // A receipt retry can confirm an older copy. Only its original snapshot
      // permits reconciling the source; edits during POST or GET stay recoverable.
      if (workspace.live && snapshot && copySnapshots.get(id) === snapshot) {
        try {
          if (await persistence.reload(id, snapshot)) delete history.value[id]
        } catch {
          workspace.assertSession(session)
          toast('Copy saved. Reload the original canvas to resolve its save status.')
        }
      }
      return copy
    } finally {
      if (!workspace.hasPendingMutation(key) && copySnapshots.get(id) === snapshot)
        copySnapshots.delete(id)
    }
  }
  async function uploadLibraryItem(file: File) {
    const error = photoFileError(file)
    if (error) throw new Error(error)
    if (!workspace.live)
      return addLibraryItem(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''))
    const session = workspace.sessionVersion
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    workspace.assertSession(session)
    const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const key = `asset:upload:${digest}:${JSON.stringify([file.name, file.type])}`
    const body = new FormData()
    body.append('file', file)
    body.append('clientMutationId', crypto.randomUUID())
    try {
      const { asset } = await workspace.mutate<{ asset: LibraryItem }>(key, '/api/assets', {
        method: 'POST',
        body,
      })
      workspace.assertSession(session)
      const existing = library.value.find((item) => item.id === asset.id)
      if (existing) return existing
      library.value.unshift(asset)
      return asset
    } catch (cause) {
      workspace.assertSession(session)
      if (workspace.hasPendingMutation(key) && !requiresReload(cause))
        throw new Error(`Could not confirm the upload of “${file.name}”. Select the same file again to retry.`, { cause })
      throw cause
    }
  }
  async function toggleAssetFavorite(id: string) {
    const session = workspace.sessionVersion
    const current = library.value.find((item) => item.id === id)
    if (!current) return
    if (!workspace.live) {
      current.favorite = !current.favorite
      return
    }
    const { asset } = await workspace.request<{ asset: LibraryItem }>(`/api/assets/${id}`, {
      method: 'PATCH',
      body: { favorite: !current.favorite },
    })
    workspace.assertSession(session)
    const index = library.value.findIndex((item) => item.id === id)
    if (index !== -1) library.value[index] = asset
  }
  async function removeLibraryItemAsync(id: string) {
    const session = workspace.sessionVersion
    if (workspace.live) await workspace.request(`/api/assets/${id}`, { method: 'DELETE' })
    workspace.assertSession(session)
    removeLibraryItem(id)
  }

  const favorites = computed(() =>
    generations.value.flatMap((g) => g.takes.filter((t) => t.favorite && t.status === 'done')),
  )

  function project(id: string): Project | undefined {
    return projects.value.find((p) => p.id === id)
  }

  function findTake(takeId: string): { take: Take; generation: Generation } | null {
    for (const generation of generations.value) {
      const take = generation.takes.find((t) => t.id === takeId)
      if (take) return { take, generation }
    }
    return null
  }

  // Canvas history intentionally excludes billing and asynchronous take status.
  const history = ref<Record<string, { past: string[]; future: string[] }>>({})
  function snapshot(id: string) {
    const p = project(id)!
    return JSON.stringify({ nodes: p.nodes, edges: p.edges })
  }
  function checkpoint(id: string) {
    const h = (history.value[id] ??= { past: [], future: [] })
    const state = snapshot(id)
    if (h.past.at(-1) !== state) h.past = [...h.past.slice(-59), state]
    h.future = []
  }
  function travel(id: string, direction: 'past' | 'future') {
    const h = history.value[id]
    const state = h?.[direction].pop()
    if (!h || !state) return
    h[direction === 'past' ? 'future' : 'past'].push(snapshot(id))
    Object.assign(project(id)!, JSON.parse(state))
  }
  function updateDraft(id: string, nodeId: string, patch: Partial<Draft>) {
    const n = project(id)?.nodes.find((n) => n.id === nodeId)
    if (n?.type !== 'generator') return
    checkpoint(id)
    Object.assign(n.draft, patch)
    if (workspace.live) {
      if (patch.modelId !== undefined || patch.mode !== undefined) Object.assign(n.draft, normalizeModelDraft(n.draft, generationCapabilities.value))
    } else n.draft.durationS = Math.min(n.draft.durationS, videoModel(n.draft).maxDuration)
  }

  /* ------------------------------ projects ------------------------------- */

  function createProject(title?: string): Project {
    if (workspace.live) throw new Error('Use createProjectAsync in the live workspace.')
    const generator: GeneratorNode = {
      id: makeId('node'),
      type: 'generator',
      x: 120,
      y: 160,
      draft: defaultDraft(),
    }
    const created: Project = {
      id: makeId('proj'),
      title: title ?? `Untitled ${projects.value.length + 1}`,
      createdAt: Date.now(),
      nodes: [generator],
      edges: [],
      viewport: { x: 0, y: 0, scale: 1 },
    }
    projects.value.unshift(created)
    return projects.value[0]!
  }

  function renameProject(id: string, title: string) {
    const target = project(id)
    if (target && title.trim()) target.title = title.trim().slice(0, 160)
  }

  function deleteProject(id: string) {
    projects.value = projects.value.filter((p) => p.id !== id)
    generations.value = generations.value.filter((g) => g.projectId !== id || projects.value.some((p) => p.nodes.some((node) => node.type === 'take' && node.generationId === g.id)))
  }

  /* ------------------------------- canvas -------------------------------- */

  function addNode(projectId: string, node: CanvasNode) {
    checkpoint(projectId)
    project(projectId)?.nodes.push(node)
  }

  function moveNode(projectId: string, nodeId: string, x: number, y: number) {
    const node = project(projectId)?.nodes.find((n) => n.id === nodeId)
    if (node) {
      node.x = x
      node.y = y
    }
  }

  function removeNodes(projectId: string, ids: string[]) {
    const target = project(projectId)
    if (!target || !target.nodes.some((n) => ids.includes(n.id))) return
    checkpoint(projectId)
    target.nodes = target.nodes.filter((n) => !ids.includes(n.id))
    target.edges = target.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to))
    cleanGroups(target)
  }
  function removeNode(projectId: string, nodeId: string) {
    removeNodes(projectId, [nodeId])
  }

  function cleanGroups(target: Project) {
    const counts = new Map<string, number>()
    target.nodes.forEach((n) => {
      if (n.groupId) counts.set(n.groupId, (counts.get(n.groupId) ?? 0) + 1)
    })
    target.nodes.forEach((n) => {
      if (n.groupId && counts.get(n.groupId)! < 2) delete n.groupId
    })
  }
  function groupNodes(id: string, ids: string[], ungroup = false) {
    const target = project(id)
    if (!target) return []
    const groups = new Set(
      target.nodes
        .filter((n) => ids.includes(n.id))
        .map((n) => n.groupId)
        .filter(Boolean),
    )
    const members = target.nodes.filter(
      (n) => ids.includes(n.id) || (n.groupId && groups.has(n.groupId)),
    )
    if (
      ungroup
        ? !groups.size
        : members.length < 2 ||
          (groups.size === 1 && members.every((n) => n.groupId === members[0]?.groupId))
    )
      return members.map((n) => n.id)
    checkpoint(id)
    const groupId = makeId('group')
    members.forEach((n) => {
      if (ungroup) delete n.groupId
      else n.groupId = groupId
    })
    return members.map((n) => n.id)
  }
  function referenceHandles(projectId: string, exceptId?: string) {
    return (project(projectId)?.nodes ?? []).flatMap((n) =>
      n.type === 'reference' && n.id !== exceptId ? [referenceHandle(n)] : [],
    )
  }
  function renameNode(id: string, nodeId: string, title: string) {
    const target = project(id)
    const node = target?.nodes.find((n) => n.id === nodeId)
    const name = title.trim().slice(0, 80)
    if (
      !target ||
      !node ||
      !name ||
      (node.title ?? (node.type === 'reference' ? node.name : '')) === name
    )
      return
    checkpoint(id)
    if (node.type === 'reference') {
      const oldHandle = referenceHandle(node)
      node.handle = uniqueHandle(name, referenceHandles(id, node.id))
      node.name = name
      for (const generator of target.nodes) {
        if (generator.type === 'generator')
          generator.draft.prompt = replaceMentions(
            generator.draft.prompt,
            new Map([[oldHandle, node.handle]]),
          )
      }
    }
    node.title = name
  }
  function promptReferenceError(projectId: string, generatorId: string, prompt: string) {
    const target = project(projectId)
    for (const handle of mentionedHandles(prompt)) {
      const reference = target?.nodes.find(
        (n) => n.type === 'reference' && referenceHandle(n) === handle,
      )
      if (!reference) return `No reference named @${handle}`
      if (
        !target?.edges.some((e) => e.from === reference.id && e.to === generatorId && !e.slot)
      )
        return `Connect @${handle} to use this reference`
    }
    return ''
  }
  function mentionReference(
    projectId: string,
    generatorId: string,
    referenceId: string,
    prompt: string,
  ) {
    const target = project(projectId)
    const generator = target?.nodes.find((n) => n.id === generatorId)
    const reference = target?.nodes.find((n) => n.id === referenceId)
    if (!target || generator?.type !== 'generator' || reference?.type !== 'reference')
      return false
    const connected = target.edges.some(
      (e) => e.from === referenceId && e.to === generatorId && !e.slot,
    )
    if (!connected && target.edges.some((e) => e.to === generatorId && e.slot)) return false
    if (!connected && connectionError(projectId, referenceId, generatorId)) return false
    checkpoint(projectId)
    if (!connected) connect(projectId, referenceId, generatorId, undefined, false)
    generator.draft.prompt = prompt
    return true
  }
  function assetMentionOption(projectId: string, generatorId: string, asset: MentionAsset) {
    const target = project(projectId)
    const generator = target?.nodes.find((n) => n.id === generatorId)
    const candidates = (target?.nodes ?? []).filter(
      (n): n is ReferenceNode => n.type === 'reference' && n.assetId === asset.id,
    )
    const existing =
      candidates.find((n) =>
        target?.edges.some((e) => e.from === n.id && e.to === generatorId && !e.slot),
      ) ?? candidates[0]
    const connected =
      !!existing &&
      !!target?.edges.some((e) => e.from === existing.id && e.to === generatorId && !e.slot)
    let disabled = ''
    if (!target || generator?.type !== 'generator') disabled = 'Generator not found.'
    else if (workspace.live && generator.draft.mode === 'video' && asset.kind === 'character' && !capabilitiesForModel(generationCapabilities.value, generator.draft).characterVideo)
      disabled = CHARACTER_VIDEO_REASON
    else if (workspace.live && !capabilitiesForModel(generationCapabilities.value, generator.draft).referenceModes.includes('images'))
      disabled = 'This model does not support reference images.'
    else if (!connected && target.edges.some((e) => e.to === generatorId && e.slot))
      disabled = 'Disconnect start/end frames to use character or image references.'
    else if (existing)
      disabled = connected ? '' : (connectionError(projectId, existing.id, generatorId) ?? '')
    else {
      const inputs = target.edges.filter((e) => e.to === generatorId)
      const limit = referenceLimit(generator.draft)
      if (inputs.some((e) => e.slot))
        disabled = 'Disconnect start/end frames to use character or image references.'
      else if (inputs.length >= limit)
        disabled = `This model accepts up to ${limit} references.`
    }
    return {
      id: asset.id,
      kind: asset.kind,
      name: asset.name,
      handle: existing
        ? referenceHandle(existing)
        : uniqueHandle(asset.handle, referenceHandles(projectId)),
      url: asset.url,
      connected,
      disabled,
      asset,
      nodeId: existing?.id,
    }
  }
  // Inserting a library mention pins its reference, connects it and edits the prompt in one undo.
  function mentionAsset(
    projectId: string,
    generatorId: string,
    asset: MentionAsset,
    text: string,
    range: { start: number; end: number },
  ) {
    const option = assetMentionOption(projectId, generatorId, asset)
    if (option.disabled) return { ok: false as const, error: option.disabled }
    const target = project(projectId)!
    const generator = target.nodes.find(
      (n): n is GeneratorNode => n.id === generatorId && n.type === 'generator',
    )!
    checkpoint(projectId)
    let node = target.nodes.find(
      (n): n is ReferenceNode => n.id === option.nodeId && n.type === 'reference',
    )
    if (!node) {
      const at = freePosition(projectId, generator.x - 304, generator.y, 208, 248)
      node = {
        id: makeId('node'),
        type: 'reference',
        assetId: asset.id,
        assetKind: asset.kind,
        ...(asset.characterVersionId ? { characterVersionId: asset.characterVersionId } : {}),
        url: asset.url,
        name: asset.name,
        handle: option.handle,
        ...at,
      }
      target.nodes.push(node)
    }
    node.url = asset.url
    if (!option.connected) connect(projectId, node.id, generatorId, undefined, false)
    const inserted = insertMention(text, range, option.handle)
    generator.draft.prompt = inserted.text
    return { ok: true as const, ...inserted, nodeId: node.id }
  }
  function sourceMedia(projectId: string, nodeId: string) {
    const node = project(projectId)?.nodes.find((n) => n.id === nodeId)
    if (workspace.live && node?.type === 'reference' && !node.assetId) return null
    if (node?.type === 'reference')
      return {
        id: node.id,
        url: node.url,
        name: node.title ?? node.name,
        handle: referenceHandle(node),
      }
    if (node?.type !== 'take') return null
    const found = findTake(node.takeId)
    if (!found || found.take.status !== 'done' || (workspace.live && !found.take.assetId)) return null
    const url = found.generation.draft.mode === 'image' ? found.take.url : found.take.posterUrl
    return url
      ? {
          id: node.id,
          url,
          name:
            node.title ??
            (found.generation.draft.mode === 'image' ? 'Image result' : 'Video still'),
        }
      : null
  }
  function connectionError(
    projectId: string,
    fromId: string,
    toId: string,
    slot?: 'start' | 'end',
  ) {
    const target = project(projectId)
    const to = target?.nodes.find((n) => n.id === toId)
    if (!target || !sourceMedia(projectId, fromId) || to?.type !== 'generator')
      return 'Connect an image or a finished result to a generator.'
    const source = target.nodes.find((node) => node.id === fromId)
    const caps = capabilitiesForModel(generationCapabilities.value, to.draft)
    if (workspace.live && to.draft.mode === 'video' && source?.type === 'reference' && source.assetKind === 'character' && !caps.characterVideo)
      return CHARACTER_VIDEO_REASON
    if (slot && to.draft.mode !== 'video')
      return 'Frame inputs are only available on video generators.'
    if (workspace.live && !caps.referenceModes.includes(slot ? 'start-end' : 'images'))
      return slot ? 'This model does not support start/end frames.' : 'This model does not support reference images.'
    const seen = new Set<string>()
    const reachesSource = (id: string): boolean => {
      if (id === fromId) return true
      if (seen.has(id)) return false
      seen.add(id)
      return target.edges.filter((e) => e.from === id).some((e) => reachesSource(e.to))
    }
    if (reachesSource(toId)) return 'This connection would create a loop.'
    const other = target.edges.filter((e) => e.to === toId && e.from !== fromId)
    if (
      to.draft.mode === 'video' &&
      (slot ? other.some((e) => !e.slot) : other.some((e) => e.slot))
    )
      return 'Use references or start/end frames. Disconnect the other inputs first.'
    const limit = referenceLimit(to.draft)
    if (!slot && other.filter((e) => !e.slot).length >= limit)
      return `This model accepts up to ${limit} references.`
    return null
  }
  function connect(
    projectId: string,
    fromId: string,
    toId: string,
    slot?: 'start' | 'end',
    record = true,
  ): boolean {
    const target = project(projectId)
    if (!target || connectionError(projectId, fromId, toId, slot)) return false
    if (target.edges.some((e) => e.from === fromId && e.to === toId && e.slot === slot))
      return false
    if (record) checkpoint(projectId)
    target.edges = target.edges.filter(
      (e) =>
        !(
          e.to === toId &&
          ((slot && e.slot === slot) ||
            (e.from === fromId && Boolean(e.slot) !== Boolean(slot)))
        ),
    )
    target.edges.push({ id: makeId('edge'), from: fromId, to: toId, slot })
    return true
  }

  function freePosition(id: string, x: number, y: number, w: number, h: number) {
    const target = project(id)!
    const rects = target.nodes.map((n) => ({
      x: n.x - 24,
      y: n.y - 52,
      ...nodeSize(
        n,
        n.type === 'take' ? findTake(n.takeId)?.generation.draft.aspect : undefined,
      ),
    }))
    for (let attempt = 0; attempt < 200; attempt++) {
      const rect = { x, y: y - 28, w: w + 48, h: h + 80 }
      const hit = rects.find((r) => intersects(rect, r))
      if (!hit) break
      y = hit.y + hit.h + 80
    }
    return { x, y }
  }
  function continueFrom(
    id: string,
    sourceId: string,
    mode: Mode,
    at?: { x: number; y: number },
  ) {
    const target = project(id)
    const source = target?.nodes.find((n) => n.id === sourceId)
    if (!source || !sourceMedia(id, sourceId)) return null
    const aspect =
      source.type === 'take' ? findTake(source.takeId)?.generation.draft.aspect : undefined
    const position =
      at ??
      freePosition(
        id,
        source.x + nodeSize(source, aspect).w + 96,
        source.y,
        GENERATOR_W,
        mode === 'video' ? 589 : 429,
      )
    const node = addGeneratorNode(id, position.x, position.y, mode)
    if (source.type === 'take') {
      const previous = findTake(source.takeId)?.generation.draft
      if (previous?.mode === mode) node.draft = { ...previous, prompt: '', referenceId: null }
    }
    connect(id, sourceId, node.id, undefined, false)
    return node
  }
  function restoreTakeNode(projectId: string, takeId: string, at: { x: number; y: number }) {
    const target = project(projectId)
    const found = findTake(takeId)
    if (!target || !found || found.generation.projectId !== projectId) return null
    const existing = target.nodes.find((n) => n.type === 'take' && n.takeId === takeId)
    if (existing) return existing
    const size = takeBodySize(found.generation.draft.aspect)
    const node: TakeNode = {
      id: makeId('node'),
      type: 'take',
      takeId,
      generationId: found.generation.id,
      ...freePosition(projectId, at.x, at.y, size.w, size.h + 2),
    }
    addNode(projectId, node)
    const generatorId = found.generation.generatorId
    if (generatorId && target.nodes.some((n) => n.id === generatorId))
      target.edges.push({ id: makeId('edge'), from: generatorId, to: node.id })
    return node
  }
  function copyNodes(id: string, ids: string[]) {
    const target = project(id)!
    return JSON.stringify({
      nodes: target.nodes.filter((n) => ids.includes(n.id)),
      edges: target.edges.filter((e) => ids.includes(e.from) && ids.includes(e.to)),
    })
  }
  function pasteNodes(id: string, serialized: string, point: { x: number; y: number }) {
    let copied: { nodes: CanvasNode[]; edges: CanvasEdge[] }
    try {
      copied = JSON.parse(serialized)
    } catch {
      return []
    }
    if (
      !copied ||
      !Array.isArray(copied.nodes) ||
      !copied.nodes.length ||
      !Array.isArray(copied.edges)
    )
      return []
    const target = project(id)
    if (
      !target ||
      copied.nodes.length > 500 ||
      copied.nodes.some(
        (n) =>
          !n ||
          typeof n.id !== 'string' ||
          !Number.isFinite(n.x) ||
          !Number.isFinite(n.y) ||
          !['generator', 'reference', 'take'].includes(n.type) ||
          (n.type === 'generator' &&
            (!n.draft || !['image', 'video'].includes(n.draft.mode))) ||
          (n.type === 'reference' &&
            (typeof n.url !== 'string' ||
              typeof n.name !== 'string' ||
              (n.handle !== undefined && typeof n.handle !== 'string'))) ||
          (n.title !== undefined && typeof n.title !== 'string') ||
          (n.type === 'generator' && typeof n.draft?.prompt !== 'string') ||
          (n.type === 'take' && !findTake(n.takeId)),
      )
    )
      return []
    const originalIds = new Set(copied.nodes.map((n) => n.id))
    if (originalIds.size !== copied.nodes.length) return []
    copied.edges = copied.edges.filter(
      (e) => e && originalIds.has(e.from) && originalIds.has(e.to),
    )
    checkpoint(id)
    const minX = Math.min(...copied.nodes.map((n) => n.x)),
      minY = Math.min(...copied.nodes.map((n) => n.y))
    const ids = new Map(copied.nodes.map((n) => [n.id, makeId('node')]))
    const groups = new Map<string, string>()
    let number = Math.max(
      0,
      ...target.nodes
        .filter((n) => n.type === 'generator')
        .map((n) => (n.type === 'generator' ? (n.number ?? 1) : 0)),
    )
    const nodes = copied.nodes.map((n) => {
      if (n.groupId && !groups.has(n.groupId)) groups.set(n.groupId, makeId('group'))
      return {
        ...n,
        ...(n.type === 'generator' ? { number: ++number } : {}),
        id: ids.get(n.id)!,
        x: point.x + n.x - minX,
        y: point.y + n.y - minY,
        groupId: n.groupId ? groups.get(n.groupId) : undefined,
      }
    })
    const handles = new Map<string, string>()
    const reserved = referenceHandles(id)
    for (const node of nodes) {
      if (node.type !== 'reference') continue
      const old = referenceHandle(node)
      node.handle = uniqueHandle(node.title ?? node.name, reserved)
      reserved.push(node.handle)
      handles.set(old, node.handle)
    }
    for (const node of nodes) {
      if (node.type === 'generator')
        node.draft.prompt = replaceMentions(node.draft.prompt, handles)
    }
    target.nodes.push(...nodes)
    target.edges.push(
      ...copied.edges.map((e) => ({
        ...e,
        id: makeId('edge'),
        from: ids.get(e.from)!,
        to: ids.get(e.to)!,
      })),
    )
    return nodes
  }

  function disconnect(projectId: string, edgeId: string) {
    const target = project(projectId)
    if (target) checkpoint(projectId)
    if (target) target.edges = target.edges.filter((e) => e.id !== edgeId)
  }

  function addReferenceNode(
    projectId: string,
    item: { id?: string; url: string; name: string },
    x: number,
    y: number,
  ) {
    const node: CanvasNode = {
      id: makeId('node'),
      type: 'reference',
      url: item.url,
      ...(item.id ? { assetId: item.id, assetKind: 'image' as const } : {}),
      name: item.name,
      handle: uniqueHandle(item.name, referenceHandles(projectId)),
      x,
      y,
    }
    addNode(projectId, node)
    return node
  }

  function addGeneratorNode(
    projectId: string,
    x: number,
    y: number,
    mode: 'image' | 'video' = 'image',
  ) {
    const number =
      Math.max(
        0,
        ...(project(projectId)
          ?.nodes.filter((n) => n.type === 'generator')
          .map((n) => (n.type === 'generator' ? (n.number ?? 1) : 0)) ?? []),
      ) + 1
    const node: GeneratorNode = {
      id: makeId('node'),
      type: 'generator',
      number,
      draft: generatorDraft(mode),
      x,
      y,
    }
    addNode(projectId, node)
    return project(projectId)!.nodes.find((n) => n.id === node.id) as GeneratorNode
  }

  function connectedReferences(projectId: string, generatorId: string) {
    return (project(projectId)?.edges ?? [])
      .filter((e) => e.to === generatorId && !e.slot)
      .flatMap((e) => sourceMedia(projectId, e.from) ?? [])
  }
  function generationQuote(projectId: string, generatorId: string) {
    const target = project(projectId)
    const node = target?.nodes.find((item): item is GeneratorNode => item.id === generatorId && item.type === 'generator')
    return node ? quoteGeneration(node.draft, target!.edges.filter((edge) => edge.to === generatorId).length) : null
  }
  function activeCount(projectId: string, generatorId: string) {
    return generations.value
      .filter((g) => g.projectId === projectId && g.generatorId === generatorId)
      .flatMap((g) => g.takes)
      .filter((t) => t.status === 'queued' || t.status === 'running').length
  }

  /* ----------------------------- generation ------------------------------ */

  function finishTake(take: Take, generation: Generation) {
    const draft = generation.draft
    if (Math.random() < FAIL_RATE) {
      take.status = 'failed'
      take.errorMessage = 'The model could not finish this take. Tokens returned.'
      credits.value += (generation.priceTokens ?? generation.priceCredits ?? 0) / generation.draft.count
      return
    }
    if (draft.mode === 'image') {
      take.url = mockImageUrl(take.id, draft.aspect)
      take.posterUrl = null
    } else {
      const video = mockVideo(take.id, draft.aspect)
      take.url = video.url
      take.posterUrl = video.posterUrl
    }
    take.status = 'done'
  }

  function simulate(generation: Generation) {
    for (const take of generation.takes) {
      const startDelay = 500 + Math.random() * 1200
      const renderTime =
        generation.draft.mode === 'image'
          ? 2200 + Math.random() * 2600
          : 4200 + Math.random() * 4800

      setTimeout(() => {
        if (take.status !== 'queued') return
        take.status = 'running'
        setTimeout(() => {
          if (take.status !== 'running') return
          finishTake(take, generation)
        }, renderTime)
      }, startDelay)
    }
  }

  /**
   * Generate from a generator node on the board. Creates the generation,
   * lays the take nodes out to the right of the generator and wires edges.
   */
  function generateFromNode(
    projectId: string,
    generatorId: string,
  ): { ok: true } | { ok: false; error: string } {
    if (workspace.live) return { ok: false, error: 'Generation is not enabled yet.' }
    const target = project(projectId)
    const generator = target?.nodes.find(
      (n): n is GeneratorNode => n.id === generatorId && n.type === 'generator',
    )
    if (!target || !generator) return { ok: false, error: 'Generator not found.' }

    const prompt = generator.draft.prompt.trim()
    const mentionError = promptReferenceError(projectId, generatorId, prompt)
    if (mentionError) return { ok: false, error: mentionError }
    if (!prompt && !target.edges.some((e) => e.to === generatorId))
      return { ok: false, error: 'Add a prompt or an image to get started.' }
    if (activeCount(projectId, generatorId))
      return {
        ok: false,
        error: 'This generator is already creating outputs.',
      }

    const limit =
      generator.draft.mode === 'image' ? 6 : videoModel(generator.draft).maxReferences
    if (connectedReferences(projectId, generatorId).length > limit)
      return {
        ok: false,
        error: `This model supports up to ${limit} references. Remove extra references first.`,
      }
    const quote = generationQuote(projectId, generatorId)
    if (!quote) return { ok: false, error: 'Pricing is being confirmed for this model.' }
    const price = quote.totalTokens
    if (price > credits.value)
      return { ok: false, error: 'Not enough tokens for this generation.' }

    if (
      target.edges.some((e) => e.to === generatorId && e.slot === 'end') &&
      !target.edges.some((e) => e.to === generatorId && e.slot === 'start')
    )
      return { ok: false, error: 'Add a start image before an end image.' }
    checkpoint(projectId)
    credits.value -= price

    const generationId = makeId('gen')
    const generation: Generation = {
      id: generationId,
      generatorId,
      projectId,
      createdAt: Date.now(),
      draft: {
        ...generator.draft,
        prompt,
        ...(generator.draft.mode === 'video' && generator.draft.trial
          ? { durationS: 4, videoQuality: '480p' as const }
          : {}),
      },
      priceCredits: price,
      priceTokens: price,
      takes: Array.from({ length: generator.draft.count }, () => ({
        id: makeId('take'),
        generationId,
        status: 'queued' as const,
        url: null,
        posterUrl: null,
        favorite: false,
      })),
    }

    generations.value.unshift(generation)

    /* lay take nodes out in a row to the right of the generator,
       after its existing outputs (mirrors the reference studio) */
    const existingOutputs = target.nodes.filter(
      (n) =>
        n.type === 'take' && target.edges.some((e) => e.from === generatorId && e.to === n.id),
    )
    const body = takeBodySize(generation.draft.aspect)
    let nextX =
      existingOutputs.length > 0
        ? Math.max(
            ...existingOutputs.map(
              (n) =>
                n.x +
                nodeSize(
                  n,
                  n.type === 'take' ? findTake(n.takeId)?.generation.draft.aspect : undefined,
                ).w,
            ),
          ) + SPAWN_GAP
        : generator.x + nodeSize(generator).w + SPAWN_OFFSET

    for (const take of generation.takes) {
      const node: TakeNode = {
        id: makeId('node'),
        type: 'take',
        takeId: take.id,
        generationId,
        ...freePosition(projectId, nextX, generator.y, body.w, body.h + 2),
      }
      target.nodes.push(node)
      target.edges.push({ id: makeId('edge'), from: generatorId, to: node.id })
      nextX += body.w + SPAWN_GAP
    }

    simulate(generations.value[0]!)
    return { ok: true }
  }

  function retryTake(takeId: string): boolean {
    if (workspace.live) return false
    const found = findTake(takeId)
    if (!found || found.take.status !== 'failed') return false
    const { take, generation } = found
    const perTake = (generation.priceTokens ?? generation.priceCredits ?? 0) / generation.draft.count
    if (perTake > credits.value) return false
    credits.value -= perTake
    take.status = 'queued'
    take.url = null
    take.posterUrl = null
    take.errorMessage = undefined
    simulate({ ...generation, takes: [take] })
    return true
  }

  function toggleFavorite(takeId: string) {
    const found = findTake(takeId)
    if (!found || favoritePending.value[takeId]) return
    if (!workspace.live) { found.take.favorite = !found.take.favorite; return }
    const session = workspace.sessionVersion
    favoritePending.value[takeId] = true
    void workspace.request<{ generation: Generation }>(`/api/generations/${found.generation.id}/takes/${takeId}`, {
      method: 'PATCH', body: { favorite: !found.take.favorite },
    }).then((result) => {
      workspace.assertSession(session)
      const canonical = result.generation.takes.find((take) => take.id === takeId)
      const current = findTake(takeId)?.take
      if (canonical && current) current.favorite = canonical.favorite
      // Discard a poll begun before this acknowledgement, which may carry the old favorite.
      generationRequest++
      scheduleGenerationPoll()
    }).catch((cause) => {
      if (session === workspace.sessionVersion) toast.error(cause instanceof Error ? cause.message : 'Could not update favorite.')
    }).finally(() => { if (session === workspace.sessionVersion) delete favoritePending.value[takeId] })
  }

  /* ------------------------------- library ------------------------------- */

  function addLibraryItem(url: string, name: string) {
    library.value.unshift({
      id: makeId('lib'),
      url,
      name,
      createdAt: Date.now(),
    })
    return library.value[0]!
  }

  function removeLibraryItem(id: string) {
    library.value = library.value.filter((item) => item.id !== id)
  }

  /* -------------------------------- seed ---------------------------------- */

  function seed() {
    if (workspace.live) return
    if (projects.value.length > 0) return

    library.value = [
      {
        id: 'lib_seed_1',
        url: '/demo/forest-path.jpg',
        name: 'Forest textures',
        createdAt: Date.now() - 86_400_000,
      },
      {
        id: 'lib_seed_2',
        url: '/demo/forest-light.jpg',
        name: 'Morning light',
        createdAt: Date.now() - 172_800_000,
      },
      {
        id: 'lib_seed_3',
        url: '/demo/forest-life.jpg',
        name: 'Wild & still',
        createdAt: Date.now() - 259_200_000,
      },
    ]

    /* a seeded project with a reference wired into the generator and finished takes */
    const draft: Draft = {
      ...defaultDraft(),
      prompt:
        'Sunlight filtering through a quiet forest. Deep greens, soft morning haze, and a sense of stillness. Cinematic, natural, 35mm film.',
      aspect: '16:9',
      imageQuality: '2k',
      count: 2,
    }
    const generationId = makeId('gen')
    const takes: Take[] = Array.from({ length: 2 }, (_, i) => {
      const takeId = makeId('take')
      return {
        id: takeId,
        generationId,
        status: 'done' as const,
        url: i === 0 ? '/demo/forest-path.jpg' : '/demo/forest-life.jpg',
        posterUrl: null,
        favorite: i === 0,
      }
    })

    const generatorNode: GeneratorNode = {
      id: makeId('node'),
      type: 'generator',
      draft,
      x: 370,
      y: 160,
    }
    const referenceNode: CanvasNode = {
      id: makeId('node'),
      type: 'reference',
      url: library.value[1]!.url,
      name: library.value[1]!.name,
      x: 60,
      y: 230,
    }
    const seedBody = takeBodySize(draft.aspect)
    const takeNodes: TakeNode[] = takes.map((take, i) => ({
      id: makeId('node'),
      type: 'take',
      takeId: take.id,
      generationId,
      x: generatorNode.x + GENERATOR_W + SPAWN_OFFSET,
      y: 130 + i * (seedBody.h + 2 + 60),
    }))
    const edges: CanvasEdge[] = [
      { id: makeId('edge'), from: referenceNode.id, to: generatorNode.id },
      ...takeNodes.map((n) => ({
        id: makeId('edge'),
        from: generatorNode.id,
        to: n.id,
      })),
    ]

    projects.value.push({
      id: 'proj_seed_1',
      title: 'Into the quiet',
      createdAt: Date.now() - 3_600_000,
      nodes: [generatorNode, referenceNode, ...takeNodes],
      edges,
      viewport: { x: 0, y: 0, scale: 1 },
    })

    generations.value.push({
      id: generationId,
      projectId: 'proj_seed_1',
      createdAt: Date.now() - 3_600_000,
      draft: { ...draft },
      priceCredits: priceCredits(draft),
      takes,
    })
  }

  return {
    generationCapabilities,
    generationSubmissions,
    generationPollError,
    favoritePending,
    generationBlocked,
    generateFromNodeAsync,
    refreshGenerations,
    toggleAssetFavorite,
    live,
    hydrateLive,
    resetPrivate,
    createProjectAsync,
    deleteProjectAsync,
    uploadLibraryItem,
    removeLibraryItemAsync,
    saveStates,
    reloads,
    reloadProject,
    keepProjectCopy,
    retryProjectSave: persistence.retry,
    history,
    checkpoint,
    travel,
    updateDraft,
    credits,
    projects,
    generations,
    library,
    favorites,
    project,
    findTake,
    createProject,
    renameProject,
    deleteProject,
    addNode,
    moveNode,
    removeNode,
    removeNodes,
    groupNodes,
    renameNode,
    mentionReference,
    assetMentionOption,
    mentionAsset,
    promptReferenceError,
    sourceMedia,
    connectionError,
    freePosition,
    continueFrom,
    restoreTakeNode,
    copyNodes,
    pasteNodes,
    activeCount,
    connect,
    disconnect,
    addReferenceNode,
    addGeneratorNode,
    connectedReferences,
    generationQuote,
    tokens,
    generateFromNode,
    retryTake,
    toggleFavorite,
    addLibraryItem,
    removeLibraryItem,
    seed,
  }
})
