import type { Character, CharacterPhotos } from '~/entities/character/types'
export function characterPayload(character: Character) {
  const stage = (value: CharacterPhotos) => ({
    notes: value.notes,
    photos: Object.fromEntries(
      Object.entries(value.photos).map(([angle, photo]) => {
        if (!photo?.assetId && !photo?.id) throw new Error('Upload this photo before saving.')
        return [
          angle,
          {
            id: photo.assetId ?? photo.id,
            assetId: photo.assetId ?? photo.id,
            name: photo.name,
          },
        ]
      }),
    ),
  })
  return {
    name: character.name,
    handle: character.handle,
    face: stage(character.face),
    body: stage(character.body),
  }
}
