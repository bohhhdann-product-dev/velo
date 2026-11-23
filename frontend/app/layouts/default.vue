<script setup lang="ts">
import {
  ArrowUpRight,
  ChevronLeft,
  Folder,
  Heart,
  Images,
  LayoutGrid,
  Plus,
  Trash2,
  UsersRound,
  ShieldCheck,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import AccountProfile from '~/features/workspace/AccountProfile.vue'
import TokenBalance from '~/features/billing/TokenBalance.vue'
import { useStudioStore } from '~/stores/studio'
import { useBillingStore } from '~/stores/billing'
import { ApiError } from '~/shared/api/workspace'
const studio = useStudioStore()
const billing = useBillingStore()
const route = useRoute()
const collapsed = shallowRef(false)
const pending = shallowRef(false)
async function newProject() {
  if (pending.value) return
  pending.value = true
  try {
    const p = await studio.createProjectAsync()
    await navigateTo(`/p/${p.id}`)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not create the project.')
  } finally {
    pending.value = false
  }
}
async function removeProject(id: string) {
  if (pending.value) return
  pending.value = true
  try {
    const active = route.path === `/p/${id}`
    await studio.deleteProjectAsync(id)
    if (active) await navigateTo(studio.projects[0] ? `/p/${studio.projects[0].id}` : '/studio')
  } catch (cause) {
    toast.error(
      cause instanceof Error ? cause.message : 'Could not delete the project.',
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
  <div class="studio-shell" :class="{ 'sidebar-collapsed': collapsed }">
    <aside class="studio-sidebar">
      <div class="brand-row">
        <NuxtLink to="/studio" class="brand" aria-label="Vela studio">
          <VelaBrand />
        </NuxtLink>
        <button
          class="icon-button sidebar-collapse"
          :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="collapsed = !collapsed"
        >
          <ChevronLeft class="size-4" :class="collapsed ? 'rotate-180' : ''" />
        </button>
      </div>
      <div class="workspace-label sidebar-label">
        <span class="workspace-avatar">{{ studio.live ? 'V' : 'B' }}</span
        ><span>Personal workspace<small>Creative studio</small></span>
      </div>
      <nav class="primary-nav" aria-label="Main navigation">
        <NuxtLink
          v-for="item in [
            { to: '/studio', label: 'Canvas', icon: LayoutGrid },
            { to: '/characters', label: 'Characters', icon: UsersRound },
            { to: '/library', label: 'Library', icon: Images },
            { to: '/favorites', label: 'Favorites', icon: Heart },
          ]"
          :key="item.to"
          :to="item.to"
          :title="item.label"
          class="nav-item"
          :class="{
            active:
              item.to === '/studio' ? route.path.startsWith('/p/') || route.path === '/studio' : route.path.startsWith(item.to),
          }"
          ><component :is="item.icon" class="size-[17px] shrink-0" /><span
            class="sidebar-label"
            >{{ item.label }}</span
          ></NuxtLink
        >
      </nav>
      <div class="project-section">
        <div class="section-heading">
          <span class="sidebar-label">Projects</span
          ><button
            class="icon-button"
            title="New project"
            aria-label="New project"
            :disabled="pending"
            @click="newProject"
          >
            <Plus class="size-4" />
          </button>
        </div>
        <div
          v-for="item in studio.projects"
          :key="item.id"
          class="project-link"
          :class="{ active: route.path === `/p/${item.id}` }"
        >
          <NuxtLink :to="`/p/${item.id}`" :title="item.title"
            ><Folder class="size-4 shrink-0" /><span class="sidebar-label truncate">{{
              item.title
            }}</span></NuxtLink
          >
          <button
            class="project-delete icon-button"
            :disabled="pending"
            :aria-label="`Delete ${item.title}`"
            @click="removeProject(item.id)"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
        <button class="new-project sidebar-label" :disabled="pending" @click="newProject">
          <Plus class="size-4" /> New project
        </button>
      </div>
      <div class="sidebar-bottom">
        <NuxtLink v-if="billing.wallet?.isAdmin" to="/vl-admin-panel" class="nav-item" title="Admin panel">
          <ShieldCheck class="size-[17px] shrink-0" /><span class="sidebar-label">Admin panel</span>
        </NuxtLink>
        <TokenBalance />
        <div class="workspace-note sidebar-label">
          <span class="status-dot" />
          {{ studio.live ? 'Your workspace' : 'Demo workspace' }}
          <p>
            {{
              studio.live
                ? 'Your work saves automatically.'
                : 'Explore freely. Refresh to start over.'
            }}
          </p>
        </div>
        <AccountProfile v-if="studio.live" />
        <div v-else class="profile-row">
          <span class="profile-avatar">V</span
          ><span class="sidebar-label">Demo workspace<small>Personal account</small></span
          ><ArrowUpRight class="size-4 text-ink-3 sidebar-label" />
        </div>
      </div>
    </aside>
    <main class="min-w-0 flex-1"><slot /></main>
  </div>
</template>
