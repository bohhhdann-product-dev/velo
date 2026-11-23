import { boundsOf, type Bounds, type Point } from './geometry'

export interface MapTransform extends Point {
  scale: number
}

export function minimapDefaultVisible(size: { w: number; h: number }) {
  return size.w >= 520 && size.h >= 360
}

// Keep the camera in the map even when it is panned beyond the last node.
export function fitMinimap(
  nodes: Bounds[],
  viewport: Bounds,
  size: { w: number; h: number },
  padding = 12,
): MapTransform {
  const bounds = boundsOf([...nodes, viewport])!
  const scale = Math.min(
    Math.max(1, size.w - padding * 2) / Math.max(1, bounds.w),
    Math.max(1, size.h - padding * 2) / Math.max(1, bounds.h),
  )
  return {
    scale,
    x: size.w / 2 - (bounds.x + bounds.w / 2) * scale,
    y: size.h / 2 - (bounds.y + bounds.h / 2) * scale,
  }
}

export function worldToMinimap(point: Point, map: MapTransform): Point {
  return { x: point.x * map.scale + map.x, y: point.y * map.scale + map.y }
}

export function minimapToWorld(point: Point, map: MapTransform): Point {
  return { x: (point.x - map.x) / map.scale, y: (point.y - map.y) / map.scale }
}

export function minimapRect(rect: Bounds, map: MapTransform): Bounds {
  return { ...worldToMinimap(rect, map), w: rect.w * map.scale, h: rect.h * map.scale }
}
