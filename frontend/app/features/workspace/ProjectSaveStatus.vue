<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useStudioStore } from '~/stores/studio'
const props = defineProps<{ id: string }>()
const studio = useStudioStore()
const state = computed(() => studio.saveStates[props.id])
const busy = shallowRef(false)
async function resolve(action: 'retry' | 'reload' | 'copy') {
  busy.value = true
  try {
    if (action === 'retry') await studio.retryProjectSave(props.id)
    if (action === 'reload') await studio.reloadProject(props.id)
    if (action === 'copy') {
      const copy = await studio.keepProjectCopy(props.id)
      await navigateTo(`/p/${copy.id}`)
    }
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not save the canvas.')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div
    class="save-status"
    :role="state?.status === 'conflict' || state?.status === 'error' ? 'alert' : 'status'"
  >
    <template v-if="state?.status === 'conflict'">
      <span>{{ state.message || 'Changed in another session. Your edits are here.' }}</span>
      <button :disabled="busy" @click="resolve('reload')">Reload</button>
      <button :disabled="busy" @click="resolve('copy')">Keep a copy</button>
    </template>
    <template v-else-if="state?.status === 'error'">
      <span :title="state.message">{{ state.message || 'Could not save' }}</span>
      <button :disabled="busy" @click="resolve('retry')">Retry</button>
    </template>
    <span v-else>{{
      state?.status === 'saving'
        ? 'Saving…'
        : state?.status === 'pending'
          ? 'Unsaved changes'
          : 'Saved'
    }}</span>
  </div>
</template>
<style scoped>
.save-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-3);
  font-size: 11px;
}
.save-status button {
  flex-shrink: 0;
  min-height: 32px;
  color: var(--ink);
  white-space: nowrap;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.save-status[role='alert'] {
  color: #dfba9d;
}
@media (max-width: 600px) {
  .save-status[role='alert'] {
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .save-status[role='alert'] > span {
    flex-basis: 100%;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
}
</style>
