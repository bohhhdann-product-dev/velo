<script setup lang="ts">
import { Images, Trash2, Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import AssetFavoriteButton from '~/features/workspace/AssetFavoriteButton.vue'
import VButton from '~/shared/ui/VButton.vue'
import { timeAgo } from '~/shared/utils/time'
import { useStudioStore } from '~/stores/studio'

const studio = useStudioStore()

onMounted(() => studio.seed())

const fileInput = ref<HTMLInputElement | null>(null)

const uploading = shallowRef(false)
const removing = shallowRef<string | null>(null)
async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (uploading.value) return
  uploading.value = true
  let added = 0
  try {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      await studio.uploadLibraryItem(file)
      added++
    }
    if (added) toast(`Added ${added} to your library`)
    else if (files.length) toast.error('Choose an image file.')
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Upload failed.')
  } finally {
    uploading.value = false
  }
}
async function remove(id: string) {
  if (removing.value) return
  removing.value = id
  try {
    await studio.removeLibraryItemAsync(id)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not remove this image.')
  } finally {
    removing.value = null
  }
}
</script>

<template>
  <div class="collection-page">
    <header class="collection-header">
      <div>
        <p class="collection-eyebrow">Your workspace</p>
        <h1>
          Library<span>{{ studio.library.length }}</span>
        </h1>
        <p class="collection-description">
          A place for your inspiration. Connect these images to any generator.
        </p>
      </div>
      <VButton variant="primary" :disabled="uploading" @click="fileInput?.click()"
        ><Upload class="size-4" /> {{ uploading ? 'Uploading…' : 'Upload images' }}</VButton
      >
      <input
        ref="fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        class="hidden"
        @change="onFiles"
      />
    </header>
    <div class="collection-section">
      <span>All references</span><span>Images · This workspace</span>
    </div>
    <div v-if="studio.library.length" class="collection-grid">
      <article v-for="item in studio.library" :key="item.id" class="library-card group">
        <div class="library-media">
          <video v-if="item.mediaType === 'video'" :src="item.url" :poster="item.posterUrl ?? undefined" controls preload="metadata" :aria-label="item.name" class="size-full object-cover" />
          <img v-else :src="item.url" :alt="item.name" loading="lazy" />
          <AssetFavoriteButton v-if="studio.live" :id="item.id" :favorite="item.favorite" />
          <button
            type="button"
            class="library-remove"
            :aria-label="`Remove ${item.name}`"
            :disabled="Boolean(removing)"
            @click="remove(item.id)"
          >
            <Trash2 class="size-4" />
          </button>
        </div>
        <div class="library-caption">
          <span>{{ item.name }}</span
          ><small>{{ timeAgo(item.createdAt) }}</small>
        </div>
      </article>
    </div>
    <div v-else class="collection-empty">
      <Images class="size-8" />
      <h2>Make room for inspiration</h2>
      <p>Upload an image to use as a reference on your canvas.</p>
    </div>
  </div>
</template>
