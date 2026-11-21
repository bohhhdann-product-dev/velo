<script setup lang="ts">
import { ArrowRight, Check, Download, Layers, LoaderCircle, RefreshCw } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import VButton from '~/shared/ui/VButton.vue'
import VModal from '~/shared/ui/VModal.vue'
import { characterPhotos, type Character } from '~/entities/character/types'
import { composeCharacterSheet } from '~/entities/character/sheet'
import { useCharactersStore } from '~/stores/characters'
const props = defineProps<{ character: Character; returning?: boolean }>()
const emit = defineEmits<{
  saved: []
  useVideo: []
  edit: [step: 'face' | 'body']
}>()
const characters = useCharactersStore()
const busy = shallowRef(false)
const error = shallowRef('')
const previewOpen = shallowRef(false)
const facePhotos = computed(() => characterPhotos(props.character, 'face'))
const bodyPhotos = computed(() => characterPhotos(props.character, 'body'))
let active = true
onBeforeUnmount(() => {
  active = false
})
async function build() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  const revision = props.character.revision
  const snapshot = JSON.parse(JSON.stringify(props.character)) as Character
  try {
    if (characters.live) await characters.buildSheet(props.character.id)
    else {
      const url = await composeCharacterSheet(snapshot)
      if (active && !characters.setSheet(props.character.id, url, revision))
        error.value = 'Your photos changed. Review them and build the sheet again.'
    }
  } catch (cause) {
    if (active)
      error.value =
        cause instanceof Error ? cause.message : 'Could not build the sheet. Try again.'
  } finally {
    if (active) busy.value = false
  }
}
async function save() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    error.value = await characters.saveAsync(props.character.id)
    if (error.value || !active) return
    toast('Character saved')
    emit('saved')
  } catch (cause) {
    if (active)
      error.value = cause instanceof Error ? cause.message : 'Could not save character.'
  } finally {
    if (active) busy.value = false
  }
}
</script>
<template>
  <div class="sheet-stage">
    <div class="sheet-heading">
      <h2>One character. All your references.</h2>
      <p>
        Review the face and body together, then save your character to use with
        <span>@{{ character.handle }}</span
        >.
      </p>
    </div>
    <div class="sheet-layout">
      <section class="sheet-canvas">
        <button
          v-if="character.sheetUrl"
          class="sheet-image"
          aria-label="Open character sheet"
          @click="previewOpen = true"
        >
          <img :src="character.sheetUrl" :alt="`${character.name} reference sheet`" />
        </button>
        <div v-else class="sheet-draft">
          <div
            v-for="group in [
              { label: 'Face', photos: facePhotos },
              { label: 'Body', photos: bodyPhotos },
            ]"
            :key="group.label"
            class="sheet-row"
          >
            <span>{{ group.label }}</span>
            <div>
              <img
                v-for="photo in group.photos"
                :key="photo.id"
                :src="photo.url"
                :alt="photo.label"
              />
            </div>
          </div>
          <span class="sheet-draft-label"
            ><Layers class="size-3.5" /> Reference sheet preview</span
          >
        </div>
        <div class="sheet-caption">
          <span>Assembled from your photos</span
          ><a
            v-if="character.sheetUrl"
            :href="character.sheetUrl"
            :download="`${character.handle}-reference-sheet.${characters.live ? 'webp' : 'jpg'}`"
            ><Download class="size-3.5" /> Download</a
          >
        </div>
      </section>
      <aside class="sheet-details">
        <div class="sheet-identity">
          <img
            v-if="character.face.photos.front"
            :src="character.face.photos.front.url"
            alt=""
          />
          <div>
            <strong>{{ character.name }}</strong
            ><span>@{{ character.handle }}</span>
          </div>
        </div>
        <div class="sheet-source">
          <div>
            <Check class="size-3.5" /><span
              >Face approved
              <small
                >{{ facePhotos.length }}
                {{ facePhotos.length === 1 ? 'photo' : 'photos' }}</small
              ></span
            ><button @click="emit('edit', 'face')">Edit</button>
          </div>
          <div>
            <Check class="size-3.5" /><span
              >Body approved
              <small
                >{{ bodyPhotos.length }}
                {{ bodyPhotos.length === 1 ? 'photo' : 'photos' }}</small
              ></span
            ><button @click="emit('edit', 'body')">Edit</button>
          </div>
        </div>
        <p class="sheet-explanation">
          Your uploaded angles stay together in one reference sheet. Photos are kept as
          supplied; no new views are generated.
        </p>
        <VButton v-if="!character.sheetUrl" variant="primary" :disabled="busy" @click="build"
          ><LoaderCircle v-if="busy" class="size-4 animate-spin" /><Layers
            v-else
            class="size-4"
          />{{ busy ? 'Building sheet…' : 'Build reference sheet' }}</VButton
        >
        <template v-else-if="!character.savedAt"
          ><VButton variant="primary" :disabled="busy" @click="save"
            >{{ returning ? 'Save & use character' : 'Save character'
            }}<ArrowRight class="size-4" /></VButton
          ><button class="rebuild-sheet" :disabled="busy" @click="build">
            <RefreshCw class="size-3.5" :class="{ 'animate-spin': busy }" />{{
              busy ? 'Rebuilding…' : 'Rebuild sheet'
            }}
          </button></template
        >
        <template v-else
          ><div class="saved-character"><Check class="size-4" /> Saved to Characters</div>
          <VButton variant="primary" @click="returning ? emit('saved') : emit('useVideo')"
            >{{ returning ? 'Use in prompt' : 'Use in a video'
            }}<ArrowRight class="size-4" /></VButton
        ></template>
        <p v-if="error" role="alert" class="character-error">{{ error }}</p>
      </aside>
    </div>
    <VModal v-model:open="previewOpen" :title="`${character.name} · reference sheet`" wide
      ><img
        v-if="character.sheetUrl"
        :src="character.sheetUrl"
        :alt="`${character.name} reference sheet`"
        class="w-full rounded-xl"
    /></VModal>
  </div>
</template>
<style scoped>
.sheet-heading h2 {
  font-size: 23px;
  font-weight: 550;
  letter-spacing: -0.6px;
  margin-bottom: 8px;
}
.sheet-heading p {
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
  margin-bottom: 28px;
}
.sheet-heading p span {
  color: #b5cbbb;
}
.sheet-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 28px;
  align-items: start;
}
.sheet-canvas {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #191b1c;
}
.sheet-image {
  display: block;
  width: 100%;
  cursor: zoom-in;
}
.sheet-image img {
  width: 100%;
}
.sheet-draft {
  padding: 20px;
  background: #eae8e2;
}
.sheet-row > span {
  color: #5d625e;
  font-size: 10px;
  display: block;
  margin-bottom: 8px;
}
.sheet-row + .sheet-row {
  margin-top: 18px;
}
.sheet-row > div {
  display: flex;
  gap: 8px;
}
.sheet-row img {
  min-width: 0;
  flex: 1;
  width: 0;
  height: 130px;
  object-fit: contain;
  background: #deddd7;
  border-radius: 3px;
}
.sheet-row:nth-child(2) img {
  height: 220px;
}
.sheet-draft-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 20px;
  font-size: 11px;
  color: #727971;
}
.sheet-caption {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 13px 16px;
  font-size: 10px;
  color: var(--ink-3);
}
.sheet-caption a {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ink-2);
}
.sheet-details {
  display: flex;
  flex-direction: column;
  gap: 18px;
  border: 1px solid var(--line);
  padding: 20px;
  border-radius: 16px;
  background: #191b1c;
}
.sheet-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sheet-identity img {
  width: 44px;
  height: 48px;
  object-fit: cover;
  border-radius: 8px;
}
.sheet-identity strong {
  display: block;
  font-weight: 500;
  font-size: 15px;
}
.sheet-identity span {
  display: block;
  font-size: 12px;
  color: #a7c4b0;
  margin-top: 4px;
}
.sheet-source {
  border-block: 1px solid var(--line);
  padding-block: 14px;
}
.sheet-source > div {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}
.sheet-source > div + div {
  margin-top: 15px;
}
.sheet-source svg {
  color: #a7c4b0;
}
.sheet-source span {
  flex: 1;
}
.sheet-source small {
  display: block;
  color: var(--ink-3);
  font-size: 10px;
  margin-top: 2px;
}
.sheet-source button {
  color: var(--ink-3);
  font-size: 11px;
}
.sheet-source button:hover {
  color: var(--ink);
}
.sheet-explanation {
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.7;
}
.rebuild-sheet {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 11px;
  color: var(--ink-2);
}
.saved-character {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #a7c4b0;
  font-size: 12px;
}
@media (max-width: 900px) {
  .sheet-layout {
    grid-template-columns: 1fr;
  }
}
</style>
