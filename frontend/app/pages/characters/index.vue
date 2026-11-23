<script setup lang="ts">
import { Plus, UserRound, ArrowRight, Video, Image as ImageIcon, Trash2, Search, ScanFace } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import VButton from '~/shared/ui/VButton.vue'
import { useCharactersStore } from '~/stores/characters'
import { useStudioStore } from '~/stores/studio'
import { ApiError } from '~/shared/api/workspace'
import { useCharacterPlacement } from '~/features/characters/useCharacterPlacement'
import { characterStep } from '~/entities/character/types'
import { characterVideoBlocked } from '~/entities/studio/generation'
import '~/assets/css/characters.css'
const characters = useCharactersStore()
const studio = useStudioStore()
const videoBlocked = computed(() => studio.live ? characterVideoBlocked(studio.generationCapabilities) : '')
const route = useRoute()
const search = shallowRef('')
const filter = shallowRef<'all' | 'saved' | 'draft'>('all')
const shown = computed(() =>
  characters.items.filter(
    (c) =>
      (filter.value === 'all' || (filter.value === 'saved' ? c.savedAt : !c.savedAt)) &&
      `${c.name} ${c.handle}`.toLowerCase().includes(search.value.toLowerCase()),
  ),
)
const { useInVideo, useInImage } = useCharacterPlacement()
const pending = shallowRef(false)
async function create() {
  if (pending.value) return
  pending.value = true
  try {
    const character = await characters.createAsync()
    await navigateTo({
      path: `/characters/${character.id}`,
      query: route.query,
    })
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not create character.')
  } finally {
    pending.value = false
  }
}
async function remove(id: string) {
  const c = characters.find(id)
  if (!c || pending.value) return
  pending.value = true
  const snapshot = JSON.parse(JSON.stringify(c))
  try {
    await characters.removeAsync(id)
    toast(
      'Character removed',
      characters.live
        ? {}
        : {
            action: {
              label: 'Undo',
              onClick: () => characters.restore(snapshot),
            },
          },
    )
  } catch (cause) {
    toast.error(
      cause instanceof Error ? cause.message : 'Could not remove character.',
      cause instanceof ApiError && cause.status === 410
        ? { duration: Infinity, action: { label: 'Reload workspace', onClick: () => window.location.reload() } }
        : undefined,
    )
  } finally {
    pending.value = false
  }
}
</script>
<template>
  <div class="character-page character-library">
    <header class="characters-heading">
      <div>
        <p class="collection-eyebrow">Your workspace</p>
        <h1>
          Characters<span v-if="characters.items.length">{{ characters.items.length }}</span>
        </h1>
        <p>{{ studio.live ? 'Reviewed references for image generation. Video needs separate identity authorization.' : 'Your face. Your presence. Ready for your next scene.' }}</p>
      </div>
      <VButton variant="primary" :disabled="pending" @click="create"
        ><Plus class="size-4" /> Create character</VButton
      >
    </header>
    <template v-if="characters.items.length"
      ><div class="characters-toolbar">
        <div>
          <button
            v-for="tab in [
              { id: 'all', label: 'All characters' },
              { id: 'saved', label: 'Saved' },
              { id: 'draft', label: 'Drafts' },
            ] as const"
            :key="tab.id"
            :aria-pressed="filter === tab.id"
            @click="filter = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
        <label class="character-search"
          ><Search class="size-3.5" /><input
            v-model="search"
            aria-label="Search characters"
            placeholder="Search characters"
        /></label>
      </div>
      <div class="characters-grid">
        <article v-for="character in shown" :key="character.id" class="character-card">
          <NuxtLink
            :to="{ path: `/characters/${character.id}`, query: route.query }"
            class="character-card-link"
            ><div class="character-cover">
              <img
                v-if="character.face.photos.front"
                :src="character.face.photos.front.url"
                :alt="character.name || 'Character portrait'"
              /><UserRound v-else class="empty-character-icon" /><span
                class="character-card-status"
                :class="{ ready: character.savedAt }"
                >{{ character.savedAt ? 'Saved' : 'Draft' }}</span
              >
            </div>
            <div class="character-card-name">
              <strong>{{ character.name || 'Untitled character' }}</strong
              ><span>{{
                character.handle ? `@${character.handle}` : 'Add your identity'
              }}</span>
            </div></NuxtLink
          >
          <div class="character-card-actions">
            <button v-if="character.savedAt" @click="videoBlocked ? useInImage(character) : useInVideo(character)">
              <component :is="videoBlocked ? ImageIcon : Video" class="size-3.5" /> {{ videoBlocked ? 'Use in image' : 'Use in video' }}</button
            ><NuxtLink v-else :to="{ path: `/characters/${character.id}`, query: route.query }"
              >Continue {{ characterStep(character) }}<ArrowRight class="size-3.5" /></NuxtLink
            ><button
              :aria-label="`Remove ${character.name || 'untitled character'}`"
              :disabled="pending"
              @click="remove(character.id)"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
        </article>
      </div>
      <div v-if="!shown.length" class="characters-no-results">
        <Search class="size-6" />
        <p>No characters match this view.</p>
      </div>
    </template>
    <section v-else class="characters-empty">
      <div class="empty-identity-art">
        <div />
        <div><ScanFace /></div>
        <div />
      </div>
      <p class="character-empty-eyebrow">Made from your own photos</p>
      <h2>You belong in the story.</h2>
      <p>
        Bring a portrait and a full-body photo.<br />Build your character once, then use it in
        any prompt with @.
      </p>
      <VButton variant="primary" :disabled="pending" @click="create"
        >Create your first character<ArrowRight class="size-4" /></VButton
      ><small>{{
        characters.live
          ? 'Your references are saved in your private workspace.'
          : 'Photos stay in this browser session.'
      }}</small>
    </section>
  </div>
</template>
<style scoped>
.character-library {
  padding-top: 42px;
}
.characters-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
}
.characters-heading h1 {
  font-size: 30px;
  font-weight: 550;
  letter-spacing: -1px;
  margin: 7px 0 9px;
}
.characters-heading h1 span {
  margin-left: 12px;
  color: var(--ink-3);
  font-size: 16px;
  font-weight: 400;
}
.characters-heading > div > p:last-child {
  font-size: 13px;
  color: var(--ink-3);
}
.characters-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin: 34px 0 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.characters-toolbar > div {
  display: flex;
  gap: 5px;
}
.characters-toolbar button {
  border-radius: 7px;
  padding: 7px 11px;
  font-size: 12px;
  color: var(--ink-3);
}
.characters-toolbar button[aria-pressed='true'] {
  background: var(--surface-2);
  color: var(--ink);
}
.character-search {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-3);
}
.character-search input {
  background: transparent;
  font-size: 12px;
  width: 150px;
  outline: none;
  color: var(--ink-2);
}
.characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 22px;
}
.character-card {
  max-width: 310px;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #191b1c;
  transition: border-color 0.16s;
}
.character-card:hover {
  border-color: var(--line-strong);
}
.character-cover {
  position: relative;
  aspect-ratio: 4/4.2;
  display: grid;
  place-items: center;
  background: #202522;
}
.character-cover > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.empty-character-icon {
  width: 64px;
  height: 64px;
  stroke-width: 0.8;
  color: #5f7265;
}
.character-card-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 3px 7px;
  background: #111715ce;
  color: #d6d9d6;
  border-radius: 5px;
  font-size: 10px;
}
.character-card-status.ready {
  color: #bfd5c6;
}
.character-card-name {
  padding: 15px 15px 13px;
}
.character-card-name strong {
  display: block;
  font-weight: 500;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.character-card-name span {
  display: block;
  color: #91a596;
  font-size: 11px;
  margin-top: 4px;
}
.character-card-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 13px;
  border-top: 1px solid var(--line);
}
.character-card-actions > * {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-2);
  font-size: 11px;
  padding: 4px 2px;
}
.character-card-actions > *:hover {
  color: var(--ink);
}
.characters-empty {
  min-height: 580px;
  height: calc(100% - 130px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 40px 12px;
}
.empty-identity-art {
  position: relative;
  width: 250px;
  height: 155px;
  margin-bottom: 30px;
}
.empty-identity-art > div {
  position: absolute;
  width: 102px;
  height: 132px;
  border: 1px solid #a7c4b024;
  border-radius: 17px;
  background: linear-gradient(150deg, #2b362e, #181c1a);
}
.empty-identity-art > div:first-child {
  transform: rotate(-14deg);
  left: 15px;
  top: 13px;
  opacity: 0.5;
}
.empty-identity-art > div:last-child {
  transform: rotate(14deg);
  right: 15px;
  top: 13px;
  opacity: 0.5;
}
.empty-identity-art > div:nth-child(2) {
  z-index: 1;
  left: 74px;
  display: grid;
  place-items: center;
}
.empty-identity-art svg {
  width: 52px;
  height: 52px;
  stroke-width: 0.8;
  color: #a7c4b0;
}
.character-empty-eyebrow {
  color: #99b5a2;
  font-size: 11px;
  margin-bottom: 12px;
}
.characters-empty h2 {
  font-weight: 500;
  font-size: 32px;
  letter-spacing: -1px;
}
.characters-empty > p:not(.character-empty-eyebrow) {
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.8;
  margin: 14px 0 26px;
}
.characters-empty > small {
  color: #616d65;
  font-size: 10px;
  margin-top: 18px;
}
.characters-no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 100px 20px;
  color: var(--ink-3);
  font-size: 13px;
}
@media (max-width: 700px) {
  .characters-heading,
  .characters-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .characters-empty {
    min-height: 500px;
  }
  .characters-grid {
    grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  }
}
</style>
