<script setup lang="ts">
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import { SignIn, SignUp } from '@clerk/nuxt/components'
import { ArrowLeft } from 'lucide-vue-next'
import '~/assets/css/public.css'
// This screen renders outside NuxtPage while authentication is pending.
const route = useRouter().currentRoute
const signingUp = computed(() => route.value.query.auth === 'sign-up')
const appearance = {
  variables: {
    colorPrimary: '#30d158',
    colorBackground: '#1c1d1f',
    colorText: '#eeeef0',
    colorTextSecondary: '#a6a9af',
    colorInputBackground: '#27282b',
    colorInputText: '#eeeef0',
    borderRadius: 'var(--radius-control)',
    fontFamily: 'var(--font-ui)',
  },
  elements: {
    formFieldInput: {
      minHeight: '44px',
      backgroundColor: 'var(--surface-2)',
      color: 'var(--ink)',
    },
    formButtonPrimary: { minHeight: '44px', color: '#09200f', fontWeight: '600' },
    socialButtonsBlockButton: { minHeight: '44px' },
    footerActionLink: { whiteSpace: 'nowrap' },
    cardBox: { boxShadow: 'none', width: '100%', maxWidth: '400px' },
    rootBox: { width: '100%', maxWidth: '400px' },
  },
}
</script>
<template>
  <div class="vela-public studio-entrance">
    <div class="entrance-form-side">
      <header class="entrance-header">
        <NuxtLink to="/" class="public-wordmark" aria-label="Vela home"
          ><VelaBrand /></NuxtLink
        ><NuxtLink to="/" class="entrance-back"
          ><ArrowLeft aria-hidden="true" /> Back to Vela</NuxtLink
        >
      </header>
      <main class="entrance-main">
        <SignUp
          v-if="signingUp"
          :key="`up:${route.path}`"
          routing="hash"
          :sign-in-url="route.path"
          :force-redirect-url="route.path"
          :appearance="appearance"
        />
        <SignIn
          v-else
          :key="`in:${route.path}`"
          routing="hash"
          :sign-up-url="`${route.path}?auth=sign-up`"
          :force-redirect-url="route.path"
          :appearance="appearance"
        />
        <p class="entrance-preview">
          Prepare your next Reel, Story or Short.<br />Generation is coming soon; you can set up characters and references now.
        </p>
      </main>
      <footer class="entrance-bottom">SFW content for creators and teams.</footer>
    </div>
    <aside class="entrance-art" aria-label="Vela concept artwork">
      <img
        src="/landing/scene-1672.webp"
        alt="A woman holding yellow silk in the sea breeze"
        width="1672"
        height="941"
      />
      <div>
        <p>A coastal lifestyle concept</p>
        <span class="art-disclosure">Visual reference featuring a fictional creator</span>
      </div>
    </aside>
  </div>
</template>
<style scoped>
.studio-entrance {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 100dvh;
}
.entrance-form-side {
  display: flex;
  flex-direction: column;
  padding: 28px 40px;
  min-width: 0;
}
.entrance-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.entrance-back {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  min-height: 44px;
  color: var(--print-muted);
}
.entrance-back svg {
  width: 13px;
  height: 13px;
}
.entrance-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px 0 32px;
  width: min(100%, 400px);
  margin-inline: auto;
}
.entrance-preview {
  font-size: 13px;
  line-height: 1.9;
  color: var(--print-muted);
  text-align: center;
  margin-top: 24px;
}
.entrance-bottom {
  font-size: 12px;
  color: var(--print-muted);
}
.entrance-art {
  position: relative;
  min-height: 100%;
  overflow: hidden;
  background: #8b9582;
}
.entrance-art > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 70% center;
}
.entrance-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, #1e281cb3, transparent 65%);
}
.entrance-art > div {
  position: absolute;
  bottom: 55px;
  left: 45px;
  right: 35px;
  z-index: 1;
  color: #fffdf4;
}
.entrance-art p {
  font-size: clamp(32px, 3vw, 44px);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.04em;
  margin-top: 24px;
}
.art-disclosure {
  display: block;
  font-size: 13px;
  margin-top: 12px;
}
@media (max-width: 850px) {
  .studio-entrance {
    grid-template-columns: 1fr;
  }
  .entrance-art {
    display: none;
  }
  .entrance-form-side {
    padding: 20px 24px;
    min-height: 100dvh;
  }
  .entrance-main {
    padding-top: 40px;
  }
  .entrance-bottom {
    text-align: center;
    margin-top: 12px;
  }
}
@media (max-width: 380px) {
  .entrance-form-side {
    padding: 18px 12px;
  }
  .entrance-header {
    padding-inline: 6px;
  }
  .entrance-main :deep(.cl-card) {
    padding-inline: 20px;
  }
  .entrance-main :deep(.cl-footer) {
    padding-inline: 18px;
  }
}
</style>
