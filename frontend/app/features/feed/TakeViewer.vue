<script setup lang="ts">
import { Download, Heart } from 'lucide-vue-next'
import VButton from '~/shared/ui/VButton.vue'
import VModal from '~/shared/ui/VModal.vue'
import type { Generation, Take } from '~/entities/studio/types'
import { useStudioStore } from '~/stores/studio'

const props = defineProps<{ take: Take | null; generation: Generation | null }>()

const emit = defineEmits<{ close: [] }>()

const studio = useStudioStore()

const open = computed({
  get: () => props.take !== null,
  set: (value) => {
    if (!value) emit('close')
  },
})

const isVideo = computed(() => props.generation?.draft.mode === 'video')
</script>

<template>
  <VModal v-model:open="open" :title="isVideo ? 'Video preview' : 'Image preview'" wide>
    <template v-if="take && generation">
      <div
        class="flex max-h-[70vh] items-center justify-center overflow-hidden rounded-(--radius-md) bg-black"
      >
        <video
          v-if="isVideo && take.url"
          :src="take.url"
          :poster="take.posterUrl ?? undefined"
          controls
          autoplay
          class="max-h-[70vh] w-full object-contain"
        />
        <img
          v-else-if="take.url"
          :src="take.url"
          :alt="generation.draft.prompt || 'Generated image preview'"
          class="max-h-[70vh] w-full object-contain"
        />
      </div>

      <div class="flex items-start justify-between gap-4 pt-4">
        <p class="line-clamp-2 text-[14px] leading-relaxed text-ink-2">
          {{ generation.draft.prompt }}
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <VButton variant="soft" size="sm" @click="studio.toggleFavorite(take.id)">
            <Heart class="size-4" :class="take.favorite ? 'fill-danger text-danger' : ''" />
            {{ take.favorite ? 'Saved' : 'Save' }}
          </VButton>
          <a
            v-if="take.url"
            :href="take.url"
            download
            class="inline-flex h-8 items-center gap-1.5 rounded-(--radius-xs) bg-accent px-3.5 text-[13px] font-medium text-black hover:bg-accent-hover"
          >
            <Download class="size-4" />
            Download
          </a>
        </div>
      </div>
    </template>
  </VModal>
</template>
