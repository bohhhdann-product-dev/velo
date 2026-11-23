<script setup lang="ts">
import AssetFavoriteButton from '~/features/workspace/AssetFavoriteButton.vue'
import { Heart } from 'lucide-vue-next'
import TakeCard from '~/features/feed/TakeCard.vue'
import TakeViewer from '~/features/feed/TakeViewer.vue'
import type { Generation, Take } from '~/entities/studio/types'
import { useStudioStore } from '~/stores/studio'

const studio = useStudioStore()

onMounted(() => studio.seed())

const favoriteAssets = computed(() => studio.live ? studio.library.filter((item) => item.favorite && !entries.value.some((entry) => entry.take.assetId === item.id)) : [])
const favoriteCount = computed(() =>
  favoriteAssets.value.length + entries.value.length,
)
const entries = computed(() =>
  studio.favorites
    .map((take) => {
      const generation = studio.generations.find((g) => g.id === take.generationId)
      return generation ? { take, generation } : null
    })
    .filter((e): e is { take: Take; generation: Generation } => e !== null),
)

const viewerTake = ref<Take | null>(null)
const viewerGeneration = ref<Generation | null>(null)

function openViewer(entry: { take: Take; generation: Generation }) {
  viewerTake.value = entry.take
  viewerGeneration.value = entry.generation
}
</script>

<template>
  <div class="collection-page">
    <header class="collection-header">
      <div>
        <p class="collection-eyebrow">Your workspace</p>
        <h1>
          Favorites<span>{{ favoriteCount }}</span>
        </h1>
        <p class="collection-description">
          Your saved references and generated results, together.
        </p>
      </div>
    </header>
    <div class="collection-section">
      <span>Saved media</span
      ><span>{{ favoriteCount }} {{ favoriteCount === 1 ? 'item' : 'items' }}</span>
    </div>

    <div v-if="favoriteCount" class="collection-grid">
      <article v-for="item in favoriteAssets" :key="item.id" class="library-card">
        <div class="library-media">
          <video v-if="item.mediaType === 'video'" :src="item.url" :poster="item.posterUrl ?? undefined" controls preload="metadata" :aria-label="item.name" />
          <img v-else :src="item.url" :alt="item.name" loading="lazy" />
          <AssetFavoriteButton :id="item.id" :favorite="item.favorite" />
        </div>
        <div class="library-caption">
          <span>{{ item.name }}</span>
        </div>
      </article>
      <TakeCard
        v-for="entry in entries"
        :key="entry.take.id"
        :take="entry.take"
        :generation="entry.generation"
        :live="studio.live"
        :favorite-pending="studio.favoritePending[entry.take.id]"
        @open="openViewer(entry)"
        @favorite="studio.toggleFavorite(entry.take.id)"
        @retry="studio.retryTake(entry.take.id)"
      />
    </div>

    <div v-else class="flex flex-col items-center gap-3 py-20 text-center">
      <span class="size-12 rounded-full bg-surface-2 flex items-center justify-center">
        <Heart class="size-5 text-ink-3" />
      </span>
      <p class="text-[14px] text-ink-2">
        {{
          studio.live
            ? 'Tap the heart on a library image or generated result to keep it here.'
            : 'Tap the heart on any take to keep it here.'
        }}
      </p>
    </div>

    <TakeViewer
      :take="viewerTake"
      :generation="viewerGeneration"
      @close="
        () => {
          viewerTake = null
          viewerGeneration = null
        }
      "
    />
  </div>
</template>
