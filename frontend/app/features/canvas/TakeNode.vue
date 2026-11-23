<script setup lang="ts">
import {
  Clapperboard,
  Download,
  Expand,
  Heart,
  Image as ImageIcon,
  Play,
  RotateCcw,
} from 'lucide-vue-next'
import NodeFrame from './NodeFrame.vue'
import type { TakeNode } from '~/entities/studio/types'
import { takeBodySize, clampScale } from '~/entities/studio/geometry'
import { useStudioStore } from '~/stores/studio'

const props = defineProps<{ node: TakeNode; selected: boolean }>()

defineEmits<{
  remove: []
  open: []
  rename: [title: string]
  resizeStep: [delta: number]
  continue: []
}>()

const studio = useStudioStore()

const found = computed(() => studio.findTake(props.node.takeId))
const take = computed(() => found.value?.take ?? null)
const generation = computed(() => found.value?.generation ?? null)

const body = computed(() => {
  const size = takeBodySize(generation.value?.draft.aspect ?? '1:1')
  const scale = clampScale(props.node.scale ?? 1)
  return { w: size.w * scale, h: size.h * scale }
})
const isVideo = computed(() => generation.value?.draft.mode === 'video')
const video = useTemplateRef<HTMLVideoElement>('video')
const mediaError = shallowRef(false)
function play() {
  void video.value?.play().catch(() => {})
}
function pause() {
  if (video.value) {
    video.value.pause()
    video.value.currentTime = 0
  }
}
const previewUrl = computed(() => (isVideo.value ? take.value?.posterUrl : take.value?.url))
const downloadUrl = computed(() => take.value?.assetId ? `/api/assets/${encodeURIComponent(take.value.assetId)}/file?variant=source` : take.value?.url)
</script>

<template>
  <NodeFrame
    :title="
      node.title ??
      `${isVideo ? 'Video' : 'Image'} ${(generation?.takes.findIndex((t) => t.id === node.takeId) ?? 0) + 1}`
    "
    :icon="isVideo ? Clapperboard : ImageIcon"
    :selected="selected"
    :width="body.w"
    @remove="$emit('remove')"
    @rename="$emit('rename', $event)"
    @resize-step="$emit('resizeStep', $event)"
  >
    <div
      class="group/take relative overflow-hidden rounded-[19px] bg-surface-2"
      @dblclick.stop="take?.status === 'done' && $emit('open')"
      @mouseenter="play"
      @mouseleave="pause"
      :style="{ width: `${body.w - 2}px`, height: `${body.h}px` }"
    >
      <template v-if="take && generation">
        <!-- queued / running -->
        <div
          v-if="take.status === 'queued' || take.status === 'running'"
          class="vela-shimmer absolute inset-0 flex flex-col items-center justify-center gap-2"
        >
          <span
            class="size-4.5 rounded-full border-2 border-ink-3 border-t-transparent"
            :class="take.status === 'running' ? 'animate-spin' : 'opacity-40'"
          />
          <span class="text-[11px] font-medium text-ink-2">
            {{ take.status === 'queued' ? 'Queued' : 'Generating…' }}
          </span>
        </div>

        <!-- failed -->
        <div
          v-else-if="take.status === 'failed' || take.status === 'unknown'"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-3 text-center"
        >
          <span class="text-[11px] leading-snug text-ink-2">{{
            take.errorMessage ?? (take.status === 'unknown' ? 'Provider outcome unconfirmed. No automatic resubmission.' : 'Generation failed.')
          }}</span>
          <button
            v-if="!studio.live && take.status === 'failed'"
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[12px] font-medium transition-colors hover:border-line-strong"
            @pointerdown.stop
            @click.stop="studio.retryTake(take.id)"
          >
            <RotateCcw class="size-3" />
            Retry
          </button>
          <button v-if="studio.live && take.status === 'unknown'" class="text-xs underline" @pointerdown.stop @click.stop="studio.refreshGenerations()">Check status</button>
        </div>

        <!-- done -->
        <template v-else>
          <video
            v-if="isVideo && take.url"
            ref="video"
            :src="take.url"
            :poster="take.posterUrl ?? undefined"
            muted
            loop
            playsinline
            preload="metadata"
            class="size-full object-cover"
            @error="mediaError = true"
          />
          <span
            v-if="mediaError"
            class="absolute inset-0 flex items-center justify-center bg-surface-2 text-xs text-ink-2"
            >Preview unavailable · open to retry</span
          >
          <img
            v-if="(!isVideo || mediaError) && previewUrl"
            :src="previewUrl"
            alt=""
            draggable="false"
            class="size-full object-cover"
          />
          <span
            v-if="isVideo"
            class="pointer-events-none absolute inset-0 flex items-center justify-center group-hover/take:opacity-0"
          >
            <span
              class="flex size-9 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm"
            >
              <Play class="ml-0.5 size-4 fill-white text-white" />
            </span>
          </span>

          <div
            class="take-actions absolute inset-x-0 top-0 flex items-center justify-end gap-1 p-2"
            @pointerdown.stop
          >
            <button
              type="button"
              class="take-action flex size-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
              :class="{ 'is-favorite': take.favorite }"
              :aria-pressed="take.favorite"
              :disabled="studio.favoritePending[take.id]"
              :aria-label="take.favorite ? 'Remove from favorites' : 'Save to favorites'"
              @click.stop="studio.toggleFavorite(take.id)"
            >
              <Heart
                class="size-3.5"
                :class="take.favorite ? 'fill-[#ff453a] text-[#ff453a]' : ''"
              />
            </button>
            <a
              v-if="take.url"
              :href="downloadUrl ?? undefined"
              aria-label="Download output"
              download
              class="take-action flex size-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
              @click.stop
            >
              <Download class="size-3.5" />
            </a>
            <button
              type="button"
              class="take-action flex size-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
              aria-label="Open preview"
              @click.stop="$emit('open')"
            >
              <Expand class="size-3.5" />
            </button>
          </div>
        </template>
      </template>
    </div>

    <template #ports>
      <span class="node-port output-port" style="top: 28px; left: -8px; right: auto" />
      <button
        v-if="take?.status === 'done' && (!isVideo || take.posterUrl)"
        class="node-port output-port"
        style="top: 28px"
        data-port="out"
        :data-node-id="node.id"
        :aria-label="isVideo ? 'Continue from video still' : 'Continue from image'"
        aria-haspopup="menu"
        title="Click to continue · drag to connect"
        @click.stop="$event.detail === 0 && $emit('continue')"
        @keydown.stop
      />
    </template>
  </NodeFrame>
</template>

<style scoped>
.take-action {
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 160ms ease,
    background-color 160ms ease;
}
.group\/take:hover .take-action,
.group\/take:focus-within .take-action,
.take-action.is-favorite {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .take-action {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
