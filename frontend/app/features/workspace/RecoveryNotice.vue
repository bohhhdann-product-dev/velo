<script setup lang="ts">
import { toast } from 'vue-sonner'
import VModal from '~/shared/ui/VModal.vue'
import VButton from '~/shared/ui/VButton.vue'
import {
  createDraftRecovery,
  type RecoveryDraft,
} from '~/shared/persistence/recovery'
import { useWorkspaceStore } from '~/stores/workspace'
import { useStudioStore } from '~/stores/studio'
import { useCharactersStore } from '~/stores/characters'
import type { Project } from '~/entities/studio/types'
const props = defineProps<{ drafts: RecoveryDraft[] }>()
const emit = defineEmits<{ handled: [key: string]; refresh: [] }>()
const workspace = useWorkspaceStore()
const studio = useStudioStore()
const characters = useCharactersStore()
const recovery = createDraftRecovery()
const open = shallowRef(true)
const pending = shallowRef<string | null>(null)
function title(draft: RecoveryDraft) {
  const payload = draft.payload as { title?: unknown; name?: unknown }
  const name = draft.kind === 'project' ? payload.title : payload.name
  return typeof name === 'string' && name.trim()
    ? name
    : draft.kind === 'project'
      ? 'Untitled canvas'
      : 'Untitled character'
}
function discard(draft: RecoveryDraft) {
  if (workspace.userId !== draft.userId) return
  if (recovery.discard(draft)) emit('handled', draft.key)
  else {
    emit('refresh')
    toast('This draft changed in another editor. The latest copy has been kept.')
  }
}
async function restore(draft: RecoveryDraft) {
  if (pending.value || workspace.userId !== draft.userId) return
  pending.value = draft.key
  try {
    let destination: string
    if (draft.kind === 'project') {
      const source = draft.payload as Project
      if (!Array.isArray(source.nodes) || !Array.isArray(source.edges) || !source.viewport)
        throw new Error('This recovery draft cannot be opened.')
      const copy = await studio.createProjectAsync(
        `${title(draft)} (recovered)`.slice(0, 120),
        source,
        `project:recover:${draft.key}`,
      )
      destination = `/p/${copy.id}`
    } else {
      const copy = await characters.restoreCopy(draft.payload, draft.key)
      destination = `/characters/${copy.id}`
    }
    discard(draft)
    toast('Recovered as a new copy')
    await navigateTo(destination)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not restore this draft.')
  } finally {
    pending.value = null
  }
}
</script>
<template>
  <template v-if="drafts.length">
    <button v-if="!open" class="recovery-reopen" @click="open = true">
      Recover unsaved work · {{ drafts.length }}
    </button>
    <VModal v-model:open="open" title="Recover unsaved work">
      <p class="recovery-description">
        These edits were kept on this device before your last visit ended. Restore a new copy to
        keep your saved work intact.
      </p>
      <div v-for="draft in drafts" :key="draft.key" class="recovery-row">
        <div>
          <strong>{{ title(draft) }}</strong
          ><small
            >{{ draft.kind === 'project' ? 'Canvas' : 'Character draft' }} ·
            {{ new Date(draft.updatedAt).toLocaleString() }}</small
          >
        </div>
        <div class="recovery-actions">
          <button :disabled="!!pending" @click="discard(draft)">Discard</button>
          <VButton variant="primary" :disabled="!!pending" @click="restore(draft)">{{
            pending === draft.key ? 'Restoring…' : 'Restore copy'
          }}</VButton>
        </div>
      </div>
    </VModal>
  </template>
</template>
<style scoped>
.recovery-description {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
  margin-bottom: 20px;
}
.recovery-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}
.recovery-row strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
}
.recovery-row small {
  display: block;
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 5px;
}
.recovery-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.recovery-actions > button:first-child {
  font-size: 12px;
  color: var(--ink-3);
}
.recovery-reopen {
  position: fixed;
  z-index: 35;
  right: 18px;
  top: 64px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  color: var(--ink-2);
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 12px;
}
@media (max-width: 520px) {
  .recovery-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
