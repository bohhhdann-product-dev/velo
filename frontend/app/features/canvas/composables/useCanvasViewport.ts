import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  reactive,
  watch,
  watchEffect,
  type Ref,
} from 'vue'
import type { Project } from '~/entities/studio/types'
import {
  GRID,
  boundsOf,
  clampZoom,
  zoomAround,
  viewportBounds,
  centerViewport,
  type Bounds,
  type Point,
} from '~/entities/studio/geometry'

export function useCanvasViewport(
  project: Ref<Project | undefined>,
  container: Ref<HTMLElement | null>,
  layer: Ref<HTMLElement | null>,
  rects: () => Bounds[],
) {
  const view = reactive({ ...(project.value?.viewport ?? { x: 0, y: 0, scale: 1 }) })
  const size = reactive({ w: 0, h: 0 })
  const visibleBounds = computed(() => viewportBounds(view, size))
  function centerOn(point: Point) {
    Object.assign(view, centerViewport(view, size, point))
  }
  const center = (): Point => ({
    x: (container.value?.clientWidth ?? 0) / 2,
    y: (container.value?.clientHeight ?? 0) / 2,
  })
  const screenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = container.value!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const toWorld = (point: Point): Point => ({
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  })
  function zoomAt(point: Point, scale: number) {
    Object.assign(view, zoomAround(view, point, scale))
  }
  function zoomBy(factor: number) {
    zoomAt(center(), view.scale * factor)
  }
  function fit(items = rects(), maxZoom = 1) {
    if (!container.value) return
    const bounds = boundsOf(items, 44)
    if (!bounds) {
      Object.assign(view, { x: 120, y: 100, scale: 1 })
      return
    }
    const { clientWidth: w, clientHeight: h } = container.value
    const scale = clampZoom(Math.min(maxZoom, (w - 96) / bounds.w, (h - 56) / bounds.h))
    Object.assign(view, {
      scale,
      x: 36 + w / 2 - (bounds.x + bounds.w / 2) * scale,
      y: h / 2 - (bounds.y + bounds.h / 2) * scale,
    })
  }
  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) {
      for (
        let el = event.target as HTMLElement | null;
        el && el !== container.value;
        el = el.parentElement
      ) {
        const style = getComputedStyle(el)
        if (
          (el.scrollHeight > el.clientHeight && /auto|scroll/.test(style.overflowY)) ||
          (el.scrollWidth > el.clientWidth && /auto|scroll/.test(style.overflowX))
        )
          return
      }
    }
    event.preventDefault()
    // High-resolution trackpad scroll remains a pan, including fast vertical gestures.
    const discreteWheel =
      event.deltaMode !== 0 ||
      (event.deltaX === 0 && Math.abs(event.deltaY) >= 100 && event.deltaY % 100 === 0)
    if (event.ctrlKey || event.metaKey || discreteWheel) {
      const delta = event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY
      zoomAt(
        screenPoint(event),
        view.scale * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)),
      )
    } else {
      view.x -= event.deltaX
      view.y -= event.deltaY
    }
  }
  watchEffect(() => {
    if (!container.value || !layer.value) return
    layer.value.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
    let size = GRID * view.scale
    while (size < 14) size *= 2
    container.value.style.backgroundSize = `${size}px ${size}px`
    container.value.style.backgroundPosition = `${view.x}px ${view.y}px`
  })
  watch(view, () => {
    if (project.value) project.value.viewport = { ...view }
  })
  let active = true
  let observer: ResizeObserver | undefined
  let previous: { w: number; h: number } | undefined
  onMounted(async () => {
    await nextTick()
    if (!active || !project.value) return
    if (project.value.revision === undefined) fit()
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width: w, height: h } = entry.contentRect
      if (previous) {
        view.x += (w - previous.w) / 2
        view.y += (h - previous.h) / 2
      }
      previous = { w, h }
      Object.assign(size, { w, h })
    })
    if (container.value) observer.observe(container.value)
  })
  onBeforeUnmount(() => {
    active = false
    observer?.disconnect()
  })
  return {
    view,
    paneSize: size,
    visibleBounds,
    centerOn,
    center,
    screenPoint,
    toWorld,
    zoomAt,
    zoomBy,
    fit,
    onWheel,
  }
}
