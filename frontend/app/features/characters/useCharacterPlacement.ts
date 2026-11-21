import { toast } from 'vue-sonner'
import type { Character } from '~/entities/character/types'
import type { MentionAsset } from '~/entities/studio/prompt'
import { useStudioStore } from '~/stores/studio'

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
  async function useInVideo(character: Character) {
    if (!character.savedAt || !character.sheetUrl) return
    studio.seed()
    let project
    try {
      project = studio.projects[0] ?? (await studio.createProjectAsync())
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not open canvas.')
      return
    }
    const position = studio.freePosition(project.id, 480, 160, 336, 589)
    const generator = studio.addGeneratorNode(project.id, position.x, position.y, 'video')
    studio.mentionAsset(project.id, generator.id, characterAsset(character), '', {
      start: 0,
      end: 0,
    })
    return navigateTo(`/p/${project.id}`)
  }
  return { useInVideo }
}
