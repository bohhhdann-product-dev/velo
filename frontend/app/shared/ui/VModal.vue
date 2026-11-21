<script setup lang="ts">
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { X } from 'lucide-vue-next'

const props = defineProps<{ title?: string; wide?: boolean; initialFocus?: string }>()
function focusContent(event: Event) {
  if (!props.initialFocus) return
  const field = document.getElementById(props.initialFocus)
  if (field) {
    event.preventDefault()
    field.focus({ preventScroll: true })
  }
}

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay backdrop-blur-sm" />
      <DialogContent
        :aria-describedby="undefined"
        @open-auto-focus="focusContent"
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-(--radius-lg) bg-surface border border-line shadow-float p-5 outline-none vela-rise"
        :class="wide ? 'max-w-3xl' : 'max-w-md'"
      >
        <div v-if="title" class="flex items-center justify-between mb-4">
          <DialogTitle class="text-[17px] font-semibold tracking-tight">{{ title }}</DialogTitle>
          <button
            type="button"
            aria-label="Close dialog"
            class="size-7 inline-flex items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:text-ink transition-colors"
            @click="open = false"
          >
            <X class="size-4" />
          </button>
        </div>
        <DialogTitle v-if="!title" class="sr-only">Media preview</DialogTitle>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
