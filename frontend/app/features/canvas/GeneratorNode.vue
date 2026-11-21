<script setup lang="ts">
import { Image as ImageIcon, Clapperboard, Play, Plus, X } from 'lucide-vue-next'
import NodeFrame from './NodeFrame.vue'
import PromptEditor from './PromptEditor.vue'
import VPillMenu from '~/shared/ui/VPillMenu.vue'
import VSlider from '~/shared/ui/VSlider.vue'
import type { GeneratorNode } from '~/entities/studio/types'
import {
  ASPECTS,
  COUNTS,
  DURATION,
  IMAGE_QUALITIES,
  MODELS,
  VIDEO_MODELS,
  videoModel,
  VIDEO_QUALITIES,
  priceCredits,
} from '~/entities/studio/catalog'
import { GENERATOR_W, clampScale, inPort, outPort } from '~/entities/studio/geometry'
import { useStudioStore } from '~/stores/studio'

const props = defineProps<{
  node: GeneratorNode
  projectId: string
  selected: boolean
}>()

const emit = defineEmits<{
  remove: []
  run: []
  pickReference: [slot?: 'start' | 'end']
  rename: [title: string]
  resizeStep: [delta: number]
}>()

const studio = useStudioStore()
const promptText = shallowRef(props.node.draft.prompt)
watch(
  () => props.node.draft.prompt,
  (value) => {
    promptText.value = value
  },
)
function commitPrompt() {
  if (promptText.value !== props.node.draft.prompt) update({ prompt: promptText.value })
}

watch(promptText, () => {
  if (studio.live) commitPrompt()
})

function run() {
  if (
    blocked.value ||
    (!promptText.value.trim() && !references.value.length && !hasFrames.value)
  )
    return
  commitPrompt()
  emit('run')
}

const modelOptions = computed(() =>
  props.node.draft.mode === 'image'
    ? [{ value: MODELS.image.id, label: MODELS.image.label }]
    : VIDEO_MODELS,
)
const model = computed(() => videoModel(props.node.draft))
function update(patch: Partial<GeneratorNode['draft']>) {
  studio.updateDraft(props.projectId, props.node.id, patch)
}
function frame(slot: 'start' | 'end') {
  const p = studio.project(props.projectId)
  const edge = p?.edges.find((e) => e.to === props.node.id && e.slot === slot)
  return edge ? studio.sourceMedia(props.projectId, edge.from) : null
}
function clearFrame(slot: 'start' | 'end') {
  const edge = studio
    .project(props.projectId)
    ?.edges.find((e) => e.to === props.node.id && e.slot === slot)
  if (edge) studio.disconnect(props.projectId, edge.id)
}

const countOptions = COUNTS.map((n) => ({
  value: n,
  label: n === 1 ? '1 output' : `${n} outputs`,
  shortLabel: `× ${n}`,
}))

const references = computed(() => studio.connectedReferences(props.projectId, props.node.id))

const price = computed(() => priceCredits(props.node.draft))

const activeTakes = computed(() => studio.activeCount(props.projectId, props.node.id))
const hasFrames = computed(() => Boolean(frame('start') || frame('end')))
const referenceLimit = computed(() =>
  props.node.draft.mode === 'image' ? 6 : model.value.maxReferences,
)
const blocked = computed(() => {
  if (studio.live) return 'Generation is not enabled yet'
  if (activeTakes.value) return 'Generation in progress'
  if (references.value.length > referenceLimit.value)
    return `Remove extra references (maximum ${referenceLimit.value})`
  if (frame('end') && !frame('start')) return 'Add a start image first'
  const mentionError = studio.promptReferenceError(
    props.projectId,
    props.node.id,
    promptText.value,
  )
  if (mentionError) return mentionError
  if (price.value > studio.credits) return 'Not enough credits'
  return ''
})

function disconnectReference(referenceId: string) {
  const project = studio.project(props.projectId)
  const edge = project?.edges.find(
    (e) => e.from === referenceId && e.to === props.node.id && !e.slot,
  )
  if (edge) studio.disconnect(props.projectId, edge.id)
}
</script>

<template>
  <NodeFrame
    :title="
      node.title ??
      `${node.draft.mode === 'image' ? 'Image' : 'Video'} generator #${node.number ?? 1}`
    "
    :icon="node.draft.mode === 'image' ? ImageIcon : Clapperboard"
    :selected="selected"
    :width="GENERATOR_W * clampScale(node.scale ?? 1)"
    :content-scale="clampScale(node.scale ?? 1)"
    @remove="$emit('remove')"
    @rename="$emit('rename', $event)"
    @resize-step="$emit('resizeStep', $event)"
  >
    <section class="generator-references">
      <div class="field-heading">
        <span>References</span
        ><span
          >{{ references.length }} /
          {{ node.draft.mode === 'image' ? 6 : model.maxReferences }}</span
        >
      </div>
      <div class="reference-strip" @pointerdown.stop @wheel.stop>
        <div v-for="ref in references" :key="ref.id" class="reference-thumb" :title="ref.name">
          <img :src="ref.url" :alt="ref.name" draggable="false" />
          <button
            :aria-label="`Disconnect ${ref.name}`"
            @click.stop="disconnectReference(ref.id)"
          >
            <X class="size-2.5" />
          </button>
        </div>
        <button
          class="add-reference"
          :disabled="hasFrames || references.length >= referenceLimit"
          :title="hasFrames ? 'Disconnect frame inputs to use references' : 'Choose an image'"
          aria-label="Add a reference"
          @click.stop="$emit('pickReference')"
        >
          <Plus class="size-4" />
        </button>
        <span v-if="!references.length" class="reference-hint"
          >Add an image to guide your result</span
        >
      </div>
    </section>
    <div v-if="node.draft.mode === 'video'" class="frame-inputs">
      <div
        v-for="slot in ['start', 'end'] as const"
        :key="slot"
        class="frame-input"
        @pointerdown.stop
      >
        <button
          class="frame-picker"
          :disabled="references.length > 0"
          :title="references.length ? 'Disconnect references to use frame inputs' : undefined"
          @click="$emit('pickReference', slot)"
        >
          <span class="frame-thumbnail"
            ><img v-if="frame(slot)" :src="frame(slot)!.url" alt="" /><ImageIcon
              v-else
              class="size-4"
          /></span>
          <span
            >{{ slot === 'start' ? 'Start image' : 'End image'
            }}<small>{{
              slot === 'start' ? 'Set the opening frame' : 'Optional closing frame'
            }}</small></span
          >
        </button>
        <button
          v-if="frame(slot)"
          class="icon-button"
          :aria-label="`Remove ${slot} image`"
          @click="clearFrame(slot)"
        >
          <X class="size-3" />
        </button>
        <Plus v-else class="size-3.5 text-ink-3" />
      </div>
    </div>
    <PromptEditor
      v-model="promptText"
      :project-id="projectId"
      :node-id="node.id"
      @commit="commitPrompt"
      @submit="run"
    />
    <div class="generator-model" @pointerdown.stop>
      <span>Model</span>
      <VPillMenu
        :model-value="node.draft.modelId"
        :options="modelOptions"
        label="Model"
        @update:model-value="update({ modelId: $event })"
      />
    </div>
    <div class="generator-settings" @pointerdown.stop>
      <div class="setting">
        <span>Format</span
        ><VPillMenu
          :model-value="node.draft.aspect"
          :options="ASPECTS"
          label="Aspect ratio"
          @update:model-value="update({ aspect: $event })"
        />
      </div>
      <div class="setting">
        <span>Quality</span>
        <VPillMenu
          v-if="node.draft.mode === 'image'"
          :model-value="node.draft.imageQuality"
          :options="IMAGE_QUALITIES"
          label="Quality"
          @update:model-value="update({ imageQuality: $event })"
        />
        <span v-else-if="node.draft.trial" class="fixed-parameter">480p</span>
        <VPillMenu
          v-else
          :model-value="node.draft.videoQuality"
          :options="VIDEO_QUALITIES"
          label="Quality"
          @update:model-value="update({ videoQuality: $event })"
        />
      </div>
      <div class="setting">
        <span>Outputs</span
        ><VPillMenu
          :model-value="node.draft.count"
          :options="countOptions"
          label="Outputs"
          @update:model-value="update({ count: $event })"
        />
      </div>
    </div>
    <div v-if="node.draft.mode === 'video'" class="video-options" @pointerdown.stop>
      <span class="text-ink-2">{{ node.draft.trial ? 4 : node.draft.durationS }}s</span>
      <VSlider
        v-if="!node.draft.trial"
        :model-value="node.draft.durationS"
        :min="DURATION.min"
        :max="model.maxDuration"
        :step="1"
        @update:model-value="update({ durationS: $event })"
      />
      <span v-else class="text-ink-3">Quick preview</span>
      <button
        role="switch"
        :aria-checked="node.draft.trial"
        aria-label="Trial generation: 4 seconds at 480p"
        class="trial-toggle"
        @click="update({ trial: !node.draft.trial })"
      >
        Trial<span :class="{ on: node.draft.trial }"><i /></span>
      </button>
    </div>
    <div class="generator-footer" @pointerdown.stop>
      <span class="generation-note" :title="blocked || undefined"
        ><span v-if="activeTakes" class="busy-dot" />{{
          activeTakes ? `Creating ${activeTakes} outputs` : blocked || 'Ready when you are'
        }}</span
      >
      <button
        class="generate-button"
        :disabled="Boolean(blocked) || (!promptText.trim() && !references.length && !hasFrames)"
        :title="blocked || undefined"
        @click.stop="run"
      >
        <Play class="size-3.5" /> {{ activeTakes ? 'Creating…' : 'Generate' }}
        <span v-if="!studio.live"
          >{{ price }} <span class="font-normal opacity-70">cr</span></span
        >
      </button>
    </div>
    <template #ports>
      <button
        class="node-port input-port"
        :style="{ top: `${inPort(node).y - node.y - 8}px` }"
        data-port="in"
        :data-node-id="node.id"
        :disabled="hasFrames || references.length >= referenceLimit"
        aria-label="Choose reference input"
        title="Choose a reference · or drop a connection here"
        @pointerdown.stop
        @click.stop="$emit('pickReference')"
      />
      <button
        v-for="slot in node.draft.mode === 'video' ? (['start', 'end'] as const) : []"
        :key="slot"
        class="node-port input-port"
        :style="{ top: `${inPort(node, slot).y - node.y - 8}px` }"
        data-port="in"
        :data-slot="slot"
        :data-node-id="node.id"
        :disabled="references.length > 0"
        :aria-label="`Choose ${slot} frame`"
        @pointerdown.stop
        @click.stop="$emit('pickReference', slot)"
      />
      <span
        class="node-port output-port"
        :style="{ top: `${outPort(node).y - node.y - 8}px` }"
      />
    </template>
  </NodeFrame>
</template>
