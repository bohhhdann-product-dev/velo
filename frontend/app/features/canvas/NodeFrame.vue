<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import type { Component } from 'vue'
const props = withDefaults(
  defineProps<{
    title: string
    icon?: Component
    selected?: boolean
    width: number
    contentScale?: number
    badge?: string
  }>(),
  { contentScale: 1 },
)
const emit = defineEmits<{ remove: []; rename: [title: string]; resizeStep: [delta: number] }>()
const editing = shallowRef(false)
const name = shallowRef('')
const input = useTemplateRef<HTMLInputElement>('nameInput')
const titleControl = useTemplateRef<HTMLElement>('titleControl')
let cancelled = false
function rename() {
  if (editing.value) return
  name.value = props.title
  cancelled = false
  editing.value = true
  nextTick(() => input.value?.select())
}
function commit(restoreFocus = false) {
  if (!editing.value) return
  editing.value = false
  if (!cancelled && name.value.trim()) emit('rename', name.value.trim())
  if (restoreFocus) nextTick(() => titleControl.value?.focus({ preventScroll: true }))
}
function cancel() {
  cancelled = true
  editing.value = false
  nextTick(() => titleControl.value?.focus({ preventScroll: true }))
}
function activateTitle(event: MouseEvent) {
  if ((event.currentTarget as HTMLElement).dataset.suppressRename) return
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey) rename()
}
</script>
<template>
  <div
    class="node-frame group/node"
    :class="{ 'is-selected': selected }"
    :style="{ width: `${width}px` }"
    data-node
  >
    <div class="node-caption" data-node-handle>
      <component :is="icon" v-if="icon" class="size-3.5 shrink-0" />
      <input
        v-if="editing"
        ref="nameInput"
        v-model="name"
        aria-label="Node name"
        class="node-name-input"
        maxlength="80"
        @pointerdown.stop
        @keydown.stop
        @keydown.enter.prevent="commit(true)"
        @keydown.escape.prevent="cancel"
        @blur="commit()"
      />
      <span
        v-else
        ref="titleControl"
        data-node-title
        role="button"
        tabindex="0"
        class="node-name truncate"
        :aria-label="`Rename ${title}`"
        title="Click to rename"
        @click.stop="activateTitle"
        @keydown.enter.stop.prevent="rename"
        @keydown.space.stop.prevent="rename"
        >{{ title }}</span
      >
      <span v-if="badge" class="node-badge">{{ badge }}</span>
      <button
        class="node-delete"
        :aria-label="`Delete ${title}`"
        title="Delete node"
        @pointerdown.stop
        @click.stop="$emit('remove')"
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>
    <div class="node-content" :style="contentScale !== 1 ? { zoom: contentScale } : undefined">
      <slot />
    </div>
    <slot name="ports" />
    <button
      data-resize
      class="node-resize"
      aria-label="Resize node"
      title="Drag to resize"
      @keydown.left.stop.prevent="$emit('resizeStep', -0.1)"
      @keydown.down.stop.prevent="$emit('resizeStep', -0.1)"
      @keydown.right.stop.prevent="$emit('resizeStep', 0.1)"
      @keydown.up.stop.prevent="$emit('resizeStep', 0.1)"
    >
      <span class="node-resize-arc" aria-hidden="true" />
    </button>
  </div>
</template>
