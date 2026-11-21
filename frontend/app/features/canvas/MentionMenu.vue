<script setup lang="ts">
import { Search, UserRound, Images, ChevronRight, ArrowLeft, Plus, Check } from 'lucide-vue-next'
import type { MentionOption } from '~/entities/studio/prompt'
const props = defineProps<{ options: MentionOption[]; id: string }>()
const query = defineModel<string>('query', { required: true })
const emit = defineEmits<{ pick: [option: MentionOption]; close: []; createCharacter: [] }>()
const view = shallowRef<'root' | 'character' | 'image'>('root')
const active = shallowRef(0)
const list = useTemplateRef<HTMLElement>('list')
type Entry = {
  id: string
  label: string
  section: string
  option?: MentionOption
  category?: 'character' | 'image'
  create?: boolean
}
const entries = computed<Entry[]>(() => {
  const q = query.value.toLowerCase().trim()
  const options = props.options.filter(
    (o) =>
      (!q || `${o.name} ${o.handle}`.toLowerCase().includes(q)) &&
      (view.value === 'root' ||
        (view.value === 'character' ? o.kind === 'character' : o.kind !== 'character')),
  )
  if (q || view.value !== 'root') {
    const seen = new Set<string>()
    const result: Entry[] = options
      .filter((o) => {
        const key = `${o.handle}:${o.url}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((option) => ({ id: option.id, label: option.name, option, section: '' }))
    if (view.value === 'character')
      result.push({ id: 'create', label: 'Create character', create: true, section: '' })
    return result
  }
  return [
    ...options
      .filter((o) => o.connected && o.kind === 'canvas')
      .map((option) => ({ id: option.id, label: option.name, option, section: 'Connected' })),
    { id: 'characters', label: 'Characters', category: 'character', section: 'Library' },
    { id: 'images', label: 'Images', category: 'image', section: 'Library' },
  ]
})
const activeId = computed(() =>
  entries.value.length ? `${props.id}-item-${active.value}` : undefined,
)
watch([query, view], () => {
  active.value = 0
})
watch(active, async () => {
  await nextTick()
  list.value
    ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})
function choose(entry: Entry) {
  if (entry.category) {
    view.value = entry.category
    query.value = ''
    return
  }
  if (entry.create) {
    emit('createCharacter')
    return
  }
  if (entry.option && !entry.option.disabled) emit('pick', entry.option)
}
function back() {
  view.value = 'root'
  query.value = ''
}
function onKeyDown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowLeft' && view.value !== 'root' && !query.value) {
    event.preventDefault()
    back()
    return
  }
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && entries.value.length) {
    event.preventDefault()
    const direction = event.key === 'ArrowDown' ? 1 : -1
    for (let offset = 1; offset <= entries.value.length; offset++) {
      const next =
        (active.value + direction * offset + entries.value.length * 2) % entries.value.length
      if (!entries.value[next]?.option?.disabled) {
        active.value = next
        break
      }
    }
  } else if (['Enter', 'Tab', 'ArrowRight'].includes(event.key)) {
    const entry = entries.value[active.value]
    if (entry && (event.key !== 'ArrowRight' || entry.category)) {
      event.preventDefault()
      choose(entry)
    }
  }
}
defineExpose({ onKeyDown, activeId })
</script>
<template>
  <div class="reference-menu" data-mention-menu @pointerdown.stop @wheel.stop>
    <div v-if="view !== 'root'" class="reference-menu-path">
      <button aria-label="Back to reference categories" @pointerdown.prevent @click="back">
        <ArrowLeft class="size-3.5" /></button
      ><span>{{ view === 'character' ? 'Characters' : 'Images' }}</span>
    </div>
    <label class="reference-search"
      ><Search class="size-4" /><input
        v-model="query"
        aria-label="Search references and characters"
        placeholder="Search"
        :aria-controls="id"
        :aria-activedescendant="activeId"
        @keydown.stop="onKeyDown"
    /></label>
    <div
      ref="list"
      :id="id"
      class="reference-menu-list"
      role="listbox"
      aria-label="References and characters"
    >
      <template v-for="(entry, index) in entries" :key="entry.id">
        <p
          v-if="entry.section && entry.section !== entries[index - 1]?.section"
          class="reference-menu-section"
        >
          {{ entry.section }}
        </p>
        <button
          :id="`${id}-item-${index}`"
          :data-index="index"
          role="option"
          :aria-selected="active === index"
          :disabled="!!entry.option?.disabled"
          :title="entry.option?.disabled || entry.label"
          :class="{ active: active === index, 'create-character-option': entry.create }"
          @pointerdown.prevent
          @pointermove="active = index"
          @click="choose(entry)"
        >
          <img v-if="entry.option" :src="entry.option.url" alt="" />
          <span v-else class="reference-category-icon"
            ><Plus v-if="entry.create" class="size-4" /><UserRound
              v-else-if="entry.category === 'character'"
              class="size-[18px]" /><Images v-else class="size-[18px]"
          /></span>
          <span class="reference-option-copy"
            ><strong>{{ entry.label }}</strong
            ><small v-if="entry.option">@{{ entry.option.handle }}</small></span
          >
          <ChevronRight v-if="entry.category" class="size-4" /><Check
            v-else-if="entry.option?.connected"
            class="size-3.5"
          />
        </button>
      </template>
      <div
        v-if="!entries.some((entry) => entry.option) && view !== 'root'"
        class="reference-menu-empty"
      >
        <UserRound v-if="view === 'character'" class="size-6" />
        <p>
          {{
            query
              ? 'No matches found'
              : view === 'character'
                ? 'Your saved characters will appear here.'
                : 'Upload images to your library or add a reference to the canvas.'
          }}
        </p>
      </div>
      <p v-else-if="!entries.length" class="reference-menu-empty">No matches found</p>
    </div>
  </div>
</template>
<style scoped>
.reference-menu {
  width: 286px;
  max-width: calc(100vw - 32px);
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background: #202223;
  color: var(--ink);
  box-shadow: 0 12px 40px #0008;
  overflow: hidden;
}
.reference-menu-path {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
  font-size: 12px;
  font-weight: 500;
}
.reference-menu-path button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  color: var(--ink-2);
}
.reference-menu-path button:hover {
  background: var(--surface-3);
}
.reference-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--ink-3);
}
.reference-search input {
  background: transparent;
  outline: none;
  color: var(--ink);
  min-width: 0;
  width: 100%;
  font-size: 13px;
}
.reference-search input::placeholder {
  color: var(--ink-3);
}
.reference-menu-list {
  padding: 6px;
  max-height: min(310px, var(--reka-popper-available-height, 310px) - 100px);
  overflow-y: auto;
}
.reference-menu-section {
  padding: 8px 9px 6px;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}
.reference-menu-list button[role='option'] {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 9px;
  min-height: 46px;
  padding: 8px 9px;
  text-align: left;
}
.reference-menu-list button.active {
  background: #ffffff0b;
}
.reference-menu-list button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.reference-menu-list button > img {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 6px;
}
.reference-category-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #9cb8d00b;
  color: #a2b8cb;
}
.reference-option-copy {
  min-width: 0;
  flex: 1;
}
.reference-option-copy strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reference-option-copy small {
  display: block;
  font-size: 10px;
  color: #9eb5a5;
  margin-top: 2px;
}
.reference-menu-list button > svg {
  color: var(--ink-3);
}
.reference-menu-empty {
  padding: 18px 12px;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  color: var(--ink-3);
}
.reference-menu-empty svg {
  margin: 0 auto 10px;
  color: #8c9c90;
}
.reference-menu-list .create-character-option {
  color: #b8d1c0;
}
</style>
