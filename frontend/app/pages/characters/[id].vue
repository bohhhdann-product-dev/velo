<script setup lang="ts">
import CharacterBuilder from '~/features/characters/CharacterBuilder.vue'
const route = useRoute()
</script>
<template>
  <CharacterBuilder :key="String(route.params.id)" :id="String(route.params.id)" />
</template>
