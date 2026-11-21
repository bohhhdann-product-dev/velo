<script setup lang="ts">
import { Image as ImageIcon, UserRound } from 'lucide-vue-next'
import NodeFrame from './NodeFrame.vue'
import type { ReferenceNode } from '~/entities/studio/types'
import { referenceHandle } from '~/entities/studio/mentions'
import { REFERENCE_W, clampScale } from '~/entities/studio/geometry'

defineProps<{ node: ReferenceNode; selected: boolean }>()

defineEmits<{ remove: []; rename: [title: string]; resizeStep: [delta: number]; continue: [] }>()
</script>

<template>
  <NodeFrame
    :title="node.title ?? node.name"
    :icon="node.assetKind === 'character' ? UserRound : ImageIcon"
    :selected="selected"
    :width="REFERENCE_W * clampScale(node.scale ?? 1)"
    @remove="$emit('remove')"
    @rename="$emit('rename', $event)"
    @resize-step="$emit('resizeStep', $event)"
  >
    <div
      class="reference-media"
      :style="{ height: `${REFERENCE_W * clampScale(node.scale ?? 1)}px` }"
    >
      <img
        :class="{ 'character-sheet-reference': node.assetKind === 'character' }"
        :src="node.url"
        :alt="node.name"
        draggable="false"
      />
    </div>
    <div class="media-caption">
      <span class="reference-handle" title="Use this tag in your prompt"
        >@{{ referenceHandle(node) }}</span
      >
    </div>
    <template #ports>
      <button
        class="node-port output-port"
        style="top: 28px"
        data-port="out"
        :data-node-id="node.id"
        aria-label="Continue from reference"
        aria-haspopup="menu"
        title="Click to continue · drag to connect"
        @click.stop="$event.detail === 0 && $emit('continue')"
        @keydown.stop
      />
    </template>
  </NodeFrame>
</template>

<style scoped>
.reference-media img.character-sheet-reference {
  object-fit: contain;
  background: #eae8e2;
}
</style>
