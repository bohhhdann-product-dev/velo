<script setup lang="ts">
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import RecoveryNotice from './RecoveryNotice.vue'
import { createDraftRecovery, type RecoveryDraft } from '~/shared/persistence/recovery'
import { UserButton } from '@clerk/nuxt/components'
import StudioEntrance from '~/features/marketing/StudioEntrance.vue'
import { useAuth } from '@clerk/nuxt/composables'
import { useWorkspaceStore } from '~/stores/workspace'
import { useStudioStore } from '~/stores/studio'
import { useCharactersStore } from '~/stores/characters'
import type { LibraryItem, Project, Generation } from '~/entities/studio/types'
import type { GenerationCapabilities } from '~/entities/studio/generation'
import type { Character } from '~/entities/character/types'
const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth()
const workspace = useWorkspaceStore()
const studio = useStudioStore()
const characters = useCharactersStore()
const recovery = createDraftRecovery()
const recoverable = ref<RecoveryDraft[]>([])
let confirmedUser: string | null = null
const ready = shallowRef(false)
const error = shallowRef('')
const authTimedOut = shallowRef(false)
let authTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
  authTimer = setTimeout(() => {
    if (!isLoaded.value) authTimedOut.value = true
  }, 15000)
})
function retryAuth() {
  window.location.reload()
}
const unsaved = computed(() =>
  [...Object.values(studio.saveStates), ...Object.values(characters.saveStates)].some(
    (state) => state.status !== 'saved',
  ),
)
function guardUnload(event: BeforeUnloadEvent) {
  if (!unsaved.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', guardUnload))
let epoch = 0
async function load() {
  const current = ++epoch
  ready.value = false
  error.value = ''
  if (isLoaded.value) {
    const nextUser = isSignedIn.value ? (userId.value ?? null) : null
    if (confirmedUser && confirmedUser !== nextUser) recovery.clearUser(confirmedUser)
    confirmedUser = nextUser
  }
  recoverable.value = []
  workspace.disconnect()
  studio.resetPrivate()
  characters.resetPrivate()
  if (!isLoaded.value || !isSignedIn.value || !userId.value) return
  workspace.connect(userId.value, () => getToken.value())
  try {
    const [bootstrap, assets, people] = await Promise.all([
      workspace.request<{
        user: { id: string }
        projects: Project[]
        generations: Generation[]
        generation: GenerationCapabilities
        generationEnabled: boolean
      }>('/api/bootstrap'),
      workspace.request<{ assets: LibraryItem[] }>('/api/assets'),
      workspace.request<{ characters: Character[] }>('/api/characters'),
    ])
    if (current !== epoch) return
    if (bootstrap.user.id !== userId.value)
      throw new Error('The workspace account does not match your session.')
    recoverable.value = recovery.list(userId.value!)
    studio.hydrateLive(
      bootstrap.projects,
      assets.assets,
      bootstrap.generations,
      bootstrap.generation,
    )
    characters.hydrateLive(people.characters)
    ready.value = true
  } catch (cause) {
    if (current === epoch)
      error.value =
        cause instanceof Error ? cause.message : 'Could not open your workspace.'
  }
}
watch([isLoaded, isSignedIn, userId, sessionId], load, {
  immediate: true,
  flush: 'sync',
})
onBeforeUnmount(() => {
  clearTimeout(authTimer)
  window.removeEventListener('beforeunload', guardUnload)
  ++epoch
  workspace.disconnect()
  studio.resetPrivate()
  characters.resetPrivate()
})
</script>
<template>
  <div v-if="authTimedOut && !isLoaded" class="workspace-gate vela-public entrance-loading">
    <p role="alert">
      Sign-in is taking longer than expected. Check your connection and try again.
    </p>
    <button class="gate-retry" @click="retryAuth">Try again</button>
    <NuxtLink to="/" class="public-link">Back to Vela</NuxtLink>
  </div>
  <div
    v-else-if="!isLoaded"
    class="workspace-gate vela-public entrance-loading"
    role="status"
  >
    <VelaBrand />
    <p>Opening your studio…</p>
  </div>
  <StudioEntrance v-else-if="!isSignedIn" />
  <div v-else-if="error" class="workspace-gate">
    <h1>We couldn’t open your workspace</h1>
    <p role="alert">{{ error }}</p>
    <button class="gate-retry" @click="load">Try again</button>
    <UserButton />
  </div>
  <div v-else-if="!ready" class="workspace-gate" role="status">Loading your workspace…</div>
  <template v-else>
    <slot :key="userId" />
    <RecoveryNotice
      :drafts="recoverable"
      @handled="(key) => (recoverable = recoverable.filter((draft) => draft.key !== key))"
      @refresh="recoverable = recovery.list(userId!)"
    />
  </template>
</template>
<style scoped>
.workspace-gate {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--ink-2);
  font-size: 14px;
}
.gate-retry {
  padding: 9px 18px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
}
.entrance-loading {
  background: var(--canvas);
  color: var(--ink-2);
}
.entrance-loading .gate-retry {
  border-color: var(--line-strong);
}
</style>
