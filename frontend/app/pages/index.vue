<script setup lang="ts">
import { ArrowUpRight, Plus, Check } from 'lucide-vue-next'
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import StudioWalkthrough from '~/features/marketing/StudioWalkthrough.vue'
import { defaultDraft } from '~/entities/studio/catalog'
import { quoteGeneration } from '~/entities/studio/pricing'
import { formatTokens } from '~/entities/billing/types'
definePageMeta({ layout: 'marketing' })
useSeoMeta({
  title: 'Vela — SFW video studio for Reels, Stories and Shorts',
  description:
    'Plan SFW content for Instagram Reels, Stories and YouTube Shorts. Keep creator photos and style references on one canvas. Explore the early preview.',
  ogTitle: 'Vela — SFW video studio for Reels, Stories and Shorts',
  ogDescription: 'A visual workspace for creators and content teams making SFW short-form video. Prepare characters, collect references and develop your next Reel.',
  ogType: 'website',
  ogImage: '/landing/scene-1672.webp',
  twitterCard: 'summary_large_image',
  themeColor: '#101112',
})
const frame = shallowRef(0)
const frames = [
  {
    image: 'scene',
    name: 'Shoreline',
    alt: 'Mara, a fictional woman in a red dress, lifts yellow silk beside the sea and chalk cliffs',
  },
  {
    image: 'wide',
    name: 'Wide shot',
    alt: 'A wider view of Mara walking along the same sunlit coastline',
  },
]
const currentFrame = computed(() => frames[frame.value]!)
const imageTokens = quoteGeneration({ ...defaultDraft(), count: 1 })!.totalTokens
const videoTokens = quoteGeneration({ ...defaultDraft(), mode: 'video', modelId: 'seedance-2-5', durationS: 5, videoQuality: '720p', count: 1 })!.totalTokens
const questions = [
  {
    title: 'What can I try today?',
    text: 'You can upload photos, build a character for each creator, and plan scenes on a canvas. Image and video generation are not available yet. The preview includes a test token checkout; no money is charged.',
  },
  {
    title: 'Which formats is Vela for?',
    text: 'Vela is being built for safe-for-work Instagram Reels, Stories and YouTube Shorts. Use the canvas to develop lifestyle scenes, travel concepts, fitness ideas or your take on a current trend.',
  },
  {
    title: 'Can I use my creator’s photos and references?',
    text: 'Yes. Upload JPG, PNG or WebP photos you have permission to use. Save face and body references as a character, then add images for the outfit, location or framing you want. Videos featuring real people will require additional identity authorization when generation becomes available.',
  },
  {
    title: 'Which video models are planned?',
    text: 'Seedance and MiniMax are planned for the video workflow. Generation is still being connected, so the preview currently lets you prepare characters and scenes. Seedance estimates are shown below; MiniMax pricing is still being confirmed.',
  },
  {
    title: 'Who can see my projects?',
    text: 'Your projects and uploaded references stay in your signed-in workspace. Other users cannot browse them, and uploads are not added to a public gallery. The creator shown on this page is fictional.',
  },
]
</script>
<template>
  <div>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="landing-header">
      <div class="public-wrap header-inner">
        <NuxtLink to="/" class="public-wordmark" aria-label="Vela home"><VelaBrand /></NuxtLink>
        <nav class="landing-nav" aria-label="Explore Vela">
          <a href="#studio">Studio</a>
          <a href="#characters">Creators</a>
          <a href="#pricing">Models & pricing</a>
        </nav>
        <div class="header-actions">
          <NuxtLink to="/studio" class="login-link">Log in</NuxtLink>
          <NuxtLink to="/studio?auth=sign-up" class="public-button header-try">
            Try Vela <ArrowUpRight aria-hidden="true" />
          </NuxtLink>
        </div>
      </div>
    </header>
    <main id="main" tabindex="-1">
      <section class="hero public-wrap" aria-labelledby="hero-title">
        <div class="hero-intro">
          <h1 id="hero-title">Your studio for Reels, Stories and Shorts.</h1>
          <div class="hero-aside">
            <p>Plan SFW videos for Instagram and YouTube with your creator’s photos. Keep the look, references and scene ideas together as you try new formats.</p>
            <NuxtLink to="/studio?auth=sign-up" class="public-button hero-try">
              Try Vela <ArrowUpRight aria-hidden="true" />
            </NuxtLink>
            <p class="preview-note">Early preview: prepare characters and scenes today. Image and video generation are coming soon.</p>
          </div>
        </div>
        <figure class="hero-study">
          <div class="hero-image-wrap">
            <img
              :src="`/landing/${currentFrame.image}-1672.webp`"
              :srcset="`/landing/${currentFrame.image}-800.webp 800w, /landing/${currentFrame.image}-1672.webp 1672w`"
              sizes="(max-width: 900px) 100vw, calc(100vw - 96px)"
              :alt="currentFrame.alt"
              width="1672"
              height="941"
              fetchpriority="high"
              class="hero-image"
              :class="{ 'wide-view': frame === 1 }"
            />
          </div>
          <figcaption class="hero-caption">
            <div class="example-caption">
              <span>A coastal lifestyle concept</span>
              <span>Visual references featuring a fictional creator</span>
            </div>
            <div class="frame-controls" aria-label="Choose an example frame">
              <button v-for="(item, index) in frames" :key="item.image" :aria-pressed="frame === index" @click="frame = index">
                {{ item.name }}
              </button>
            </div>
          </figcaption>
        </figure>
      </section>
      <StudioWalkthrough />
      <section id="characters" class="character-section" aria-labelledby="character-heading">
        <div class="public-wrap character-layout">
          <figure class="character-file">
            <img
              class="character-photo"
              src="/landing/portrait-560.webp"
              alt="Mara, a fictional creator in a coastal lifestyle concept"
              width="560"
              height="700"
              loading="lazy"
            />
            <figcaption>
              <div class="file-caption"><span>Mara</span><span class="file-handle" translate="no">@mara</span></div>
              <div class="file-steps"><span><Check aria-hidden="true" /> Face</span><span><Check aria-hidden="true" /> Body</span></div>
            </figcaption>
          </figure>
          <div class="character-copy">
            <h2 id="character-heading">Keep each creator’s references ready.</h2>
            <p class="character-description">Save face and body photos as a character. Use <strong>@</strong> to bring those references into your next Reel idea without uploading them again.</p>
            <div class="mention-example" aria-label="Example prompt using a character">
              <span class="mention-chip" translate="no"><img src="/landing/portrait-560.webp" alt="" width="28" height="28" loading="lazy" />@mara</span>
              <span>a coastal walk for a lifestyle Reel, vertical framing</span>
            </div>
            <NuxtLink to="/characters" class="public-link">Create a character <ArrowUpRight aria-hidden="true" /></NuxtLink>
            <p class="character-disclosure">Use photos your creator has approved. Mara is a fictional example, not a customer or a generated video result.</p>
          </div>
        </div>
      </section>
      <section id="pricing" class="production-section public-wrap" aria-labelledby="pricing-heading">
        <div>
          <h2 id="pricing-heading">Tokens for what you create.</h2>
          <p>Buy a pack when you need it. Each generator shows its token price before you start, including additional image references.</p>
        </div>
        <div>
          <dl class="production-details">
            <div><dt>Token packs</dt><dd>10,000 / $10<small>25,000 / $25 · 50,000 / $50</small></dd></div>
            <div><dt>Seedream 5 Pro image</dt><dd>{{ formatTokens(imageTokens) }} tokens<small>1K · one image · up to one reference</small></dd></div>
            <div><dt>Seedance 2.5 video</dt><dd>{{ formatTokens(videoTokens) }} tokens<small>5 seconds · 720p · one video</small></dd></div>
          </dl>
          <p class="pricing-note">1,000 tokens = $1. New accounts receive 500 welcome tokens. Generation is still paused; the local checkout simulates purchases without charging money. MiniMax pricing is being confirmed.</p>
          <NuxtLink to="/billing" class="public-link">View token packs <ArrowUpRight aria-hidden="true" /></NuxtLink>
        </div>
      </section>
      <section id="questions" class="questions-section public-wrap" aria-labelledby="questions-heading">
        <h2 id="questions-heading">Before you sign up</h2>
        <div class="question-list">
          <details v-for="(question, index) in questions" :key="question.title" :open="index === 0">
            <summary>{{ question.title }}<Plus aria-hidden="true" /></summary>
            <p>{{ question.text }}</p>
          </details>
        </div>
      </section>
      <section class="start-section public-wrap" aria-labelledby="start-heading">
        <h2 id="start-heading">Set up your next Reel idea.</h2>
        <NuxtLink to="/studio?auth=sign-up" class="public-button">Try Vela <ArrowUpRight aria-hidden="true" /></NuxtLink>
      </section>
    </main>
    <footer class="landing-footer public-wrap">
      <NuxtLink to="/" class="public-wordmark" aria-label="Vela home"><VelaBrand /></NuxtLink>
      <span>SFW content for creators and teams.</span>
      <a href="#questions">What’s available <ArrowUpRight aria-hidden="true" /></a>
    </footer>
  </div>
</template>
<style scoped>
.skip-link {
  position: fixed;
  top: 12px;
  left: 18px;
  padding: 12px 20px;
  background: var(--ink);
  color: var(--canvas);
  transform: translateY(-150%);
  z-index: 100;
}
.skip-link:focus { transform: none; }
.landing-header { border-bottom: 1px solid var(--line); }
.header-inner {
  min-height: 88px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
}
.landing-nav { display: flex; gap: 32px; margin-inline: auto; }
.landing-nav a, .login-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: 14px;
}
.landing-nav a:hover, .login-link:hover { color: var(--accent); }
.header-actions { display: flex; align-items: center; gap: 24px; }
.header-try {
  min-height: 44px;
  padding: 10px 16px;
  gap: 20px;
  background: var(--surface);
  border-color: var(--line-strong);
  color: var(--ink);
  box-shadow: none;
}
.header-try:hover { background: var(--surface-2); border-color: var(--ink-3); }
.hero { padding-top: 64px; }
.hero-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 72px;
  align-items: end;
  margin-bottom: 44px;
}
.hero h1 {
  max-width: 16ch;
  font-size: clamp(48px, 5.55vw, 80px);
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.035em;
  text-wrap: balance;
}
.hero-aside > p { font-size: 16px; line-height: 1.65; color: var(--ink-2); }
.hero-try { margin-top: 24px; min-width: 180px; }
.hero-aside > .preview-note { font-size: 13px; margin-top: 16px; }
.hero-image-wrap {
  aspect-ratio: 2.25;
  overflow: hidden;
  border-radius: var(--radius-media);
  background: var(--surface);
}
.hero-image { width: 100%; height: 100%; object-fit: cover; object-position: 50% 58%; }
.hero-image.wide-view { object-position: 50% 60%; }
.hero-caption { display: flex; justify-content: space-between; gap: 24px; padding-top: 18px; }
.example-caption { display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
.example-caption > span:last-child { color: var(--ink-2); font-size: 13px; }
.frame-controls { display: flex; align-items: start; gap: 6px; }
.frame-controls button {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  color: var(--ink-2);
  white-space: nowrap;
  font-size: 14px;
}
.frame-controls button:hover { color: var(--ink); background: var(--surface); }
.frame-controls button[aria-pressed='true'] { color: var(--ink); background: var(--surface-2); border-color: var(--line-strong); }
.character-section { background: var(--surface); padding-block: 80px; }
.character-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 80px;
  align-items: center;
}
.character-file {
  width: min(100%, 340px);
  justify-self: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-media);
  padding: 16px;
}
.character-photo { width: 100%; height: auto; border-radius: var(--radius-control); }
.file-caption { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 16px; font-size: 24px; }
.file-handle { font-size: 14px; color: var(--accent); }
.file-steps { display: flex; gap: 20px; margin-top: 12px; font-size: 13px; color: var(--ink-2); }
.file-steps > span { display: flex; align-items: center; gap: 6px; }
.file-steps svg { width: 14px; height: 14px; }
.character-copy h2, .questions-section h2, .production-section h2 {
  font-size: clamp(32px, 3.5vw, 48px);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.03em;
  text-wrap: balance;
}
.character-copy h2 { max-width: 16ch; }
.character-description { margin-top: 24px; max-width: 46ch; font-size: 16px; line-height: 1.75; color: var(--ink-2); }
.character-description strong { color: var(--ink); font-weight: 500; }
.mention-example {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 28px;
  padding: 16px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-control);
  background: var(--canvas);
  font-size: 14px;
  line-height: 1.6;
  max-width: 450px;
}
.mention-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--accent-soft); color: var(--accent); padding: 4px 8px 4px 4px; border-radius: 6px; }
.mention-chip img { border-radius: 4px; object-fit: cover; }
.character-copy .public-link { margin-top: 24px; font-size: 15px; }
.character-disclosure { margin-top: 16px; max-width: 46ch; color: var(--ink-2); font-size: 13px; line-height: 1.6; }
.production-section { display: grid; grid-template-columns: 1fr 1.5fr; gap: 72px; padding-block: 80px; border-bottom: 1px solid var(--line-strong); }
.production-section > div:first-child > p { margin-top: 24px; max-width: 45ch; font-size: 16px; line-height: 1.75; color: var(--ink-2); }
.production-details > div { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; padding-block: 22px; border-bottom: 1px solid var(--line-strong); }
.production-details > div:first-child { border-top: 1px solid var(--line-strong); }
.production-details dt { color: var(--ink-2); font-size: 15px; }
.production-details dd { text-align: right; font-size: 20px; font-weight: 500; }
.production-details small { display: block; margin-top: 4px; font-size: 13px; font-weight: 400; color: var(--ink-2); }
.pricing-note { margin-top: 16px; color: var(--ink-2); font-size: 13px; line-height: 1.6; }
.questions-section { display: grid; grid-template-columns: 1fr 1.5fr; gap: 72px; padding-block: 96px; }
.question-list details { border-bottom: 1px solid var(--line-strong); }
.question-list details:first-child { border-top: 1px solid var(--line-strong); }
.question-list summary { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-block: 24px; font-size: 17px; cursor: pointer; list-style: none; }
.question-list summary::-webkit-details-marker { display: none; }
.question-list summary:hover { color: var(--accent); }
.question-list summary svg { width: 18px; height: 18px; flex-shrink: 0; transition: transform 0.16s; }
.question-list details[open] summary svg { transform: rotate(45deg); }
.question-list details > p { padding: 0 32px 24px 0; font-size: 15px; line-height: 1.8; color: var(--ink-2); }
.start-section { display: flex; align-items: center; justify-content: space-between; gap: 32px; border-top: 1px solid var(--line-strong); padding-block: 48px; }
.start-section h2 { font-size: clamp(26px, 3vw, 36px); font-weight: 500; letter-spacing: -0.025em; text-wrap: balance; }
.start-section .public-button { flex-shrink: 0; min-width: 170px; }
.landing-footer { display: flex; align-items: center; gap: 24px; border-top: 1px solid var(--line); padding-block: 24px; font-size: 13px; color: var(--ink-2); }
.landing-footer > a:last-child { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin-left: auto; }
.landing-footer > a:last-child:hover { color: var(--ink); }
.landing-footer > a:last-child svg { width: 14px; height: 14px; }
@media (max-width: 1100px) {
  .hero-intro { gap: 40px; grid-template-columns: minmax(0, 1fr) 280px; }
  .character-layout { gap: 48px; }
}
@media (max-width: 800px) {
  .header-inner { gap: 24px; min-height: 80px; }
  .landing-nav { gap: 20px; }
  .landing-nav a:last-child { display: none; }
  .hero { padding-top: 40px; }
  .hero-intro { grid-template-columns: 1fr; gap: 24px; }
  .hero h1 { font-size: clamp(48px, 8vw, 64px); max-width: 18ch; }
  .hero-aside { max-width: 52ch; }
  .hero-image-wrap { aspect-ratio: 1.65; }
  .character-layout { gap: 32px; }
  .questions-section, .production-section { gap: 40px; padding-block: 64px; }
}
@media (max-width: 600px) {
  .landing-nav { display: none; }
  .header-actions { margin-left: auto; gap: 16px; }
  .header-try { padding-inline: 12px; gap: 12px; }
  .hero h1 { font-size: clamp(36px, 10vw, 56px); }
  .hero-intro { margin-bottom: 32px; }
  .hero-aside > p { font-size: 15px; }
  .hero-aside > .preview-note { font-size: 13px; max-width: 36ch; }
  .hero-image-wrap { aspect-ratio: 1.2; }
  .hero-image { object-position: 68% center; }
  .hero-image.wide-view { object-position: 50% center; }
  .hero-caption { flex-direction: column; gap: 12px; }
  .frame-controls button { padding-inline: 14px; }
  .character-section { padding-block: 48px; }
  .character-layout { display: flex; flex-direction: column; gap: 36px; }
  .character-file { width: min(100%, 300px); }
  .character-copy h2 { max-width: 17ch; }
  .character-description { margin-top: 20px; }
  .questions-section, .production-section { grid-template-columns: 1fr; gap: 28px; padding-block: 56px; }
  .production-details > div { gap: 16px; }
  .production-details dd { font-size: 18px; }
  .question-list summary { font-size: 16px; padding-block: 20px; }
  .question-list details > p { padding-right: 0; }
  .start-section { flex-direction: column; align-items: flex-start; padding-block: 36px; gap: 24px; }
  .landing-footer { flex-wrap: wrap; gap: 8px 20px; padding-block: 20px; }
  .landing-footer > span { margin-left: auto; }
  .landing-footer > a:last-child { margin-left: 0; }
}
</style>
