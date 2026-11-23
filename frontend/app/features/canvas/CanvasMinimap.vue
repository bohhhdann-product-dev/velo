<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue'
import type { Bounds, Point } from '~/entities/studio/geometry'
import {
  fitMinimap,
  minimapRect,
  minimapToWorld,
  type MapTransform,
} from '~/entities/studio/minimap'

const props = defineProps<{
  nodes: Array<Bounds & { id: string; url?: string; selected: boolean }>
  viewport: Bounds
}>()
const emit = defineEmits<{ navigate: [point: Point]; close: [] }>()
const clipId = useId()
const size = { w: 240, h: 154 }
const drag = shallowRef<{ pointerId: number; map: MapTransform; offset: Point } | null>(null)
// Freeze the projection during a drag, so moving the camera cannot move the map under the pointer.
const map = computed(() => drag.value?.map ?? fitMinimap(props.nodes, props.viewport, size))
const camera = computed(() => minimapRect(props.viewport, map.value))
const items = computed(() =>
  props.nodes.map((node) => ({ ...node, ...minimapRect(node, map.value) })),
)

function pointerWorld(event: PointerEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return minimapToWorld(
    {
      x: ((event.clientX - rect.left) * size.w) / rect.width,
      y: ((event.clientY - rect.top) * size.h) / rect.height,
    },
    map.value,
  )
}
function startPan(event: PointerEvent) {
  if (event.button !== 0 || drag.value) return
  event.preventDefault()
  const point = pointerWorld(event)
  const v = props.viewport
  const inside = point.x >= v.x && point.x <= v.x + v.w && point.y >= v.y && point.y <= v.y + v.h
  drag.value = {
    pointerId: event.pointerId,
    map: map.value,
    offset: inside ? { x: point.x - v.x - v.w / 2, y: point.y - v.y - v.h / 2 } : { x: 0, y: 0 },
  }
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  if (!inside) movePan(event)
}
function movePan(event: PointerEvent) {
  if (event.pointerId !== drag.value?.pointerId) return
  const point = pointerWorld(event)
  emit('navigate', { x: point.x - drag.value.offset.x, y: point.y - drag.value.offset.y })
}
function endPan(event: PointerEvent) {
  if (event.pointerId !== drag.value?.pointerId) return
  drag.value = null
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}
function onKeyDown(event: KeyboardEvent) {
  const direction: Record<string, Point> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  }
  const step = direction[event.key]
  if (!step) return
  event.preventDefault()
  const v = props.viewport
  const factor = event.shiftKey ? 0.5 : 0.15
  emit('navigate', {
    x: v.x + v.w / 2 + step.x * v.w * factor,
    y: v.y + v.h / 2 + step.y * v.h * factor,
  })
}
</script>

<template>
  <div
    class="canvas-minimap"
    :class="{ 'is-panning': drag }"
    data-canvas-ui
    data-canvas-minimap
    role="group"
    aria-label="Canvas minimap"
    tabindex="0"
    @pointerdown.stop="startPan"
    @pointermove.stop="movePan"
    @pointerup.stop="endPan"
    @pointercancel.stop="endPan"
    @lostpointercapture="endPan"
    @wheel.stop.prevent
    @keydown.stop="onKeyDown"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <svg :viewBox="`0 0 ${size.w} ${size.h}`" aria-hidden="true">
      <defs>
        <clipPath v-for="(node, index) in items" :id="`${clipId}-${index}`" :key="node.id">
          <rect :x="node.x" :y="node.y" :width="node.w" :height="node.h" rx="1.5" />
        </clipPath>
      </defs>
      <g v-for="(node, index) in items" :key="node.id">
        <rect
          :x="node.x"
          :y="node.y"
          :width="node.w"
          :height="node.h"
          rx="1.5"
          class="minimap-node"
        />
        <image
          v-if="node.url"
          :href="node.url"
          :x="node.x"
          :y="node.y"
          :width="node.w"
          :height="node.h"
          preserveAspectRatio="xMidYMid slice"
          :clip-path="`url(#${clipId}-${index})`"
        />
        <path
          v-else
          :d="`M ${node.x + node.w * 0.18} ${node.y + node.h * 0.22} h ${node.w * 0.64} m ${-node.w * 0.64} ${node.h * 0.16} h ${node.w * 0.45}`"
          class="minimap-node-detail"
        />
        <rect
          v-if="node.selected"
          :x="node.x"
          :y="node.y"
          :width="node.w"
          :height="node.h"
          rx="1.5"
          class="minimap-selected"
        />
      </g>
      <path
        :d="`M 0 0 H ${size.w} V ${size.h} H 0 Z M ${camera.x} ${camera.y} v ${camera.h} h ${camera.w} v ${-camera.h} Z`"
        fill-rule="evenodd"
        class="minimap-shade"
      />
      <rect
        :x="camera.x"
        :y="camera.y"
        :width="camera.w"
        :height="camera.h"
        class="minimap-viewport"
      />
    </svg>
  </div>
</template>

<style scoped>
.canvas-minimap {
  position: absolute;
  right: 18px;
  bottom: 66px;
  /* Reserve the left tool rail and a gap even when the map is opened on a phone. */
  width: min(240px, calc(100% - 96px));
  aspect-ratio: 240 / 154;
  overflow: hidden;
  border: 1px solid #ffffff1c;
  border-radius: 16px;
  background: #1a1c1d;
  box-shadow: 0 8px 24px #0004;
  z-index: 34;
  cursor: grab;
  touch-action: none;
}
.canvas-minimap.is-panning {
  cursor: grabbing;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.minimap-node {
  fill: #424647;
  stroke: #ffffff20;
  stroke-width: 0.75;
}
.minimap-node-detail {
  fill: none;
  stroke: #969c9b;
  stroke-width: 1;
}
.minimap-selected {
  fill: none;
  stroke: #a7c4b0;
  stroke-width: 1;
}
.minimap-shade {
  fill: #000;
  opacity: 0.3;
}
.minimap-viewport {
  fill: #a7c4b008;
  stroke: #a7c4b0;
  stroke-width: 1.5;
}
</style>
