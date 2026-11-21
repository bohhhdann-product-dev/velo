export interface MentionAsset {
  characterVersionId?: string
  id: string
  kind: 'character' | 'image'
  name: string
  handle: string
  url: string
}
export interface MentionOption {
  id: string
  kind: 'canvas' | 'character' | 'image'
  name: string
  handle: string
  url: string
  connected: boolean
  disabled: string
  asset?: MentionAsset
}
