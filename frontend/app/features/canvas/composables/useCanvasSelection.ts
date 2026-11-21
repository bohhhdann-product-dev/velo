import { computed, shallowRef, watch, type Ref } from 'vue'
import type { CanvasNode, Project } from '~/entities/studio/types'
import { boundsOf, type Bounds } from '~/entities/studio/geometry'

export function useCanvasSelection(
  project: Ref<Project | undefined>,
  nodeRect: (node: CanvasNode) => Bounds,
) {
  // Store clearing runs before Vue unmounts the board during sign-out/deletion.
  const nodes = computed(() => project.value?.nodes ?? [])
  const edges = computed(() => project.value?.edges ?? [])
  const selectedIds = shallowRef(new Set<string>())
  const selectedEdge = shallowRef<string | null>(null)
  const selectedNodes = computed(() => nodes.value.filter((n) => selectedIds.value.has(n.id)))
  const groups = computed(() => {
    const members = new Map<string, CanvasNode[]>()
    nodes.value.forEach((n) => {
      if (n.groupId) members.set(n.groupId, [...(members.get(n.groupId) ?? []), n])
    })
    return [...members]
      .filter(([, nodes]) => nodes.length > 1)
      .map(([id, nodes]) => ({
        id,
        nodes,
        bounds: boundsOf(nodes.map(nodeRect), 20)!,
        selected: nodes.every((n) => selectedIds.value.has(n.id)),
      }))
  })
  function unitOf(id: string) {
    const node = nodes.value.find((n) => n.id === id)
    return node?.groupId
      ? nodes.value.filter((n) => n.groupId === node.groupId).map((n) => n.id)
      : [id]
  }
  function select(ids: string[]) {
    selectedIds.value = new Set(ids)
    selectedEdge.value = null
  }
  function pick(id: string, additive = false) {
    const unit = unitOf(id)
    select(
      additive
        ? unit.every((id) => selectedIds.value.has(id))
          ? [...selectedIds.value].filter((id) => !unit.includes(id))
          : [...new Set([...selectedIds.value, ...unit])]
        : unit,
    )
  }
  watch(
    [
      () => nodes.value.map((n) => n.id).join(','),
      () => edges.value.map((e) => e.id).join(','),
    ],
    () => {
      const exists = new Set(nodes.value.map((n) => n.id))
      if ([...selectedIds.value].some((id) => !exists.has(id)))
        selectedIds.value = new Set([...selectedIds.value].filter((id) => exists.has(id)))
      if (selectedEdge.value && !edges.value.some((e) => e.id === selectedEdge.value))
        selectedEdge.value = null
    },
    { flush: 'sync' },
  )
  return { selectedIds, selectedNodes, selectedEdge, groups, unitOf, select, pick }
}
