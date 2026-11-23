<script setup lang="ts" generic="T extends string | number">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  /** short name shown before the value, e.g. "Aspect" */
  label?: string
  options: { value: T; label: string; shortLabel?: string; disabled?: boolean; reason?: string }[]
}>()

const model = defineModel<T>({ required: true })

const current = computed(
  () =>
    props.options.find((o) => o.value === model.value)?.shortLabel ??
    props.options.find((o) => o.value === model.value)?.label ??
    String(model.value),
)
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      class="parameter-select"
      :aria-label="label ? `${label}: ${current}` : current"
    >
      {{ current }}
      <ChevronDown class="size-3.5 text-ink-3" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="6"
        class="z-50 min-w-40 rounded-(--radius-md) bg-surface border border-line shadow-float p-1.5 vela-rise"
      >
        <DropdownMenuItem
          v-for="option in options"
          :key="String(option.value)"
          :disabled="option.disabled"
          :title="option.reason"
          class="flex items-center justify-between gap-3 rounded-(--radius-xs) px-3 py-2 text-[13px] cursor-pointer outline-none data-highlighted:bg-surface-2 data-disabled:opacity-40 data-disabled:cursor-not-allowed"
          @select="model = option.value"
        >
          {{ option.label }}
          <Check v-if="model === option.value" class="size-3.5 text-accent" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
