import { toast } from 'vue-sonner'
import type { Character } from '~/entities/character/types'
import type { MentionAsset } from '~/entities/studio/prompt'
import type { Mode } from '~/entities/studio/types'
import { useStudioStore } from '~/stores/studio'
import { characterVideoBlocked, preferredVideoModel } from '~/entities/studio/generation'

export function characterAsset(character: Character): MentionAsset {
  return {
    id: character.sheetAssetId ?? `character:${character.id}`,
    ...(character.characterVersionId
      ? { characterVersionId: character.characterVersionId }
      : {}),
    kind: 'character',
    name: character.name,
    handle: character.handle,
    url: character.sheetUrl!,
  }
}
export function useCharacterPlacement() {
  const studio = useStudioStore()
  async function place(character: Character, mode: Mode) {
    if (!character.savedAt || !character.sheetUrl) return
    let modelId: string | undefined
    if (mode === 'video' && studio.live) {
      const reason = characterVideoBlocked(studio.generationCapabilities)
      if (reason) { toast.error(reason); return }
      modelId = preferredVideoModel(studio.generationCapabilities, true)
    }
    studio.seed()
    let project
    try {
      project = studio.projects[0] ?? (await studio.createProjectAsync())
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not open canvas.')
      return
    }
    const position = studio.freePosition(project.id, 480, 160, 336, mode === 'video' ? 589 : 429)
    const generator = studio.addGeneratorNode(project.id, position.x, position.y, mode)
    if (modelId) studio.updateDraft(project.id, generator.id, { modelId })
    const result = studio.mentionAsset(project.id, generator.id, characterAsset(character), '', {
      start: 0,
      end: 0,
    })
    if (!result.ok) {
      studio.removeNode(project.id, generator.id)
      toast.error(result.error)
      return
    }
    return navigateTo(`/p/${project.id}`)
  }
  return { useInVideo: (character: Character) => place(character, 'video'), useInImage: (character: Character) => place(character, 'image') }
}
