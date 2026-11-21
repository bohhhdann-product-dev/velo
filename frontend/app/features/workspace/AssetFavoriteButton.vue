<script setup lang="ts">
import { Heart } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useStudioStore } from '~/stores/studio'
const props = defineProps<{ id: string; favorite?: boolean }>()
const studio = useStudioStore()
const pending = shallowRef(false)
async function toggle() {
  if (pending.value) return
  pending.value = true
  try {
    await studio.toggleAssetFavorite(props.id)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Could not update favorite.')
  } finally {
    pending.value = false
  }
}
</script>
<template>
  <button
    class="asset-favorite"
    :aria-label="favorite ? 'Remove from favorites' : 'Add to favorites'"
    :aria-pressed="!!favorite"
    :disabled="pending"
    @click="toggle"
  >
    <Heart class="size-4" :fill="favorite ? 'currentColor' : 'none'" />
  </button>
</template>
<style scoped>
.asset-favorite {
  position: absolute;
  left: 10px;
  top: 10px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #171a1ac9;
  color: #eee;
}
.asset-favorite[aria-pressed='true'] {
  color: #dbbfbb;
}
</style>
