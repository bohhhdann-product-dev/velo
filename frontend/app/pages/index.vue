<script setup lang="ts">
import { useStudioStore } from '~/stores/studio'
const studio = useStudioStore()
const error = shallowRef('')
const busy = shallowRef(false)
async function open() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    studio.seed()
    const first = studio.projects[0] ?? (await studio.createProjectAsync())
    await navigateTo(`/p/${first.id}`, { replace: true })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open a project.'
  } finally {
    busy.value = false
  }
}
onMounted(open)
</script>
<template>
  <div class="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-ink-3">
    <template v-if="error"
      ><p role="alert">{{ error }}</p>
      <button @click="open">Try again</button></template
    >
    <span v-else role="status">Opening your canvas…</span>
  </div>
</template>
