<script setup lang="ts">
import { Maximize2 } from 'lucide-vue-next'
import PromptField from './PromptField.vue'
import VModal from '~/shared/ui/VModal.vue'
import { referenceHandle, insertMention, handleFromName } from '~/entities/studio/mentions'
import { useStudioStore } from '~/stores/studio'
import { useCharactersStore } from '~/stores/characters'
import { characterAsset } from '~/features/characters/useCharacterPlacement'
import type { MentionOption } from '~/entities/studio/prompt'
import { toast } from 'vue-sonner'

const props = defineProps<{ projectId: string; nodeId: string }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ commit: []; submit: [] }>()
const studio = useStudioStore()
const characters = useCharactersStore()
const expanded = shallowRef(false)
const options = computed<MentionOption[]>(() => {
  const project = studio.project(props.projectId)
  const canvas: MentionOption[] = (project?.nodes ?? [])
    .flatMap((node) => {
      if (node.type !== 'reference') return []
      const connected = !!project?.edges.some(
        (e) => e.from === node.id && e.to === props.nodeId && !e.slot,
      )
      return [
        {
          id: node.id,
          kind: 'canvas' as const,
          name: node.title ?? node.name,
          handle: referenceHandle(node),
          url: node.url,
          connected,
          disabled: connected
            ? ''
            : project?.edges.some((e) => e.to === props.nodeId && e.slot)
              ? 'Disconnect start/end frames to use references.'
              : (studio.connectionError(props.projectId, node.id, props.nodeId) ?? ''),
        },
      ]
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected))
  return [
    ...canvas,
    ...characters.saved.map((character) =>
      studio.assetMentionOption(props.projectId, props.nodeId, characterAsset(character)),
    ),
    ...studio.library.map((item) =>
      studio.assetMentionOption(props.projectId, props.nodeId, {
        id: studio.live ? item.id : `image:${item.id}`,
        kind: 'image',
        name: item.name,
        handle: handleFromName(item.name),
        url: item.url,
      }),
    ),
  ]
})
function insert(option: MentionOption, range: { start: number; end: number }) {
  if (option.asset) {
    const result = studio.mentionAsset(
      props.projectId,
      props.nodeId,
      option.asset,
      model.value,
      range,
    )
    if (result.ok) model.value = result.text
    else toast.error(result.error)
  } else {
    const text = insertMention(model.value, range, option.handle).text
    if (studio.mentionReference(props.projectId, props.nodeId, option.id, text))
      model.value = text
  }
}
async function createCharacter(range: { start: number; end: number }) {
  emit('commit')
  let character
  try {
    character = await characters.createAsync()
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not create character.')
    return
  }
  navigateTo({
    path: `/characters/${character.id}`,
    query: { project: props.projectId, node: props.nodeId, end: range.end },
  })
}
function close() {
  expanded.value = false
}
watch(expanded, (open) => {
  if (!open) emit('commit')
})
</script>

<template>
  <div class="generator-prompt" @pointerdown.stop>
    <div class="prompt-heading">
      <label :for="`prompt-${nodeId}`">Prompt</label>
      <button
        class="expand-prompt"
        aria-label="Expand prompt"
        title="Expand prompt"
        @click="expanded = true"
      >
        <Maximize2 class="size-3" /><span>Expand</span>
      </button>
    </div>
    <PromptField
      :id="`prompt-${nodeId}`"
      v-model="model"
      :options="options"
      @commit="$emit('commit')"
      @submit="$emit('submit')"
      @mention="insert"
      @create-character="createCharacter"
    />
    <VModal
      v-model:open="expanded"
      title="Edit prompt"
      wide
      :initial-focus="`expanded-prompt-${nodeId}`"
    >
      <p class="prompt-help">Use <kbd>@</kbd> to choose a character or reference.</p>
      <PromptField
        :id="`expanded-prompt-${nodeId}`"
        v-model="model"
        :options="options"
        expanded
        @dismiss="close"
        @commit="$emit('commit')"
        @submit="$emit('submit')"
        @mention="insert"
        @create-character="createCharacter"
      />
      <div class="prompt-dialog-footer">
        <span>Changes are kept as you edit</span
        ><button class="prompt-done" @click="close">Done</button>
      </div>
    </VModal>
  </div>
</template>

<style scoped>
.prompt-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 18px;
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 500;
}
.expand-prompt {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 5px;
  margin-right: -5px;
  border-radius: 5px;
  color: var(--ink-3);
  font-size: 10px;
}
.expand-prompt:hover,
.expand-prompt:focus-visible {
  background: var(--surface-3);
  color: var(--ink);
}
.prompt-help {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}
.prompt-help kbd {
  padding: 1px 4px;
  background: var(--surface-3);
  border-radius: 4px;
  color: var(--ink);
}
.prompt-dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
}
.prompt-dialog-footer > span {
  color: var(--ink-3);
  font-size: 11px;
}
.prompt-done {
  padding: 8px 20px;
  border-radius: 8px;
  background: #bed4c3;
  color: #14231a;
  font-size: 13px;
  font-weight: 600;
}
.prompt-done:hover {
  background: #cee3d3;
}
</style>
