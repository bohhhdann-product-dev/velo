<script setup lang="ts">
import { ArrowLeft, ArrowRight, Check, ScanFace, PersonStanding, Layers } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import CharacterPhotoStage from './CharacterPhotoStage.vue'
import CharacterSheet from './CharacterSheet.vue'
import { characterAsset, useCharacterPlacement } from './useCharacterPlacement'
import VButton from '~/shared/ui/VButton.vue'
import { CHARACTER_STEPS, characterStep, type CharacterStep } from '~/entities/character/types'
import { mentionAt } from '~/entities/studio/mentions'
import { useCharactersStore } from '~/stores/characters'
import { useStudioStore } from '~/stores/studio'
import { CHARACTER_VIDEO_REASON, capabilitiesForModel } from '~/entities/studio/generation'
import '~/assets/css/characters.css'
const props = defineProps<{ id: string }>()
const characters = useCharactersStore()
const studio = useStudioStore()
const route = useRoute()
const character = computed(() => characters.find(props.id))
const step = shallowRef<CharacterStep>(
  character.value ? characterStep(character.value) : 'identity',
)
const error = shallowRef('')
const page = useTemplateRef<HTMLElement>('page')
const heading = useTemplateRef<HTMLElement>('heading')
const { useInVideo, useInImage } = useCharacterPlacement()
const furthest = computed(() =>
  character.value
    ? CHARACTER_STEPS.findIndex((s) => s.id === characterStep(character.value!))
    : 0,
)
const photoStage = computed(() =>
  step.value === 'face' || step.value === 'body' ? step.value : null,
)
const returnProject = computed(() =>
  typeof route.query.project === 'string' ? studio.project(route.query.project) : undefined,
)
const returnGenerator = computed(() =>
  returnProject.value?.nodes.find((n) => n.id === route.query.node && n.type === 'generator'),
)
const characterUseBlocked = computed(() => studio.live && returnGenerator.value?.type === 'generator' && returnGenerator.value.draft.mode === 'video' && !capabilitiesForModel(studio.generationCapabilities, returnGenerator.value.draft).characterVideo ? CHARACTER_VIDEO_REASON : '')
watch(step, async () => {
  error.value = ''
  await nextTick()
  if (page.value) page.value.scrollTop = 0
  heading.value?.focus({ preventScroll: true })
})
const pending = shallowRef(false)
const uploading = shallowRef(false)
const saveState = computed(() => characters.saveStates[props.id])
const draftStatus = computed(() => {
  if (!characters.live) return 'Draft · This session'
  if (uploading.value) return 'Draft · Uploading photos…'
  switch (saveState.value?.status) {
    case 'saved': return 'Draft · Saved'
    case 'saving': return 'Draft · Saving…'
    case 'conflict': return 'Draft · Needs review'
    case 'error': return 'Draft · Could not save'
    default: return 'Draft · Unsaved changes'
  }
})
function waitForUpload(event?: Event) {
  if (!uploading.value) return true
  event?.preventDefault()
  toast('Wait for your photos to finish uploading before leaving this step.')
  return false
}
onBeforeRouteLeave(() => waitForUpload())
onBeforeRouteUpdate(() => waitForUpload())
async function nextIdentity() {
  error.value = characters.identityError(props.id)
  if (error.value || pending.value) return
  pending.value = true
  try {
    await characters.flush(props.id)
    step.value = 'face'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save your character.'
  } finally {
    pending.value = false
  }
}
async function approve() {
  if (!photoStage.value || pending.value || uploading.value) return
  const stage = photoStage.value
  pending.value = true
  error.value = ''
  try {
    if (await characters.approveAsync(props.id, stage))
      step.value = stage === 'face' ? 'body' : 'sheet'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not approve these photos.'
  } finally {
    pending.value = false
  }
}
async function resolveSave(reload = false) {
  try {
    if (reload) await characters.reload(props.id)
    else await characters.retrySave(props.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save changes.'
  }
}
function saved() {
  const c = character.value,
    generator = returnGenerator.value,
    project = returnProject.value
  if (!c || !project || generator?.type !== 'generator') return
  const requestedEnd = Number(route.query.end)
  const range = Number.isFinite(requestedEnd)
    ? mentionAt(generator.draft.prompt, requestedEnd)
    : null
  const point = range ?? {
    start: generator.draft.prompt.length,
    end: generator.draft.prompt.length,
  }
  const text = range ? generator.draft.prompt : `${generator.draft.prompt.trimEnd()} `
  const result = studio.mentionAsset(
    project.id,
    generator.id,
    characterAsset(c),
    text,
    range ? point : { start: text.length, end: text.length },
  )
  if (!result.ok) {
    toast.error(result.error)
    return
  }
  navigateTo(`/p/${project.id}`)
}
</script>
<template>
  <div ref="page" class="character-page">
    <div v-if="character" class="character-builder">
      <header class="character-header">
        <NuxtLink :to="{ path: '/characters', query: route.query }" class="character-back"
          :aria-disabled="uploading || undefined" @click="waitForUpload"
          ><ArrowLeft class="size-3.5" /> Characters</NuxtLink
        >
        <div class="character-title-row">
          <div>
            <h1>{{ character.name || 'New character' }}</h1>
            <span class="character-status"
              ><i :class="{ saved: character.savedAt }" />{{
                character.savedAt
                  ? 'Saved to your library'
                  : draftStatus
              }}</span
            >
          </div>
          <NuxtLink v-if="returnProject" :to="`/p/${returnProject.id}`" class="character-back"
            :aria-disabled="uploading || undefined" @click="waitForUpload"
            >Back to canvas<ArrowRight class="size-3.5"
          /></NuxtLink>
        </div>
      </header>
      <p v-if="saveState?.status === 'conflict'" role="alert" class="character-error">
        {{ saveState.message || 'Changed in another session. Your edits are still here.' }}
        <button class="underline" @click="resolveSave(true)">Reload saved character</button>
      </p>
      <p v-else-if="saveState?.status === 'error'" role="alert" class="character-error">
        {{ saveState.message }}
        <button class="underline" @click="resolveSave()">Retry</button>
      </p>
      <p v-if="error && step !== 'identity'" role="alert" class="character-error">
        {{ error }}
      </p>
      <nav class="character-steps" aria-label="Character creation steps">
        <button
          v-for="(item, index) in CHARACTER_STEPS"
          :key="item.id"
          :aria-current="step === item.id ? 'step' : undefined"
          :disabled="index > furthest || uploading || pending || characters.busy[id]"
          @click="step = item.id"
        >
          <span
            ><Check v-if="index < furthest" class="size-3.5" /><template v-else>{{
              index + 1
            }}</template></span
          >{{ item.label }}
        </button>
      </nav>
      <fieldset :disabled="pending || characters.busy[id]" class="border-0 min-w-0 p-0">
        <div
          ref="heading"
          tabindex="-1"
          class="character-step-content"
          :aria-label="`${step} step`"
        >
          <div v-if="step === 'identity'" class="identity-layout">
            <section class="identity-form">
              <p class="character-eyebrow">Made from you</p>
              <h2>Your character starts<br />with your own photos.</h2>
              <p class="identity-description">
                {{ studio.live ? 'Keep your reviewed references together for image generation with @mentions. Video requires separate identity authorization, which is not available here yet.' : 'Keep your face, proportions and details together. Save once, then bring yourself into any scene with a single @mention.' }}
              </p>
              <form @submit.prevent="nextIdentity">
                <label class="character-field"
                  ><span>Name</span
                  ><input
                    :value="character.name"
                    maxlength="60"
                    placeholder="What should we call you?"
                    autocomplete="off"
                    @input="
                      characters.updateIdentity(id, {
                        name: ($event.target as HTMLInputElement).value,
                      })
                    " /></label
                ><label class="character-field"
                  ><span>Prompt handle</span>
                  <div class="handle-input">
                    <span>@</span
                    ><input
                      :value="character.handle"
                      maxlength="48"
                      placeholder="your-name"
                      spellcheck="false"
                      autocomplete="off"
                      @input="
                        characters.updateIdentity(id, {
                          handle: ($event.target as HTMLInputElement).value,
                        })
                      "
                    /></div
                ></label>
                <p v-if="error" role="alert" class="character-error">
                  {{ error }}
                </p>
                <VButton type="submit" variant="primary" :disabled="!character.name.trim()"
                  >Continue to face<ArrowRight class="size-4"
                /></VButton>
              </form>
            </section>
            <aside class="identity-outline">
              <div class="identity-symbol"><ScanFace /></div>
              <h3>Recognizably you.</h3>
              <p>One face. One body. One reusable identity.</p>
              <div class="identity-outline-step">
                <ScanFace />
                <div>
                  <strong>Face references</strong
                  ><span>A front portrait, plus optional profiles</span>
                </div>
                <span>01</span>
              </div>
              <div class="identity-outline-step">
                <PersonStanding />
                <div>
                  <strong>Body references</strong
                  ><span>A full-length photo and extra angles</span>
                </div>
                <span>02</span>
              </div>
              <div class="identity-outline-step">
                <Layers />
                <div>
                  <strong>Character sheet</strong
                  ><span>All your approved photos, together</span>
                </div>
                <span>03</span>
              </div>
              <small>{{
                characters.live
                  ? 'Your references are saved in your private workspace.'
                  : 'Photos stay in this browser session.'
              }}</small>
            </aside>
          </div>
          <CharacterPhotoStage
            v-else-if="photoStage"
            :key="photoStage"
            :character="character"
            :stage="photoStage"
            @photo="(angle, photo) => characters.setPhoto(id, photoStage!, angle, photo)"
            @busy="uploading = $event"
            @notes="characters.updateNotes(id, photoStage!, $event)"
            @approve="approve"
          />
          <CharacterSheet
            v-else
            :character="character"
            :returning="!!returnGenerator"
            :use-blocked-reason="characterUseBlocked"
            @saved="saved"
            @use-video="useInVideo(character)"
            @use-image="useInImage(character)"
            @edit="step = $event"
          />
        </div>
      </fieldset>
    </div>
    <div v-else class="collection-empty">
      <h2>This character isn’t here</h2>
      <p>Start a new character in your library.</p>
      <NuxtLink to="/characters" class="character-back">Back to Characters</NuxtLink>
    </div>
  </div>
</template>
<style scoped>
.character-builder {
  max-width: 1080px;
  margin: 0 auto;
}
.character-header {
  margin-bottom: 30px;
}
.character-back {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  gap: 7px;
  color: var(--ink-3);
  font-size: 12px;
}
.character-back:hover {
  color: var(--ink);
}
.character-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-top: 24px;
}
.character-title-row h1 {
  font-size: 28px;
  font-weight: 550;
  letter-spacing: -0.8px;
}
.character-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 11px;
  margin-top: 8px;
}
.character-status i {
  width: 5px;
  height: 5px;
  background: #7d8189;
  border-radius: 50%;
}
.character-status i.saved {
  background: #9ab6a1;
}
.character-steps {
  display: flex;
  border-bottom: 1px solid var(--line);
  gap: 26px;
  margin-bottom: 34px;
}
.character-steps button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 0 16px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  color: var(--ink-3);
  font-size: 12px;
}
.character-steps button > span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  background: var(--surface-2);
  border-radius: 7px;
  font-size: 10px;
}
.character-steps button[aria-current] {
  color: #dae7de;
  border-color: #a7c4b0;
}
.character-steps button[aria-current] > span {
  color: #18251d;
  background: #bed4c3;
}
.character-steps button:disabled {
  opacity: 0.4;
  cursor: default;
}
.character-step-content {
  outline: none;
}
.identity-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.85fr);
  gap: 80px;
  padding-top: 12px;
}
.character-eyebrow {
  color: #a7c4b0;
  font-size: 11px;
  margin-bottom: 16px;
}
.identity-form h2 {
  font-size: clamp(26px, 2.5vw, 34px);
  line-height: 1.2;
  font-weight: 500;
  letter-spacing: -1px;
}
.identity-description {
  margin: 18px 0 28px;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.8;
  max-width: 420px;
}
.identity-form form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.identity-form form > button {
  align-self: flex-start;
  margin-top: 4px;
}
.identity-outline {
  padding: 30px;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: linear-gradient(150deg, #222922, #181b1a 60%);
}
.identity-symbol {
  width: 70px;
  height: 70px;
  display: grid;
  place-items: center;
  border: 1px solid #adc7b325;
  border-radius: 20px;
  color: #a7c4b0;
  margin-bottom: 28px;
}
.identity-symbol svg {
  width: 40px;
  height: 40px;
  stroke-width: 1;
}
.identity-outline h3 {
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.5px;
}
.identity-outline > p {
  color: var(--ink-3);
  font-size: 12px;
  margin: 8px 0 30px;
}
.identity-outline-step {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 17px 0;
  border-top: 1px solid var(--line);
}
.identity-outline-step > svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.3;
  color: #a7b7aa;
}
.identity-outline-step div {
  flex: 1;
}
.identity-outline-step strong {
  display: block;
  font-size: 12px;
  font-weight: 500;
}
.identity-outline-step div span {
  display: block;
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 4px;
}
.identity-outline-step > span {
  color: #657469;
  font-size: 10px;
}
.identity-outline > small {
  display: block;
  font-size: 10px;
  color: #88958a;
  margin-top: 20px;
}
@media (max-width: 1080px) {
  .identity-layout {
    gap: 32px;
  }
}
@media (max-width: 760px) {
  .identity-layout {
    grid-template-columns: 1fr;
  }
  .character-steps {
    gap: 14px;
  }
  .character-steps button {
    gap: 5px;
    font-size: 11px;
  }
  .identity-outline {
    padding: 24px;
  }
}
</style>
