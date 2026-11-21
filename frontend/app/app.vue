<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import 'vue-sonner/style.css'
import WorkspaceGate from '~/features/workspace/WorkspaceGate.vue'
import { useWorkspaceStore } from '~/stores/workspace'
const config = useRuntimeConfig()
const workspace = useWorkspaceStore()
workspace.live = config.public.appMode === 'live'
const configured = Boolean(config.public.clerkPublishableKey)
</script>

<template>
  <div
    v-if="workspace.live && !configured"
    class="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center"
  >
    <h1 class="text-xl">Your workspace needs a sign-in connection</h1>
    <p class="text-ink-2">Set the Clerk publishable key to open Vela in live mode.</p>
  </div>
  <WorkspaceGate v-else-if="workspace.live">
    <NuxtLayout><NuxtPage /></NuxtLayout>
  </WorkspaceGate>
  <NuxtLayout v-else><NuxtPage /></NuxtLayout>
  <Toaster position="bottom-center" :duration="3200" />
</template>
