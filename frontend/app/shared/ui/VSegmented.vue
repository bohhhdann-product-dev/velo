<script setup lang="ts" generic="T extends string">
import type { Component } from 'vue'

defineProps<{
  options: { value: T; label: string; icon?: Component }[]
}>()

const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="inline-flex items-center gap-0.5 rounded-full bg-surface-2 border border-line p-1">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[13px] font-medium transition-all duration-200"
      :class="
        model === option.value
          ? 'bg-surface text-ink shadow-card'
          : 'text-ink-2 hover:text-ink'
      "
      @click="model = option.value"
    >
      <component :is="option.icon" v-if="option.icon" class="size-4" />
      {{ option.label }}
    </button>
  </div>
</template>
