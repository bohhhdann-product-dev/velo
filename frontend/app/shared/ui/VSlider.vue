<script setup lang="ts">
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui'

const props = defineProps<{ min: number; max: number; step: number; label?: string }>()

const model = defineModel<number>({ required: true })

const sliderValue = computed({
  get: () => [model.value],
  set: (v: number[]) => {
    model.value = v[0] ?? props.min
  },
})
</script>

<template>
  <SliderRoot
    v-model="sliderValue"
    :min="min"
    :max="max"
    :step="step"
    class="relative flex items-center w-28 h-8 select-none touch-none"
  >
    <SliderTrack class="relative h-1 grow rounded-full bg-line overflow-hidden">
      <SliderRange class="absolute h-full rounded-full bg-accent" />
    </SliderTrack>
    <SliderThumb
      :aria-label="label ?? 'Duration in seconds'"
      class="block size-4.5 rounded-full bg-white shadow-float border border-line cursor-grab active:cursor-grabbing outline-none"
    />
  </SliderRoot>
</template>
