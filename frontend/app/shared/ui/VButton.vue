<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'soft' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'soft', size: 'md', disabled: false, type: 'button' },
)

const classes = computed(() => {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-(--radius-xs) transition-all duration-200 select-none whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none active:scale-[0.97]'
  const sizes = {
    sm: 'h-8 px-3.5 text-[13px]',
    md: 'h-9.5 px-4.5 text-[14px]',
    lg: 'h-11 px-6 text-[15px]',
  }
  const variants = {
    primary: 'bg-accent text-black hover:bg-accent-hover shadow-card',
    soft: 'bg-surface-2 text-ink border border-line hover:border-line-strong',
    ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
    danger: 'bg-danger/10 text-danger hover:bg-danger/15',
  }
  return [base, sizes[props.size], variants[props.variant]]
})
</script>

<template>
  <button :type="type" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
