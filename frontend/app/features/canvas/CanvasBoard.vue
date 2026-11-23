<script setup lang="ts">
import {
  Frame,
  MousePointer2,
  Hand,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Group,
  Ungroup,
  Copy,
  Trash2,
  Scissors,
  Keyboard,
  Map as MapIcon,
  X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import NodePalette from './NodePalette.vue'
import EdgeLayer from './EdgeLayer.vue'
import GeneratorNode from './GeneratorNode.vue'
import ReferenceNode from './ReferenceNode.vue'
import TakeNode from './TakeNode.vue'
import CanvasMinimap from './CanvasMinimap.vue'
import { useCanvasViewport } from './composables/useCanvasViewport'
import { useCanvasSelection } from './composables/useCanvasSelection'
import type { CanvasNode, Mode } from '~/entities/studio/types'
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampScale,
  nodeSize,
  outPort,
  intersects,
  resizeScale,
  type Point,
  type Bounds,
} from '~/entities/studio/geometry'
import { useStudioStore } from '~/stores/studio'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{
  pickReference: [generatorId: string | null, point?: Point, slot?: 'start' | 'end']
  openTake: [takeId: string]
}>()
const studio = useStudioStore()
const project = computed(() => studio.project(props.projectId)!)
const container = ref<HTMLElement | null>(null)
const layer = ref<HTMLElement | null>(null)
const nodeElements = new Map<string, HTMLElement>()
function aspect(node: CanvasNode) {
  return node.type === 'take'
    ? studio.findTake(node.takeId)?.generation.draft.aspect
    : undefined
}
function nodeRect(node: CanvasNode): Bounds {
  const card = nodeElements.get(node.id)?.querySelector<HTMLElement>('[data-node]')
  const size = card?.getBoundingClientRect()
  return {
    x: node.x,
    y: node.y - 34,
    w: size ? size.width / view.scale : nodeSize(node, aspect(node)).w,
    h: (size ? size.height / view.scale : nodeSize(node, aspect(node)).h) + 34,
  }
}
const {
  view,
  visibleBounds,
  centerOn,
  center,
  screenPoint,
  toWorld,
  zoomAt,
  zoomBy,
  fit,
  onWheel,
} = useCanvasViewport(project, container, layer, () => project.value?.nodes.map(nodeRect) ?? [])
const { selectedIds, selectedNodes, selectedEdge, groups, unitOf, select, pick } =
  useCanvasSelection(project, (node) => {
    const size = nodeSize(node, aspect(node))
    return { x: node.x, y: node.y - 34, w: size.w, h: size.h + 34 }
  })
const tool = shallowRef<'select' | 'pan'>('select')
const spaceDown = shallowRef(false)
const zoomMenu = shallowRef(false)
const shortcuts = shallowRef(false)
const minimapOpen = shallowRef(false)
const minimapToggle = ref<HTMLButtonElement | null>(null)
const minimapId = useId()
const minimapNodes = computed(() =>
  (project.value?.nodes ?? []).map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    ...nodeSize(node, aspect(node)),
    url: studio.sourceMedia(props.projectId, node.id)?.url,
    selected: selectedIds.value.has(node.id),
  })),
)
const grouped = computed(() => selectedNodes.value.some((n) => n.groupId))
const palette = ref<{
  x: number
  y: number
  world: Point
  sourceId?: string
  sourceMode?: Mode
} | null>(null)
const popover = ref<HTMLElement | null>(null)
const marquee = ref<Bounds | null>(null)
const tempEdge = ref<{ from: Point; to: Point } | null>(null)
const hoverEdge = ref<{ id: string; x: number; y: number } | null>(null)
let edgeLeaveTimer: ReturnType<typeof setTimeout> | undefined

async function showPalette(point: Point, sourceId?: string, world?: Point) {
  zoomMenu.value = false
  const source = project.value.nodes.find((n) => n.id === sourceId)
  palette.value = {
    ...point,
    world: world ?? toWorld(point),
    sourceId,
    sourceMode:
      source?.type === 'take' ? studio.findTake(source.takeId)?.generation.draft.mode : 'image',
  }
  await nextTick()
  const panel = popover.value
  if (!panel || !palette.value || !container.value) return
  palette.value.x = Math.max(
    10,
    Math.min(point.x, container.value.clientWidth - panel.offsetWidth - 10),
  )
  palette.value.y = Math.max(
    10,
    Math.min(point.y, container.value.clientHeight - panel.offsetHeight - 10),
  )
}
function openPalette(event?: MouseEvent) {
  if (event && (event.target as HTMLElement).closest('[data-node-wrapper], [data-canvas-ui]'))
    return
  if (event?.ctrlKey) return
  showPalette(event ? screenPoint(event) : center())
}
function continueNode(node: CanvasNode, point?: Point, world?: Point) {
  const port = outPort(node, aspect(node))
  showPalette(
    point ?? { x: view.x + port.x * view.scale + 16, y: view.y + port.y * view.scale - 20 },
    node.id,
    world,
  )
}
function closePalette(focus = true) {
  palette.value = null
  if (focus) container.value?.focus({ preventScroll: true })
}
async function insert(kind: Mode | 'reference') {
  const current = palette.value
  if (!current) return
  closePalette()
  if (kind === 'reference') {
    emit('pickReference', null, current.world)
    return
  }
  const node = current.sourceId
    ? studio.continueFrom(props.projectId, current.sourceId, kind)
    : studio.addGeneratorNode(props.projectId, current.world.x, current.world.y, kind)
  if (!node) return
  select([node.id])
  await nextTick()
  fit([nodeRect(node)], 1)
  nodeElements
    .get(node.id)
    ?.querySelector<HTMLTextAreaElement>('textarea')
    ?.focus({ preventScroll: true })
}
function focusNodes(ids: string[]) {
  select(ids)
  nextTick(() => fit(selectedNodes.value.map(nodeRect), 1))
}
defineExpose({ fit, focusNodes })

// Only eligible gestures capture the pointer; native controls retain focus and clicks.
type Gesture = { start: Point; moved: boolean } & (
  | { kind: 'pan'; origin: Point }
  | { kind: 'drag'; origins: Map<string, Point>; titleTarget: HTMLElement | null }
  | { kind: 'resize'; id: string; scale: number; size: { w: number; h: number } }
  | { kind: 'connect'; fromId: string }
  | { kind: 'marquee'; origin: Point; initial: string[] }
)
const gesture = shallowRef<Gesture | null>(null)
function onPointerDown(event: PointerEvent) {
  if (!studio.project(props.projectId)) return
  if (event.button !== 0 && event.button !== 1) return
  const target = event.target as HTMLElement
  if (target.closest('[data-canvas-ui], [data-canvas-popover]')) return
  closePalette(false)
  zoomMenu.value = false
  const start = { x: event.clientX, y: event.clientY }
  const wrapper = target.closest<HTMLElement>('[data-node-wrapper]')
  const node = project.value.nodes.find((n) => n.id === wrapper?.dataset.id)
  const port = target.closest<HTMLElement>('[data-port="out"]')
  if (spaceDown.value || event.button === 1 || tool.value === 'pan') {
    event.preventDefault()
    gesture.value = { kind: 'pan', start, origin: { x: view.x, y: view.y }, moved: false }
  } else if (port && node && studio.sourceMedia(props.projectId, node.id)) {
    event.preventDefault()
    gesture.value = { kind: 'connect', fromId: node.id, start, moved: false }
  } else if (node && target.closest('[data-resize]')) {
    event.preventDefault()
    select(unitOf(node.id))
    const rect = nodeRect(node)
    gesture.value = {
      kind: 'resize',
      id: node.id,
      start,
      scale: node.scale ?? 1,
      size: { w: rect.w, h: rect.h - 34 },
      moved: false,
    }
  } else if (target.closest('button, input, textarea, a, [contenteditable], [role="slider"]'))
    return
  else if (node) {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      pick(node.id, true)
      container.value?.focus({ preventScroll: true })
      return
    }
    if (!selectedIds.value.has(node.id)) pick(node.id)
    gesture.value = {
      kind: 'drag',
      titleTarget: target.closest<HTMLElement>('[data-node-title]'),
      start,
      moved: false,
      origins: new Map(selectedNodes.value.map((n) => [n.id, { x: n.x, y: n.y }])),
    }
  } else if (event.ctrlKey || event.metaKey || event.shiftKey) {
    event.preventDefault()
    gesture.value = {
      kind: 'marquee',
      start,
      origin: toWorld(screenPoint(event)),
      initial: [...selectedIds.value],
      moved: false,
    }
  } else {
    select([])
    gesture.value = {
      kind: 'marquee',
      start,
      origin: toWorld(screenPoint(event)),
      initial: [],
      moved: false,
    }
  }
  event.preventDefault()
  container.value?.focus({ preventScroll: true })
  try {
    container.value?.setPointerCapture(event.pointerId)
  } catch {
    /* Pointer may already be cancelled. */
  }
}
function onPointerMove(event: PointerEvent) {
  if (!studio.project(props.projectId)) {
    cancelGesture()
    return
  }
  const active = gesture.value
  if (!active) return
  const delta = { x: event.clientX - active.start.x, y: event.clientY - active.start.y }
  if (!active.moved && Math.hypot(delta.x, delta.y) < 3) return
  if (!active.moved && (active.kind === 'drag' || active.kind === 'resize'))
    studio.checkpoint(props.projectId)
  active.moved = true
  const worldDelta = { x: delta.x / view.scale, y: delta.y / view.scale }
  if (active.kind === 'pan') {
    view.x = active.origin.x + delta.x
    view.y = active.origin.y + delta.y
  } else if (active.kind === 'drag')
    active.origins.forEach((origin, id) =>
      studio.moveNode(props.projectId, id, origin.x + worldDelta.x, origin.y + worldDelta.y),
    )
  else if (active.kind === 'resize') {
    const node = project.value.nodes.find((n) => n.id === active.id)
    if (node) node.scale = resizeScale(active.scale, active.size, worldDelta)
  } else if (active.kind === 'connect') {
    const node = project.value.nodes.find((n) => n.id === active.fromId)!
    tempEdge.value = { from: outPort(node, aspect(node)), to: toWorld(screenPoint(event)) }
  } else if (active.kind === 'marquee') {
    const point = toWorld(screenPoint(event)),
      origin = active.origin
    marquee.value = {
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      w: Math.abs(point.x - origin.x),
      h: Math.abs(point.y - origin.y),
    }
    select([
      ...new Set([
        ...active.initial,
        ...project.value.nodes
          .filter((n) => intersects(marquee.value!, nodeRect(n)))
          .flatMap((n) => unitOf(n.id)),
      ]),
    ])
  }
}
function cancelGesture() {
  gesture.value = null
  tempEdge.value = null
  marquee.value = null
  spaceDown.value = false
}
function onPointerUp(event: PointerEvent) {
  const active = gesture.value
  gesture.value = null
  tempEdge.value = null
  marquee.value = null
  if (container.value?.hasPointerCapture(event.pointerId))
    container.value.releasePointerCapture(event.pointerId)
  // Title presses share the node drag gesture: a stationary release edits;
  // dragging moves the node and never enters the name field.
  if (active?.kind === 'drag' && active.titleTarget) {
    const title = active.titleTarget
    if (active.moved) {
      // The browser still dispatches click after pointerup when the moved title
      // ends under the pointer. Suppress only that event, not later activation.
      title.dataset.suppressRename = 'true'
      setTimeout(() => {
        delete title.dataset.suppressRename
      }, 0)
    } else title.click()
  }
  if (active?.kind !== 'connect' || !studio.project(props.projectId)) return
  const node = project.value.nodes.find((n) => n.id === active.fromId)
  if (!node) return
  const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const drop = target?.closest<HTMLElement>('[data-port="in"]')
  if (active.moved && drop?.dataset.nodeId) {
    const slot = drop.dataset.slot as 'start' | 'end' | undefined
    const error = studio.connectionError(props.projectId, node.id, drop.dataset.nodeId, slot)
    if (error) toast.error(error)
    else studio.connect(props.projectId, node.id, drop.dataset.nodeId, slot)
  } else if (
    !active.moved ||
    (container.value?.contains(target) &&
      !target?.closest('[data-node-wrapper], [data-canvas-ui]'))
  ) {
    continueNode(node, active.moved ? screenPoint(event) : undefined)
  }
}
function resizeStep(node: CanvasNode, delta: number) {
  const scale = clampScale((node.scale ?? 1) + delta)
  if (scale !== node.scale) {
    studio.checkpoint(props.projectId)
    node.scale = scale
  }
}
function removeSelection() {
  if (selectedEdge.value) studio.disconnect(props.projectId, selectedEdge.value)
  else studio.removeNodes(props.projectId, [...selectedIds.value])
  select([])
  hoverEdge.value = null
}
function groupSelection(ungroup = false) {
  select(studio.groupNodes(props.projectId, [...selectedIds.value], ungroup))
}
function duplicate() {
  if (!selectedNodes.value.length) return
  const point = {
    x: Math.min(...selectedNodes.value.map((n) => n.x)) + 36,
    y: Math.min(...selectedNodes.value.map((n) => n.y)) + 36,
  }
  select(
    studio
      .pasteNodes(
        props.projectId,
        studio.copyNodes(props.projectId, [...selectedIds.value]),
        point,
      )
      .map((n) => n.id),
  )
}
function hoverWire(id: string, event: PointerEvent) {
  clearTimeout(edgeLeaveTimer)
  const point = screenPoint(event)
  hoverEdge.value = { id, ...point }
}
function keepWire() {
  clearTimeout(edgeLeaveTimer)
}
function leaveWire() {
  edgeLeaveTimer = setTimeout(() => {
    hoverEdge.value = null
  }, 160)
}
function disconnectWire(id: string) {
  studio.disconnect(props.projectId, id)
  hoverEdge.value = null
}
function cutWire() {
  if (hoverEdge.value) studio.disconnect(props.projectId, hoverEdge.value.id)
  hoverEdge.value = null
}
function toggleShortcuts() {
  shortcuts.value = !shortcuts.value
  zoomMenu.value = false
}
function toggleZoomMenu() {
  zoomMenu.value = !zoomMenu.value
  shortcuts.value = false
}
function toggleMinimap() {
  minimapOpen.value = !minimapOpen.value || zoomMenu.value || shortcuts.value
  zoomMenu.value = false
  shortcuts.value = false
}
function closeMinimap() {
  minimapOpen.value = false
  minimapToggle.value?.focus({ preventScroll: true })
}
function zoomAction(action: 'reset' | 'all' | 'selection') {
  if (action === 'reset') zoomAt(center(), 1)
  else fit(action === 'selection' ? selectedNodes.value.map(nodeRect) : undefined)
  zoomMenu.value = false
}
async function run(id: string) {
  try {
    const result = await studio.generateFromNodeAsync(props.projectId, id)
    if (result && !result.ok) { toast.error(result.error); return }
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not submit generation.')
    return
  }
  await nextTick()
  if (!studio.project(props.projectId)) return
  const ids = new Set([
    id,
    ...project.value.edges.filter((e) => e.from === id).map((e) => e.to),
  ])
  fit(project.value.nodes.filter((n) => ids.has(n.id)).map(nodeRect), Math.min(1, view.scale))
}

// Window shortcuts remain active after using the toolbar; editors and dialogs own their keys.
function isEditing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"], [data-canvas-popover], [data-canvas-minimap]',
    )
  )
}
function keyDown(event: KeyboardEvent) {
  if (!studio.project(props.projectId)) return
  if (document.querySelector('[data-state="open"][role="dialog"]')) return
  if (event.key === 'Escape' && !isEditing(event.target)) {
    closePalette()
    zoomMenu.value = false
    shortcuts.value = false
    cancelGesture()
    select([])
    return
  }
  const mod = event.ctrlKey || event.metaKey
  if (mod && ['Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0'].includes(event.code)) {
    event.preventDefault()
    if (event.code === 'Digit0') zoomAt(center(), 1)
    else zoomBy(['Equal', 'NumpadAdd'].includes(event.code) ? 1.2 : 1 / 1.2)
    return
  }
  if (isEditing(event.target)) return
  if (mod) {
    if (event.code === 'KeyZ') {
      event.preventDefault()
      studio.travel(props.projectId, event.shiftKey ? 'future' : 'past')
    }
    if (event.code === 'KeyY') {
      event.preventDefault()
      studio.travel(props.projectId, 'future')
    }
    if (event.code === 'KeyA') {
      event.preventDefault()
      select(project.value.nodes.map((n) => n.id))
    }
    if (event.code === 'KeyG') {
      event.preventDefault()
      groupSelection(event.shiftKey)
    }
    if (event.code === 'KeyD') {
      event.preventDefault()
      duplicate()
    }
    return
  }
  if (event.altKey) return
  if (event.shiftKey && event.code === 'Digit1') {
    event.preventDefault()
    fit()
    return
  }
  if (event.shiftKey && event.code === 'Digit2') {
    event.preventDefault()
    if (selectedNodes.value.length) fit(selectedNodes.value.map(nodeRect))
    return
  }
  if (event.code === 'KeyN') {
    event.preventDefault()
    openPalette()
  }
  if (event.code === 'KeyV') tool.value = 'select'
  if (event.code === 'KeyH') tool.value = 'pan'
  if (
    event.code === 'Space' &&
    !(event.target instanceof Element && event.target.closest('button'))
  ) {
    event.preventDefault()
    spaceDown.value = true
  }
  if (event.code === 'Delete' || event.code === 'Backspace') {
    event.preventDefault()
    removeSelection()
  }
  if (event.key === '?') {
    event.preventDefault()
    shortcuts.value = !shortcuts.value
  }
  if (
    event.code.startsWith('Arrow') &&
    selectedNodes.value.length &&
    event.target === container.value
  ) {
    event.preventDefault()
    studio.checkpoint(props.projectId)
    const step = event.shiftKey ? 10 : 1
    selectedNodes.value.forEach((n) =>
      studio.moveNode(
        props.projectId,
        n.id,
        n.x + (event.code === 'ArrowRight' ? step : event.code === 'ArrowLeft' ? -step : 0),
        n.y + (event.code === 'ArrowDown' ? step : event.code === 'ArrowUp' ? -step : 0),
      ),
    )
  }
}
function keyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceDown.value = false
}
const clipboardMime = 'application/x-vela-nodes'
function onCopy(event: ClipboardEvent) {
  if (
    isEditing(event.target) ||
    !selectedNodes.value.length ||
    window.getSelection()?.toString()
  )
    return
  event.clipboardData?.setData(
    clipboardMime,
    studio.copyNodes(props.projectId, [...selectedIds.value]),
  )
  event.preventDefault()
  if (event.type === 'cut') removeSelection()
}
function onPaste(event: ClipboardEvent) {
  if (isEditing(event.target)) return
  const content = event.clipboardData?.getData(clipboardMime)
  if (!content) return
  event.preventDefault()
  select(studio.pasteNodes(props.projectId, content, toWorld(center())).map((n) => n.id))
}
function outside(event: PointerEvent) {
  if (!(event.target instanceof Element)) return
  if (!event.target.closest('[data-canvas-popover], .zoom-rail')) {
    closePalette(false)
    zoomMenu.value = false
    shortcuts.value = false
  }
}
onMounted(() => {
  window.addEventListener('keydown', keyDown, true)
  window.addEventListener('keyup', keyUp)
  window.addEventListener('blur', cancelGesture)
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('copy', onCopy)
  document.addEventListener('cut', onCopy)
  document.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyDown, true)
  window.removeEventListener('keyup', keyUp)
  window.removeEventListener('blur', cancelGesture)
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('copy', onCopy)
  document.removeEventListener('cut', onCopy)
  document.removeEventListener('paste', onPaste)
  clearTimeout(edgeLeaveTimer)
})
</script>

<template>
  <div
    v-if="studio.project(projectId)"
    ref="container"
    class="vela-board relative size-full touch-none overflow-clip outline-none"
    :class="{
      'cursor-grab': tool === 'pan' || spaceDown,
      'cursor-grabbing': gesture?.kind === 'pan',
      'is-connecting': gesture?.kind === 'connect',
    }"
    tabindex="0"
    aria-label="Creative canvas"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="cancelGesture"
    @contextmenu.prevent="openPalette"
    @wheel="onWheel"
  >
    <div class="canvas-context">
      <span class="status-dot" /> Creative canvas
      <span class="canvas-context-count">{{ project.nodes.length }} nodes</span>
    </div>
    <div ref="layer" class="absolute left-0 top-0 origin-top-left">
      <div
        v-for="group in groups"
        :key="group.id"
        class="canvas-group"
        :class="{ selected: group.selected }"
        :style="{
          left: `${group.bounds.x}px`,
          top: `${group.bounds.y}px`,
          width: `${group.bounds.w}px`,
          height: `${group.bounds.h}px`,
        }"
      >
        <span>Group · {{ group.nodes.length }}</span>
      </div>
      <EdgeLayer
        :project="project"
        :selected-edge-id="selectedEdge"
        :hovered-edge-id="hoverEdge?.id"
        :temp-edge="tempEdge"
        @select-edge="
          (id) => {
            if (hoverEdge?.id === id) cutWire()
            else {
              select([])
              selectedEdge = id
              container?.focus()
            }
          }
        "
        @disconnect-edge="disconnectWire"
        @hover-edge="hoverWire"
        @leave-edge="leaveWire"
      />
      <div
        v-for="node in project.nodes"
        :key="node.id"
        :ref="
          (el) => {
            if (el) nodeElements.set(node.id, el as HTMLElement)
            else nodeElements.delete(node.id)
          }
        "
        class="absolute"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          zIndex: selectedIds.has(node.id) ? 2 : 1,
        }"
        data-node-wrapper
        :data-id="node.id"
      >
        <GeneratorNode
          v-if="node.type === 'generator'"
          :node="node"
          :project-id="projectId"
          :selected="selectedIds.has(node.id)"
          @remove="studio.removeNode(projectId, node.id)"
          @rename="studio.renameNode(projectId, node.id, $event)"
          @resize-step="resizeStep(node, $event)"
          @run="run(node.id)"
          @pick-reference="(slot) => emit('pickReference', node.id, undefined, slot)"
        />
        <ReferenceNode
          v-else-if="node.type === 'reference'"
          :node="node"
          :selected="selectedIds.has(node.id)"
          @remove="studio.removeNode(projectId, node.id)"
          @rename="studio.renameNode(projectId, node.id, $event)"
          @resize-step="resizeStep(node, $event)"
          @continue="continueNode(node)"
        />
        <TakeNode
          v-else
          :node="node"
          :selected="selectedIds.has(node.id)"
          @remove="studio.removeNode(projectId, node.id)"
          @rename="studio.renameNode(projectId, node.id, $event)"
          @resize-step="resizeStep(node, $event)"
          @open="emit('openTake', node.takeId)"
          @continue="continueNode(node)"
        />
      </div>
      <div
        v-if="marquee"
        class="selection-marquee"
        :style="{
          left: `${marquee.x}px`,
          top: `${marquee.y}px`,
          width: `${marquee.w}px`,
          height: `${marquee.h}px`,
          borderWidth: `${1 / view.scale}px`,
        }"
      />
    </div>
    <div class="tool-rail" data-canvas-ui @pointerdown.stop>
      <button title="Add node (N)" aria-label="Add node" @click="openPalette()">
        <Plus class="size-4" />
      </button>
      <button
        title="Select (V) · Drag an area · Ctrl/⌘ adds to selection"
        aria-label="Select"
        :aria-pressed="tool === 'select'"
        :class="{ 'rail-active': tool === 'select' }"
        @click="tool = 'select'"
      >
        <MousePointer2 class="size-4" />
      </button>
      <button
        title="Pan (H or Space)"
        aria-label="Pan"
        :aria-pressed="tool === 'pan'"
        :class="{ 'rail-active': tool === 'pan' }"
        @click="tool = 'pan'"
      >
        <Hand class="size-4" />
      </button>
      <div class="my-1 border-t border-line" />
      <button
        title="Undo (Ctrl/⌘Z)"
        aria-label="Undo"
        :disabled="!studio.history[projectId]?.past.length"
        @click="studio.travel(projectId, 'past')"
      >
        <Undo2 class="size-4" />
      </button>
      <button
        title="Redo (Ctrl/⌘⇧Z)"
        aria-label="Redo"
        :disabled="!studio.history[projectId]?.future.length"
        @click="studio.travel(projectId, 'future')"
      >
        <Redo2 class="size-4" />
      </button>
    </div>
    <div
      v-if="selectedNodes.length > 1 || selectedEdge"
      class="selection-toolbar"
      data-canvas-ui
      @pointerdown.stop
    >
      <span>{{ selectedEdge ? 'Connection' : `${selectedNodes.length} selected` }}</span>
      <template v-if="!selectedEdge">
        <button v-if="!grouped" title="Group (Ctrl/⌘G)" @click="groupSelection()">
          <Group class="size-3.5" /> Group
        </button>
        <button v-else title="Ungroup (Ctrl/⌘⇧G)" @click="groupSelection(true)">
          <Ungroup class="size-3.5" /> Ungroup
        </button>
        <button
          title="Duplicate (Ctrl/⌘D)"
          aria-label="Duplicate selected nodes"
          @click="duplicate"
        >
          <Copy class="size-3.5" />
        </button>
      </template>
      <button title="Delete selection" aria-label="Delete selection" @click="removeSelection">
        <Trash2 class="size-3.5" />
      </button>
    </div>
    <Transition name="wire-control">
      <button
        v-if="hoverEdge && !gesture"
        class="wire-cut"
        data-canvas-ui
        :style="{ left: `${hoverEdge.x - 16}px`, top: `${hoverEdge.y - 13}px` }"
        aria-label="Disconnect nodes"
        title="Disconnect"
        @pointerenter="keepWire"
        @pointerleave="leaveWire"
        @pointerdown.stop
        @click="cutWire"
      >
        <Scissors class="size-3.5" />
      </button>
    </Transition>
    <div
      v-if="palette"
      ref="popover"
      class="canvas-popover"
      :style="{ left: `${palette.x}px`, top: `${palette.y}px` }"
    >
      <NodePalette
        :key="palette.sourceId ?? 'add'"
        :continuation="!!palette.sourceId"
        :source-mode="palette.sourceMode"
        @insert="insert"
        @close="closePalette"
      />
    </div>
    <CanvasMinimap
      v-if="minimapOpen && !zoomMenu && !shortcuts"
      :id="minimapId"
      :nodes="minimapNodes"
      :viewport="visibleBounds"
      @navigate="centerOn"
      @close="closeMinimap"
    />
    <div class="zoom-rail" data-canvas-ui @pointerdown.stop>
      <button
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        @click="toggleShortcuts"
      >
        <Keyboard class="size-3.5" />
      </button>
      <button
        ref="minimapToggle"
        aria-label="Toggle minimap"
        title="Minimap"
        :class="{ active: minimapOpen && !zoomMenu && !shortcuts }"
        :aria-expanded="minimapOpen && !zoomMenu && !shortcuts"
        :aria-controls="minimapId"
        @click="toggleMinimap"
      >
        <MapIcon class="size-4" />
      </button>
      <i />
      <button
        aria-label="Zoom out"
        title="Zoom out (Ctrl/⌘−)"
        :disabled="view.scale <= ZOOM_MIN"
        @click="zoomBy(1 / 1.2)"
      >
        <Minus class="size-3.5" />
      </button>
      <button
        class="zoom-percent"
        :aria-label="`Zoom ${Math.round(view.scale * 100)}% · Zoom options`"
        :aria-expanded="zoomMenu"
        @click="toggleZoomMenu"
      >
        {{ Math.round(view.scale * 100) }}%
      </button>
      <button
        aria-label="Zoom in"
        title="Zoom in (Ctrl/⌘+)"
        :disabled="view.scale >= ZOOM_MAX"
        @click="zoomBy(1.2)"
      >
        <Plus class="size-3.5" />
      </button>
      <button aria-label="Fit all nodes" title="Fit all (Shift 1)" @click="fit()">
        <Frame class="size-3.5" />
      </button>
      <div v-if="zoomMenu" class="canvas-small-menu" data-canvas-popover>
        <button @click="zoomAction('reset')">Actual size <kbd>⌘0</kbd></button>
        <button @click="zoomAction('all')">Fit all <kbd>⇧1</kbd></button>
        <button :disabled="!selectedNodes.length" @click="zoomAction('selection')">
          Fit selection <kbd>⇧2</kbd>
        </button>
      </div>
      <div v-if="shortcuts" class="shortcut-panel" data-canvas-popover>
        <div>
          <strong>Canvas shortcuts</strong
          ><button aria-label="Close shortcuts" @click="shortcuts = false">
            <X class="size-3.5" />
          </button>
        </div>
        <p><span>Add node</span><kbd>N</kbd></p>
        <p><span>Select / Pan</span><kbd>V / H</kbd></p>
        <p><span>Select an area</span><kbd>Drag</kbd></p>
        <p><span>Add an area</span><kbd>Ctrl/⌘ + drag</kbd></p>
        <p><span>Add to selection</span><kbd>⇧ + click</kbd></p>
        <p><span>Group / Ungroup</span><kbd>⌘G / ⌘⇧G</kbd></p>
        <p><span>Copy / Paste / Duplicate</span><kbd>⌘C / ⌘V / ⌘D</kbd></p>
        <p><span>Undo / Redo</span><kbd>⌘Z / ⌘⇧Z</kbd></p>
        <p><span>Zoom in / out / reset</span><kbd>⌘+ / ⌘− / ⌘0</kbd></p>
        <p><span>Fit all / selection</span><kbd>⇧1 / ⇧2</kbd></p>
        <p><span>Delete selected</span><kbd>⌫</kbd></p>
        <small>Use Ctrl in place of ⌘ on Windows.</small>
      </div>
    </div>
  </div>
</template>
