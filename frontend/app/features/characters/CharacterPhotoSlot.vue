<script setup lang="ts">
import { X, Replace, ImagePlus, LoaderCircle } from 'lucide-vue-next'
import { readCharacterPhoto } from '~/entities/character/sheet'
import { useStudioStore } from '~/stores/studio'
import type { CharacterPhoto } from '~/entities/character/types'
const props = defineProps<{
  label: string
  photo?: CharacterPhoto
  required?: boolean
  body?: boolean
}>()
const emit = defineEmits<{ change: [photo: CharacterPhoto | null]; busy: [value: boolean] }>()
const studio = useStudioStore()
const input = useTemplateRef<HTMLInputElement>('input')
const busy = shallowRef(false)
const dragging = shallowRef(false)
const error = shallowRef('')
let request = 0
onBeforeUnmount(() => {
  request++
  if (busy.value) emit('busy', false)
})
async function accept(file?: File) {
  if (!file || busy.value) return
  const current = ++request
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    if (studio.live) {
      const asset = await studio.uploadLibraryItem(file)
      if (current === request)
        emit('change', {
          id: asset.id,
          assetId: asset.id,
          name: asset.name,
          url: asset.url,
        })
    } else {
      const url = await readCharacterPhoto(file)
      if (current === request) emit('change', { id: crypto.randomUUID(), name: file.name, url })
    }
  } catch (cause) {
    if (current === request)
      error.value = cause instanceof Error ? cause.message : 'Could not open this image.'
  } finally {
    if (current === request) {
      busy.value = false
      emit('busy', false)
    }
  }
}
function choose(event: Event) {
  const element = event.target as HTMLInputElement
  void accept(element.files?.[0])
  element.value = ''
}
function drop(event: DragEvent) {
  dragging.value = false
  void accept(event.dataTransfer?.files[0])
}
</script>
<template>
  <div
    class="photo-slot"
    :class="{ filled: photo, dragging, busy }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="drop"
  >
    <input
      ref="input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      class="hidden"
      tabindex="-1"
      :aria-label="`Upload ${label}`"
      @change="choose"
    />
    <button
      class="photo-pick"
      :aria-label="`${photo ? 'Replace' : 'Upload'} ${label}`"
      :disabled="busy"
      @click="input?.click()"
    >
      <img v-if="photo" :src="photo.url" :alt="label" :class="{ 'full-body': body }" />
      <template v-else
        ><ImagePlus class="photo-icon" /><span>{{ label }}</span
        ><small>{{ required ? 'Required' : 'Optional' }}</small></template
      >
      <span v-if="busy" class="photo-loading"
        ><LoaderCircle class="size-5 animate-spin"
      /></span>
      <span v-else-if="photo" class="replace-photo"><Replace class="size-3.5" /> Replace</span>
    </button>
    <div v-if="photo" class="photo-caption">
      <span>{{ label }}</span
      ><button :aria-label="`Remove ${label}`" :disabled="busy" @click="$emit('change', null)">
        <X class="size-3.5" />
      </button>
    </div>
    <p v-if="error" class="photo-error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.photo-slot {
  position: relative;
  min-width: 0;
  border: 1px dashed var(--line-strong);
  border-radius: 12px;
  background: #151719;
  overflow: hidden;
  transition:
    border-color 0.16s,
    background 0.16s;
}
.photo-slot:hover,
.photo-slot.dragging {
  border-color: #839c8b;
  background: #1b211e;
}
.photo-slot.filled {
  border-style: solid;
}
.photo-slot.filled .photo-pick {
  height: 134px;
}
.photo-pick {
  position: relative;
  width: 100%;
  height: 168px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--ink-2);
}
.photo-icon {
  width: 25px;
  height: 25px;
  color: #9aaa9d;
  margin-bottom: 5px;
  stroke-width: 1.3;
}
.photo-pick span {
  font-size: 12px;
  font-weight: 500;
}
.photo-pick small {
  color: var(--ink-3);
  font-size: 10px;
}
.photo-pick img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-pick img.full-body {
  object-fit: contain;
  background: #141617;
}
.replace-photo {
  position: absolute;
  display: flex;
  gap: 6px;
  align-items: center;
  bottom: 9px;
  padding: 5px 9px;
  border-radius: 6px;
  background: #131615da;
  color: #fff;
  opacity: 0;
}
.photo-pick:hover .replace-photo,
.photo-pick:focus-visible .replace-photo {
  opacity: 1;
}
.photo-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--ink-2);
}
.photo-caption button {
  padding: 5px;
  border-radius: 4px;
}
.photo-caption button:hover {
  color: var(--ink);
  background: var(--surface-2);
}
.photo-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #101112a0;
}
.photo-error {
  color: #ffa49b;
  padding: 8px 10px;
  font-size: 11px;
}
</style>
