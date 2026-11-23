export type Mode = 'image' | 'video'

export type Aspect = '1:1' | '16:9' | '9:16'

export type ImageQuality = '1k' | '2k'
export type VideoQuality = '480p' | '720p'

export type TakeStatus = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

export interface Draft {
  modelId: string
  trial: boolean
  mode: Mode
  prompt: string
  aspect: Aspect
  imageQuality: ImageQuality
  videoQuality: VideoQuality
  durationS: number
  count: number
  referenceId: string | null
}

export interface Take {
  id: string
  generationId: string
  status: TakeStatus
  assetId?: string | null
  /** image URL (image mode) or video URL (video mode), set when done */
  url: string | null
  /** poster frame for video takes */
  posterUrl: string | null
  favorite: boolean
  errorMessage?: string
}

export interface Generation {
  id: string
  projectId: string
  createdAt: number
  draft: Draft
  priceCredits: number | null
  priceTokens?: number | null
  generatorId?: string
  takes: Take[]
}

/* ------------------------------- canvas ---------------------------------- */

export interface CanvasNodeBase {
  id: string
  scale?: number
  groupId?: string
  title?: string
  x: number
  y: number
}

/** the composer card on the board */
export interface GeneratorNode extends CanvasNodeBase {
  number?: number
  type: 'generator'
  draft: Draft
}

/** an image reference pinned to the board */
export interface ReferenceNode extends CanvasNodeBase {
  type: 'reference'
  assetId?: string
  assetKind?: 'character' | 'image'
  characterVersionId?: string
  handle?: string
  url: string
  name: string
}

/** one render result on the board */
export interface TakeNode extends CanvasNodeBase {
  type: 'take'
  takeId: string
  generationId: string
}

export type CanvasNode = GeneratorNode | ReferenceNode | TakeNode

/** directed edge: reference → generator, generator → take */
export interface CanvasEdge {
  id: string
  from: string
  to: string
  slot?: 'start' | 'end'
}

export interface Viewport {
  x: number
  y: number
  scale: number
}

export interface Project {
  revision?: number
  id: string
  title: string
  createdAt: number
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: Viewport
}

export interface LibraryItem {
  favorite?: boolean
  id: string
  url: string
  name: string
  createdAt: number
  mediaType?: 'image' | 'video'
  posterUrl?: string | null
}
