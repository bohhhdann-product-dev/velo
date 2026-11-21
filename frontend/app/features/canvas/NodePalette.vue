<script setup lang="ts">
import { Image, Clapperboard, Paperclip, Search, ArrowUpRight } from 'lucide-vue-next'
import type { Mode } from '~/entities/studio/types'
const props = withDefaults(defineProps<{ continuation?: boolean; sourceMode?: Mode }>(), {
  sourceMode: 'image',
})
const emit = defineEmits<{ insert: [kind: Mode | 'reference']; close: [] }>()
const query = shallowRef('')
const active = shallowRef(0)
const root = useTemplateRef<HTMLElement>('root')
const search = useTemplateRef<HTMLInputElement>('search')
const items = computed(() => {
  const generators = [
    {
      kind: 'image' as const,
      label: 'Image generator',
      description: props.continuation ? 'Use this image as a reference' : 'Create an image',
      icon: Image,
    },
    {
      kind: 'video' as const,
      label: 'Video generator',
      description: props.continuation ? 'Animate from this reference' : 'Create a video',
      icon: Clapperboard,
    },
  ]
  if (props.continuation) return props.sourceMode === 'video' ? generators.reverse() : generators
  return [
    {
      kind: 'reference' as const,
      label: 'Reference',
      description: 'Choose or upload an image',
      icon: Paperclip,
    },
    ...generators,
  ]
})
const matches = computed(() =>
  items.value.filter((i) => i.label.toLowerCase().includes(query.value.trim().toLowerCase())),
)
watch(query, () => {
  active.value = 0
})
onMounted(() => {
  if (props.continuation) root.value?.querySelector('button')?.focus()
  else search.value?.focus()
})
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    active.value =
      (active.value + (event.key === 'ArrowDown' ? 1 : -1) + matches.value.length) %
      Math.max(1, matches.value.length)
    if (props.continuation) root.value?.querySelectorAll('button')[active.value]?.focus()
  }
  if (event.key === 'Enter' && matches.value[active.value]) {
    event.preventDefault()
    emit('insert', matches.value[active.value]!.kind)
  }
}
</script>
<template>
  <div
    ref="root"
    data-canvas-popover
    class="node-palette"
    :role="continuation ? 'menu' : 'dialog'"
    :aria-label="continuation ? 'Continue from this image' : 'Add a node'"
    @pointerdown.stop
    @wheel.stop
    @keydown.stop="key"
  >
    <div v-if="continuation" class="palette-title">
      <ArrowUpRight class="size-3.5" /> Continue with
    </div>
    <label v-else class="palette-search"
      ><Search class="size-3.5" /><input
        ref="search"
        v-model="query"
        aria-label="Search nodes"
        placeholder="Search nodes…"
    /></label>
    <div class="palette-items">
      <button
        v-for="(item, index) in matches"
        :key="item.kind"
        :role="continuation ? 'menuitem' : undefined"
        :class="{ active: active === index }"
        @pointerenter="active = index"
        @click="emit('insert', item.kind)"
      >
        <component :is="item.icon" class="size-4" /><span
          ><strong>{{ item.label }}</strong
          ><small>{{ item.description }}</small></span
        >
      </button>
      <p v-if="!matches.length" class="palette-empty">No matching nodes</p>
    </div>
    <footer v-if="!continuation">↑↓ Navigate <span>↵ Add</span><span>Esc Close</span></footer>
  </div>
</template>
