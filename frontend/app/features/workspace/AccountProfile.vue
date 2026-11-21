<script setup lang="ts">
import { UserButton } from '@clerk/nuxt/components'
import { useUser } from '@clerk/nuxt/composables'
const { user } = useUser()
</script>
<template>
  <div class="profile-row">
    <UserButton />
    <span class="sidebar-label"
      >{{ user?.firstName || 'Your account' }}<small>Personal account</small></span
    >
  </div>
</template>
