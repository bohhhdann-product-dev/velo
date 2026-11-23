<script setup lang="ts">
import { ArrowRight, Check, ScanFace, PersonStanding } from 'lucide-vue-next'
import CharacterPhotoSlot from './CharacterPhotoSlot.vue'
import VButton from '~/shared/ui/VButton.vue'
import {
  PHOTO_ANGLES,
  type Character,
  type CharacterPhoto,
  type PhotoStage,
  type PhotoAngle,
} from '~/entities/character/types'
const props = defineProps<{ character: Character; stage: PhotoStage }>()
const emit = defineEmits<{
  photo: [angle: PhotoAngle, photo: CharacterPhoto | null]
  notes: [text: string]
  approve: []
  busy: [value: boolean]
}>()
const isFace = computed(() => props.stage === 'face')
const current = computed(() => props.character[props.stage])
const front = computed(() => current.value.photos.front)
const uploads = ref<Partial<Record<PhotoAngle, boolean>>>({})
const uploading = computed(() => Object.values(uploads.value).some(Boolean))
watch(uploading, (value) => emit('busy', value), { flush: 'sync' })
onBeforeUnmount(() => emit('busy', false))
</script>
<template>
  <div class="character-stage-grid">
    <section class="photo-workspace">
      <div class="stage-heading">
        <h2>{{ isFace ? 'Start with your face' : 'Keep the whole picture' }}</h2>
        <p>
          {{
            isFace
              ? 'Add a clear front portrait. More angles help keep your identity consistent.'
              : 'Add a full-length photo in your everyday clothes. Your approved face stays the identity reference.'
          }}
        </p>
      </div>
      <div class="photo-grid">
        <CharacterPhotoSlot
          v-for="angle in PHOTO_ANGLES"
          :key="`${stage}-${angle.id}`"
          :label="angle[stage]"
          :photo="current.photos[angle.id]"
          :required="angle.id === 'front'"
          :body="!isFace"
          @change="emit('photo', angle.id, $event)"
          @busy="uploads[angle.id] = $event"
        />
      </div>
      <p class="upload-spec">
        Drop photos into a frame or click to upload · JPG, PNG, WebP · 12 MB
      </p>
      <label class="character-field"
        ><span>{{ isFace ? 'Details to keep' : 'Build & appearance' }} <small>Optional</small></span
        ><textarea
          :value="current.notes"
          maxlength="1000"
          :placeholder="
            isFace
              ? 'Glasses, freckles, hairstyle — anything that makes you, you.'
              : 'Natural proportions, posture, clothing or other details to preserve.'
          "
          @input="emit('notes', ($event.target as HTMLTextAreaElement).value)"
        />
      </label>
      <div class="stage-actions">
        <span v-if="uploading" class="step-requirement" role="status">Uploading photos…</span>
        <span v-else-if="current.approved" class="approved-note"
          ><Check class="size-3.5" /> Approved</span
        ><span v-else class="step-requirement">{{
          front ? 'Review your references, then continue.' : 'Add the front photo to continue.'
        }}</span
        ><VButton variant="primary" :disabled="!front || uploading" @click="emit('approve')"
          >{{ isFace ? 'Approve face' : 'Approve body' }}<ArrowRight class="size-4"
        /></VButton>
      </div>
    </section>
    <aside class="character-preview">
      <div class="preview-heading">
        <span>{{ isFace ? 'Face reference' : 'Body reference' }}</span
        ><span class="preview-badge">{{ front ? 'Your photo' : 'Preview' }}</span>
      </div>
      <div class="portrait-preview" :class="{ 'body-preview': !isFace }">
        <img
          v-if="front"
          :src="front.url"
          :alt="isFace ? 'Your face reference' : 'Your body reference'"
        />
        <div v-else class="portrait-placeholder">
          <component :is="isFace ? ScanFace : PersonStanding" /><span>{{
            isFace ? 'Your identity starts here' : 'Your silhouette, your proportions'
          }}</span>
        </div>
      </div>
      <div v-if="!isFace && character.face.photos.front" class="approved-face">
        <img :src="character.face.photos.front.url" alt="Approved face" />
        <div><strong>Approved face</strong><span>Used with your body references</span></div>
        <Check class="size-4" />
      </div>
      <div v-else class="preview-caption">
        <strong>{{ character.name }}</strong
        ><span>@{{ character.handle }}</span>
      </div>
    </aside>
  </div>
</template>
<style scoped>
.character-stage-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.78fr);
  gap: 40px;
  align-items: start;
}
.stage-heading {
  margin-bottom: 24px;
}
.stage-heading h2 {
  font-size: 23px;
  font-weight: 550;
  letter-spacing: -0.6px;
  margin-bottom: 8px;
}
.stage-heading p {
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.7;
  max-width: 480px;
}
.photo-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.upload-spec {
  font-size: 10px;
  color: var(--ink-3);
  margin: 12px 0 24px;
}
.stage-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}
.step-requirement,
.approved-note {
  color: var(--ink-3);
  font-size: 11px;
}
.approved-note {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #a7c4b0;
}
.character-preview {
  position: sticky;
  top: 24px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: #191b1c;
}
.preview-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 2px 14px;
  font-size: 12px;
  color: var(--ink-2);
}
.preview-badge {
  font-size: 10px;
  color: var(--ink-3);
}
.portrait-preview {
  height: 365px;
  border-radius: 10px;
  overflow: hidden;
  background: #121415;
}
.portrait-preview > img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.portrait-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  color: #626b65;
}
.portrait-placeholder svg {
  width: 96px;
  height: 96px;
  stroke-width: 0.7;
}
.portrait-placeholder span {
  font-size: 12px;
  color: var(--ink-3);
}
.preview-caption {
  padding: 16px 3px 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
}
.preview-caption strong {
  font-weight: 500;
}
.preview-caption span {
  color: #a7c4b0;
}
.approved-face {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-top: 14px;
}
.approved-face img {
  width: 38px;
  height: 42px;
  object-fit: cover;
  border-radius: 6px;
}
.approved-face div {
  flex: 1;
}
.approved-face strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
}
.approved-face span {
  display: block;
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 3px;
}
.approved-face svg {
  color: #a7c4b0;
}
@media (max-width: 1080px) {
  .character-stage-grid {
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) minmax(230px, 0.7fr);
  }
  .portrait-preview {
    height: 300px;
  }
}
@media (max-width: 760px) {
  .character-stage-grid {
    grid-template-columns: 1fr;
  }
  .character-preview {
    position: static;
  }
  .stage-actions {
    flex-wrap: wrap;
  }
}
</style>
