<script setup lang="ts">
import { Download, Heart, Play, RotateCcw } from 'lucide-vue-next'
import type { Generation, Take } from '~/entities/studio/types'
import { aspectRatioCss } from '~/entities/studio/catalog'

const props = defineProps<{ take: Take; generation: Generation }>()

defineEmits<{ open: []; favorite: []; retry: [] }>()

const ratio = computed(() => aspectRatioCss(props.generation.draft.aspect))
const isVideo = computed(() => props.generation.draft.mode === 'video')
const previewUrl = computed(() => (isVideo.value ? props.take.posterUrl : props.take.url))
</script>

<template>
  <div
    class="vela-rise relative overflow-hidden rounded-(--radius-md) border border-line bg-surface-2"
    :style="{ aspectRatio: ratio }"
  >
    <!-- queued / running -->
    <div
      v-if="take.status === 'queued' || take.status === 'running'"
      class="vela-shimmer absolute inset-0 flex flex-col items-center justify-center gap-2"
    >
      <span
        class="size-5 rounded-full border-2 border-ink-3 border-t-transparent"
        :class="take.status === 'running' ? 'animate-spin' : 'opacity-40'"
      />
      <span class="text-[12px] font-medium text-ink-2">
        {{ take.status === 'queued' ? 'Queued' : 'Generating…' }}
      </span>
    </div>

    <!-- failed -->
    <div
      v-else-if="take.status === 'failed'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
    >
      <span class="text-[12px] text-ink-2">{{ take.errorMessage ?? 'Something went wrong.' }}</span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-surface text-[13px] font-medium border border-line hover:border-line-strong transition-colors"
        @click="$emit('retry')"
      >
        <RotateCcw class="size-3.5" />
        Retry
      </button>
    </div>

    <!-- done -->
    <template v-else>
      <button type="button" class="absolute inset-0 group cursor-zoom-in" aria-label="Open preview" @click="$emit('open')">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt=""
          loading="lazy"
          class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span
          v-if="isVideo"
          class="absolute inset-0 flex items-center justify-center"
        >
          <span class="size-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <Play class="size-5 text-white fill-white ml-0.5" />
          </span>
        </span>
      </button>

      <div class="absolute top-2 right-2 flex items-center gap-1.5">
        <button
          type="button"
          class="size-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          :aria-label="take.favorite ? 'Remove from favorites' : 'Save to favorites'" @click.stop="$emit('favorite')"
        >
          <Heart class="size-4" :class="take.favorite ? 'fill-[#ff453a] text-[#ff453a]' : ''" />
        </button>
        <a
          v-if="take.url"
          :href="take.url"
          aria-label="Download media" target="_blank"
          download
          class="size-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-colors"
          @click.stop
        >
          <Download class="size-4" />
        </a>
      </div>
    </template>
  </div>
</template>
