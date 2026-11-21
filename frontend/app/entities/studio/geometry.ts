import type { Aspect, CanvasNode } from '~/entities/studio/types'

export const GRID = 30
export const TITLE_H = 28
export const PORT_Y = 36
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
export const GENERATOR_W = 336
export const REFERENCE_W = 208
export const clampScale = (scale: number) => Math.min(4, Math.max(0.75, scale))
export const cardZoom = (node: CanvasNode) =>
  node.type === 'generator' ? clampScale(node.scale ?? 1) : 1

export interface Point {
  x: number
  y: number
}
export interface Bounds extends Point {
  w: number
  h: number
}

export function takeBodySize(aspect: Aspect): { w: number; h: number } {
  if (aspect === '9:16') return { w: 168, h: 298 }
  if (aspect === '16:9') return { w: 296, h: 167 }
  return { w: 260, h: 260 }
}

// Media grows without enlarging its controls. Generator content scales as a unit.
export function nodeSize(node: CanvasNode, aspect: Aspect = '1:1') {
  const scale = clampScale(node.scale ?? 1)
  if (node.type === 'generator')
    return { w: GENERATOR_W * scale, h: (node.draft.mode === 'video' ? 589 : 429) * scale }
  const body = node.type === 'reference' ? { w: REFERENCE_W, h: REFERENCE_W } : takeBodySize(aspect)
  return { w: body.w * scale, h: body.h * scale + (node.type === 'reference' ? 40 : 2) }
}

export function outPort(node: CanvasNode, aspect: Aspect = '1:1'): Point {
  return {
    x: node.x + nodeSize(node, aspect).w,
    y: inPort(node).y,
  }
}
export function inPort(node: CanvasNode, slot?: 'start' | 'end'): Point {
  return {
    x: node.x,
    y:
      node.y +
      // References now lead the card; ports align with the reference strip and frame rows.
      (slot === 'start' ? 137 : slot === 'end' ? 193 : node.type === 'generator' ? 66 : PORT_Y) *
        cardZoom(node),
  }
}
export function edgePath(from: Point, to: Point): string {
  const dx = Math.max(60, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`
}
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}
export function intersects(a: Bounds, b: Bounds) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
}
export function boundsOf(rects: Bounds[], padding = 0): Bounds | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map((r) => r.x)) - padding
  const y = Math.min(...rects.map((r) => r.y)) - padding
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x + padding,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y + padding,
  }
}
export function resizeScale(origin: number, size: { w: number; h: number }, delta: Point) {
  return clampScale(
    origin * (1 + (delta.x * size.w + delta.y * size.h) / (size.w ** 2 + size.h ** 2)),
  )
}
export function zoomAround(
  view: { x: number; y: number; scale: number },
  point: Point,
  scale: number,
) {
  const next = clampZoom(scale)
  return {
    scale: next,
    x: point.x - ((point.x - view.x) / view.scale) * next,
    y: point.y - ((point.y - view.y) / view.scale) * next,
  }
}

export function viewportBounds(
  view: Point & { scale: number },
  size: { w: number; h: number },
): Bounds {
  return {
    x: -view.x / view.scale,
    y: -view.y / view.scale,
    w: size.w / view.scale,
    h: size.h / view.scale,
  }
}

export function centerViewport(
  view: Point & { scale: number },
  size: { w: number; h: number },
  point: Point,
): Point {
  return { x: size.w / 2 - point.x * view.scale, y: size.h / 2 - point.y * view.scale }
}
