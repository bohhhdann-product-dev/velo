<script setup lang="ts">
defineProps<{ markOnly?: boolean }>()
</script>

<template>
  <span class="brand" aria-hidden="true" translate="no">
    <svg class="brand-mark" viewBox="0 0 32 32" fill="none">
      <path
        d="M7 6l9 21L26 6M11 6l5 12 6-12"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
      <circle cx="26" cy="6" r="3" fill="var(--accent)" />
    </svg>
    <span v-if="!markOnly" class="sidebar-label">vela<span class="brand-period">.</span></span>
  </span>
</template>
