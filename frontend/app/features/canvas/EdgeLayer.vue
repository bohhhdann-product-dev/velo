<script setup lang="ts">
import type { Project } from '~/entities/studio/types'
import { edgePath, inPort, outPort } from '~/entities/studio/geometry'
import { useStudioStore } from '~/stores/studio'

const props = defineProps<{
  project: Project
  hoveredEdgeId?: string
  selectedEdgeId: string | null
  tempEdge: {
    from: { x: number; y: number }
    to: { x: number; y: number }
  } | null
}>()

const emit = defineEmits<{
  selectEdge: [id: string]
  disconnectEdge: [id: string]
  hoverEdge: [id: string, event: PointerEvent]
  leaveEdge: []
}>()

let pointerStart = { x: 0, y: 0 }
function start(event: PointerEvent) {
  pointerStart = { x: event.clientX, y: event.clientY }
}
function clickEdge(id: string, event: MouseEvent) {
  if (
    event.detail &&
    Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
  )
    return
  emit('disconnectEdge', id)
}
const studio = useStudioStore()

function aspectOf(nodeId: string) {
  const node = props.project.nodes.find((n) => n.id === nodeId)
  if (node?.type === 'take') {
    const found = studio.findTake(node.takeId)
    return found?.generation.draft.aspect ?? '1:1'
  }
  return '1:1'
}

const edges = computed(() =>
  props.project.edges.flatMap((edge) => {
    const from = props.project.nodes.find((n) => n.id === edge.from)
    const to = props.project.nodes.find((n) => n.id === edge.to)
    if (!from || !to) return []
    return [
      {
        id: edge.id,
        path: edgePath(outPort(from, aspectOf(from.id)), inPort(to, edge.slot)),
        accent: to.type === 'take',
      },
    ]
  }),
)
</script>

<template>
  <svg class="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
    <g v-for="edge in edges" :key="edge.id">
      <!-- invisible hit area -->
      <path
        :d="edge.path"
        fill="none"
        stroke="transparent"
        stroke-width="18"
        vector-effect="non-scaling-stroke"
        class="wire-hit pointer-events-auto cursor-pointer"
        @pointerdown.stop="start"
        @pointermove="$emit('hoverEdge', edge.id, $event)"
        @pointerleave="$emit('leaveEdge')"
        role="button"
        tabindex="0"
        aria-label="Disconnect connection"
        @click.stop="clickEdge(edge.id, $event)"
        @keydown.enter.stop.prevent="$emit('disconnectEdge', edge.id)"
        @keydown.space.stop.prevent="$emit('disconnectEdge', edge.id)"
      />
      <path
        :d="edge.path"
        fill="none"
        :stroke="
          hoveredEdgeId === edge.id
            ? '#a2c4ad'
            : edge.accent
              ? 'var(--edge-output)'
              : 'var(--edge-input)'
        "
        :stroke-width="hoveredEdgeId === edge.id ? 3.5 : selectedEdgeId === edge.id ? 2.5 : 1.5"
        class="wire-path"
        :opacity="selectedEdgeId === edge.id || hoveredEdgeId === edge.id ? 1 : 0.7"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </g>
    <path
      v-if="tempEdge"
      :d="edgePath(tempEdge.from, tempEdge.to)"
      fill="none"
      stroke="var(--accent)"
      stroke-width="2.5"
      stroke-dasharray="6 6"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.wire-hit {
  outline: none;
}
.wire-hit:focus-visible {
  stroke: #a2c4ad;
  stroke-width: 3.5;
}

.wire-path {
  transition:
    stroke-width 160ms ease,
    opacity 160ms ease;
}
@media (prefers-reduced-motion: reduce) {
  .wire-path {
    transition: none;
  }
}
</style>
