export type CharacterStep = 'identity' | 'face' | 'body' | 'sheet'
export type PhotoStage = 'face' | 'body'
export type PhotoAngle = 'front' | 'left' | 'right' | 'extra'
export interface CharacterPhoto {
  assetId?: string
  id: string
  url: string
  name: string
}
export interface CharacterPhotos {
  photos: Partial<Record<PhotoAngle, CharacterPhoto>>
  notes: string
  approved: boolean
}
export interface Character {
  storageRevision?: number
  sheetAssetId?: string | null
  characterVersionId?: string | null
  id: string
  name: string
  handle: string
  face: CharacterPhotos
  body: CharacterPhotos
  sheetUrl: string | null
  savedAt: number | null
  revision: number
  createdAt: number
}
export const CHARACTER_STEPS: { id: CharacterStep; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'face', label: 'Face' },
  { id: 'body', label: 'Body' },
  { id: 'sheet', label: 'Sheet & save' },
]
export const PHOTO_ANGLES: { id: PhotoAngle; face: string; body: string }[] = [
  { id: 'front', face: 'Front portrait', body: 'Full body · front' },
  { id: 'left', face: 'Left profile', body: 'Left side' },
  { id: 'right', face: 'Right profile', body: 'Right side' },
  { id: 'extra', face: 'Three-quarter view', body: 'Back view' },
]
export function characterStep(character: Character): CharacterStep {
  if (!character.name.trim() || !character.handle.trim()) return 'identity'
  if (!character.face.approved) return 'face'
  if (!character.body.approved) return 'body'
  return 'sheet'
}
export function characterPhotos(character: Character, stage: PhotoStage) {
  return PHOTO_ANGLES.flatMap((angle) => {
    const photo = character[stage].photos[angle.id]
    return photo ? [{ ...photo, label: angle[stage], angle: angle.id }] : []
  })
}
