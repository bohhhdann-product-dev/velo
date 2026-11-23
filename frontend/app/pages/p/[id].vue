<script setup lang="ts">
import { Upload, ChevronRight, Layers, Zap } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ProjectSaveStatus from '~/features/workspace/ProjectSaveStatus.vue'
import CanvasBoard from '~/features/canvas/CanvasBoard.vue'
import TakeViewer from '~/features/feed/TakeViewer.vue'
import VModal from '~/shared/ui/VModal.vue'
import type { Generation, Take } from '~/entities/studio/types'
import { REFERENCE_W } from '~/entities/studio/geometry'
import { useStudioStore } from '~/stores/studio'
import { capabilitiesForModel } from '~/entities/studio/generation'

const board = useTemplateRef<InstanceType<typeof CanvasBoard>>('board')
const studio = useStudioStore()
const route = useRoute()

onMounted(() => {
  studio.seed()
  if (!studio.project(projectId.value)) navigateTo('/studio', { replace: true })
})

const projectId = computed(() => String(route.params.id))
const project = computed(() => studio.project(projectId.value))
const referenceImages = computed(() => studio.library.filter((item) => item.mediaType !== 'video'))

/* ------------------------------ title rename ----------------------------- */

const editingTitle = ref(false)
const titleDraft = ref('')
const titleInput = useTemplateRef<HTMLInputElement>('titleInput')
const titleControl = useTemplateRef<HTMLButtonElement>('titleControl')

function startRename() {
  if (!project.value) return
  titleDraft.value = project.value.title
  editingTitle.value = true
  nextTick(() => titleInput.value?.select())
}

function commitRename(restoreFocus = false) {
  if (!editingTitle.value) return
  if (project.value) studio.renameProject(project.value.id, titleDraft.value)
  editingTitle.value = false
  if (restoreFocus) nextTick(() => titleControl.value?.focus({ preventScroll: true }))
}
function cancelRename() {
  editingTitle.value = false
  nextTick(() => titleControl.value?.focus({ preventScroll: true }))
}

/* ---------------------------- reference picker ---------------------------- */

const pickerOpen = ref(false)
const pickerTarget = ref<string | null>(null)
const pickerRequiresIdentityAuthorization = computed(() => {
  const node = project.value?.nodes.find((item) => item.id === pickerTarget.value)
  return node?.type === 'generator' && node.draft.mode === 'video' && !capabilitiesForModel(studio.generationCapabilities, node.draft).characterVideo
})

const pickerPoint = ref<{ x: number; y: number }>()
const pickerSlot = ref<'start' | 'end'>()
function openPicker(
  generatorId: string | null,
  point?: { x: number; y: number },
  slot?: 'start' | 'end',
) {
  pickerPoint.value = point
  pickerSlot.value = slot
  pickerTarget.value = generatorId
  pickerOpen.value = true
}

function placeReference(item: { id?: string; url: string; name: string }) {
  if (!project.value) return
  const target = pickerTarget.value
    ? project.value.nodes.find((n) => n.id === pickerTarget.value)
    : null
  const connectedCount = target
    ? project.value.edges.filter((e) => e.to === target.id).length
    : 0
  const x = target ? target.x - REFERENCE_W - 96 : (pickerPoint.value?.x ?? 80)
  const y = target
    ? target.y + connectedCount * (REFERENCE_W + 48)
    : (pickerPoint.value?.y ?? 80)
  const position = studio.freePosition(project.value.id, x, y, REFERENCE_W, REFERENCE_W + 40)
  const node = studio.addReferenceNode(project.value.id, item, position.x, position.y)
  if (target) studio.connect(project.value.id, node.id, target.id, pickerSlot.value, false)
  pickerOpen.value = false
  nextTick(() => board.value?.focusNodes(target ? [node.id, target.id] : [node.id]))
}

const fileInput = ref<HTMLInputElement | null>(null)

const uploading = shallowRef(false)
async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value) return
  uploading.value = true
  try {
    const item = await studio.uploadLibraryItem(file)
    placeReference(item)
    toast('Added to your library')
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Upload failed.')
  } finally {
    uploading.value = false
  }
}

/* -------------------------------- viewer --------------------------------- */

const viewerTake = ref<Take | null>(null)
const viewerGeneration = ref<Generation | null>(null)

function openTake(takeId: string) {
  const found = studio.findTake(takeId)
  if (!found) return
  viewerTake.value = found.take
  viewerGeneration.value = found.generation
}
</script>

<template>
  <div v-if="project" class="project-workspace">
    <header class="project-header">
      <span class="project-breadcrumb">Projects</span
      ><ChevronRight class="size-3.5 text-ink-3" />
      <input
        v-if="editingTitle"
        ref="titleInput"
        v-model="titleDraft"
        aria-label="Project name"
        maxlength="160"
        class="h-8 rounded-(--radius-xs) bg-surface-2 px-2 text-[15px] font-semibold tracking-tight outline-none"
        @blur="commitRename()"
        @keydown.enter.prevent="commitRename(true)"
        @keydown.escape.prevent="cancelRename"
      />
      <button v-else ref="titleControl" type="button" class="project-title" title="Rename" @click="startRename">
        {{ project.title }}
      </button>
      <span class="header-divider" />
      <span class="canvas-label"><Layers class="size-3.5" /> Canvas</span>
      <div class="project-header-actions">
        <ProjectSaveStatus v-if="studio.live" :id="project.id" />
        <span v-else class="credit-balance"
          ><Zap class="size-3.5" />{{ studio.credits }}<span>credits</span></span
        >
      </div>
    </header>
    <div class="canvas-workspace">
      <div class="canvas-stage">
        <CanvasBoard
          :key="`${project.id}:${studio.reloads[project.id] ?? 0}`"
          ref="board"
          :project-id="project.id"
          @pick-reference="openPicker"
          @open-take="openTake"
        />
      </div>
    </div>

    <!-- reference picker -->
    <VModal v-model:open="pickerOpen" title="Add a reference">
      <p v-if="studio.live && pickerRequiresIdentityAuthorization" class="mb-4 text-xs leading-relaxed text-ink-2">
        Photos of real people require BytePlus-verified assets for video. An ordinary upload does not provide that authorization; non-portrait references can still be used.
      </p>
      <div class="mb-3">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          :disabled="uploading"
          @click="fileInput?.click()"
        >
          <Upload class="size-3.5" />
          {{ uploading ? 'Uploading…' : 'Upload new' }}
        </button>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onUpload" />
      </div>
      <div v-if="referenceImages.length === 0" class="py-6 text-center text-[14px] text-ink-2">
        Your library is empty — upload an image.
      </div>
      <div v-else class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
        <button
          v-for="item in referenceImages"
          :key="item.id"
          type="button"
          class="group relative aspect-square overflow-hidden rounded-(--radius-sm) border border-line transition-colors hover:border-accent"
          @click="placeReference(item)"
        >
          <img :src="item.url" :alt="item.name" class="size-full object-cover" />
          <span
            class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4 text-left text-[11px] font-medium text-white"
          >
            {{ item.name }}
          </span>
        </button>
      </div>
    </VModal>

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
