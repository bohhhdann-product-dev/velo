<script setup lang="ts">
import { PopoverRoot, PopoverAnchor, PopoverPortal, PopoverContent } from 'reka-ui'
import MentionMenu from './MentionMenu.vue'
import { mentionAt, insertMention } from '~/entities/studio/mentions'
import type { MentionOption } from '~/entities/studio/prompt'
const props = defineProps<{ id: string; expanded?: boolean; options: MentionOption[] }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{
  dismiss: []
  commit: []
  submit: []
  mention: [option: MentionOption, range: { start: number; end: number }]
  createCharacter: [range: { start: number; end: number }]
}>()
const field = useTemplateRef<HTMLTextAreaElement>('field')
const menu = useTemplateRef<InstanceType<typeof MentionMenu>>('menu')
const mention = shallowRef<ReturnType<typeof mentionAt>>(null)
const search = shallowRef('')
const listId = useId()
const open = computed({
  get: () => !!mention.value,
  set: (value) => {
    if (!value) mention.value = null
  },
})
function updateMention() {
  const el = field.value
  if (!el) return
  mention.value = mentionAt(el.value, el.selectionStart, el.selectionEnd)
  search.value = mention.value?.query ?? ''
}
function input(event: Event) {
  model.value = (event.target as HTMLTextAreaElement).value
  updateMention()
}
async function pick(option: MentionOption) {
  if (!mention.value || option.disabled) return
  const range = mention.value
  const inserted = insertMention(model.value, range, option.handle)
  emit('mention', option, range)
  mention.value = null
  await nextTick()
  field.value?.focus({ preventScroll: true })
  field.value?.setSelectionRange(inserted.caret, inserted.caret)
}
function closeMentions() {
  mention.value = null
  field.value?.focus({ preventScroll: true })
}
function createCharacter() {
  if (!mention.value) return
  emit('createCharacter', mention.value)
  mention.value = null
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    emit('submit')
    return
  }
  if (mention.value) {
    menu.value?.onKeyDown(event)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('dismiss')
  }
}
function blur() {
  emit('commit')
}
function interactOutside(event: CustomEvent<{ originalEvent: Event }>) {
  if (event.detail.originalEvent.target === field.value) event.preventDefault()
}
</script>
<template>
  <div class="prompt-field" :class="{ expanded }" @pointerdown.stop @keydown.stop @wheel.stop>
    <PopoverRoot v-model:open="open">
      <PopoverAnchor as-child>
        <textarea
          ref="field"
          :id="id"
          :value="model"
          aria-label="Prompt"
          placeholder="Describe your scene. Use @ for characters and references…"
          spellcheck="false"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          :role="mention ? 'combobox' : undefined"
          :aria-expanded="mention ? true : undefined"
          :aria-controls="mention ? listId : undefined"
          :aria-activedescendant="mention ? menu?.activeId : undefined"
          aria-autocomplete="list"
          @input="input"
          @click="updateMention"
          @keyup.left="updateMention"
          @keyup.right="updateMention"
          @keydown="keydown"
          @blur="blur"
        />
      </PopoverAnchor>
      <PopoverPortal
        ><PopoverContent
          class="mention-popover"
          style="z-index: 70"
          align="start"
          :side-offset="8"
          :collision-padding="12"
          prioritize-position
          position-strategy="fixed"
          update-position-strategy="always"
          aria-label="Choose a character or reference"
          data-canvas-popover
          @open-auto-focus.prevent
          @close-auto-focus.prevent
          @interact-outside="interactOutside"
          @escape-key-down.prevent="closeMentions"
          @keydown.stop
          @pointerdown.stop
        >
          <MentionMenu
            ref="menu"
            :id="listId"
            v-model:query="search"
            :options="options"
            @pick="pick"
            @close="closeMentions"
            @create-character="createCharacter"
          /> </PopoverContent
      ></PopoverPortal>
    </PopoverRoot>
  </div>
</template>
<style scoped>
.prompt-field {
  position: relative;
  margin-top: 10px;
}
.prompt-field textarea {
  display: block;
  width: 100%;
  height: 88px;
  margin: 0;
  resize: none;
  background: none;
  color: #dadce0;
  font-size: 13px;
  line-height: 1.65;
  outline: none;
  user-select: text;
}
.prompt-field textarea::placeholder {
  color: #747a83;
}
.expanded textarea {
  height: min(48vh, 420px);
  min-height: 180px;
  max-height: 60vh;
  resize: vertical;
  font-size: 15px;
  line-height: 1.8;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #111314;
}
.expanded textarea:focus {
  border-color: #73997d;
}
.mention-popover {
  outline: none;
}
</style>
