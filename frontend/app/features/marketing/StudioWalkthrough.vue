<script setup lang="ts">
import VelaBrand from '~/shared/ui/VelaBrand.vue'
import { ArrowRight, ImageIcon, Link2, Check } from 'lucide-vue-next'
const active = shallowRef(0)
const steps = [
  {
    title: 'Find the look for the clip',
    text: 'Use style references for a lifestyle Reel, a travel Story or a fitness clip. Bring images that show the outfit, setting and framing you want.',
  },
  {
    title: 'Build the scene around your creator',
    text: 'Choose your creator with @, connect the references and describe the action. Add a new hook or change the setting for another idea.',
  },
  {
    title: 'Keep your content ideas together',
    text: 'Arrange ideas for the next batch of Reels, Stories or Shorts on one canvas. Your project saves as you work, so you can return to the same references.',
  },
]
</script>
<template>
  <section id="studio" class="walkthrough public-wrap" aria-labelledby="studio-heading">
    <div class="walkthrough-heading">
      <h2 id="studio-heading">References for the content you want to make.</h2>
      <p>Explore different looks for the same creator. Keep each style reference beside the scene, from an everyday lifestyle clip to a trend-inspired idea.</p>
    </div>
    <div class="walkthrough-layout">
      <div class="walkthrough-steps" aria-label="Explore the studio workflow">
        <button
          v-for="(step, index) in steps"
          :key="step.title"
          :aria-pressed="active === index"
          aria-controls="walkthrough-stage"
          class="walkthrough-step"
          @click="active = index"
        >
          <span class="step-copy"
            ><strong>{{ step.title }}</strong
            ><span>{{ step.text }}</span></span
          ><ArrowRight class="step-arrow" aria-hidden="true" />
        </button>
      </div>
      <div
        id="walkthrough-stage"
        class="studio-study"
        role="region"
        aria-label="Illustrated studio walkthrough"
      >
        <div class="study-header">
          <VelaBrand mark-only /><span>Coastal lifestyle Reel</span>
        </div>
        <div class="study-content">
          <div v-if="active === 0" class="reference-study" key="references">
            <figure class="study-reference portrait-ref">
              <figcaption><ImageIcon aria-hidden="true" /> Mara</figcaption>
              <img
                src="/landing/portrait-560.webp"
                alt="Portrait reference of Mara, a fictional woman with a short dark bob"
                width="560"
                height="700"
                loading="lazy"
              /><span class="reference-handle" translate="no">@mara</span>
            </figure>
            <figure class="study-reference place-ref">
              <figcaption><ImageIcon aria-hidden="true" /> Somewhere by the sea</figcaption>
              <img
                src="/landing/wide-800.webp"
                alt="A sunlit chalk coast and turquoise sea"
                width="800"
                height="450"
                loading="lazy"
              /><span class="reference-handle" translate="no">@coast</span>
            </figure>
          </div>
          <div v-else-if="active === 1" class="prompt-study" key="prompt">
            <div class="prompt-refs">
              <img
                src="/landing/portrait-560.webp"
                alt=""
                width="56"
                height="64"
                loading="lazy"
              /><img
                src="/landing/wide-800.webp"
                alt=""
                width="90"
                height="64"
                loading="lazy"
              /><span>References in this scene</span>
            </div>
            <div class="study-prompt">
              <span class="prompt-label">Prompt</span>
              <p>
                <mark translate="no">@mara</mark> at <mark translate="no">@coast</mark>, walking by the sea with yellow silk in the
                breeze. Afternoon light.
              </p>
              <div class="prompt-bottom">
                <span><Link2 aria-hidden="true" /> References connected</span
                ><span>9:16</span>
              </div>
            </div>
          </div>
          <div v-else class="connection-study" key="connections">
            <div class="connection-source">
              <img
                src="/landing/portrait-560.webp"
                alt="Mara character reference"
                width="100"
                height="125"
                loading="lazy"
              /><span translate="no">@mara</span>
            </div>
            <div class="connection-line" aria-hidden="true" />
            <div class="connection-story">
              <img
                src="/landing/scene-800.webp"
                alt="Concept frame: Mara holding yellow silk at the shore"
                width="800"
                height="450"
                loading="lazy"
              /><img
                src="/landing/wide-800.webp"
                alt="Concept frame: Mara walking along the coast"
                width="800"
                height="450"
                loading="lazy"
              />
            </div>
            <span class="connection-label"
              ><Check aria-hidden="true" /> References connected</span
            >
          </div>
        </div>
        <div class="study-footer">
          <span aria-live="polite"
            >{{ ['References', 'Prompt', 'Canvas'][active] }}</span
          ><span>Canvas example</span>
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.walkthrough {
  padding-block: 88px;
}
.walkthrough-heading,
.walkthrough-layout {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 60px;
}
.walkthrough-heading {
  margin-bottom: 40px;
}
.walkthrough-heading > p {
  align-self: end;
  max-width: 46ch;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 1.75;
}
.walkthrough-heading h2 {
  font-size: clamp(32px, 3.5vw, 48px);
  line-height: 1.15;
  letter-spacing: -0.03em;
  font-weight: 600;
  text-wrap: balance;
}
.walkthrough-layout {
  align-items: center;
}
.walkthrough-step {
  display: flex;
  gap: 16px;
  width: 100%;
  text-align: left;
  padding: 26px 0;
  border-top: 1px solid var(--rule);
  align-items: baseline;
  color: var(--print-muted);
}
.walkthrough-step:hover .step-copy strong {
  text-decoration: underline;
  text-underline-offset: 5px;
}
.walkthrough-step[aria-pressed='true'] {
  color: var(--print);
}
.step-copy {
  flex: 1;
}
.step-copy strong {
  display: block;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.03em;
}
.step-copy > span {
  display: block;
  font-size: 15px;
  line-height: 1.7;
  margin-top: 12px;
  color: var(--print-muted);
  max-width: 310px;
}
.step-arrow {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
.walkthrough-step[aria-pressed='true'] .step-arrow {
  color: var(--accent);
}
.studio-study {
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-media);
  overflow: hidden;
}
.study-header {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 16px 20px;
  font-size: 13px;
  border-bottom: 1px solid var(--line);
}
.study-content {
  height: 350px;
  background-image: radial-gradient(#ffffff12 1px, transparent 1px);
  background-size: 18px 18px;
  padding: 28px;
}
.reference-study,
.prompt-study,
.connection-study {
  height: 100%;
  position: relative;
}
.reference-study {
  display: flex;
  gap: 34px;
  justify-content: center;
  align-items: flex-start;
}
.study-reference {
  position: relative;
  min-width: 0;
}
.study-reference figcaption {
  display: flex;
  gap: 7px;
  align-items: center;
  margin-bottom: 9px;
  font-size: 10px;
  color: var(--ink);
}
.study-reference figcaption svg {
  width: 12px;
  height: 12px;
}
.study-reference img {
  width: 100%;
  object-fit: cover;
  border-radius: var(--radius-media);
  border: 1px solid var(--line-strong);
}
.portrait-ref {
  width: 33%;
  max-width: 168px;
}
.portrait-ref img {
  aspect-ratio: 4/5;
  height: auto;
}
.place-ref {
  width: 48%;
  max-width: 240px;
  margin-top: 36px;
}
.place-ref img {
  aspect-ratio: 4/3;
  height: auto;
}
.reference-handle {
  display: inline-block;
  margin-top: 10px;
  padding: 3px 8px;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 4px;
  font-size: 10px;
}
.prompt-study {
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-width: 440px;
  margin-inline: auto;
}
.prompt-refs {
  display: flex;
  gap: 9px;
  align-items: center;
  margin-bottom: 18px;
}
.prompt-refs img {
  height: 56px;
  width: auto;
  object-fit: cover;
  border-radius: var(--radius-control);
}
.prompt-refs span {
  font-size: 10px;
  line-height: 1.6;
  color: var(--ink-2);
  margin-left: 5px;
}
.study-prompt {
  border: 1px solid var(--edge-output);
  border-radius: var(--radius-media);
  padding: 19px;
  background: var(--surface-2);
}
.prompt-label {
  font-size: 10px;
  color: var(--ink-2);
}
.study-prompt p {
  font-size: 16px;
  line-height: 1.7;
  margin: 10px 0 16px;
}
.study-prompt mark {
  background: var(--accent-soft);
  color: var(--accent);
  padding: 2px 4px;
  border-radius: 4px;
}
.prompt-bottom {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-2);
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.prompt-bottom > span:first-child {
  display: flex;
  gap: 6px;
  align-items: center;
}
.prompt-bottom svg {
  width: 12px;
  height: 12px;
}
.connection-study {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-bottom: 30px;
}
.connection-source {
  width: 24%;
  flex-shrink: 0;
}
.connection-source img {
  width: 100%;
  height: auto;
  border-radius: var(--radius-media);
}
.connection-source span {
  display: block;
  font-size: 11px;
  color: var(--accent);
  margin-top: 7px;
}
.connection-line {
  width: 14%;
  height: 1px;
  background: var(--edge-output);
  position: relative;
  margin-top: -20px;
}
.connection-line::before,
.connection-line::after {
  content: '';
  width: 7px;
  height: 7px;
  background: var(--edge-output);
  border-radius: 50%;
  position: absolute;
  top: -3px;
}
.connection-line::after {
  right: 0;
}
.connection-story {
  width: 55%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.connection-story img {
  border-radius: var(--radius-media);
  width: 100%;
  height: 120px;
  object-fit: cover;
}
.connection-label {
  position: absolute;
  bottom: 0;
  display: flex;
  gap: 7px;
  align-items: center;
  color: var(--ink-2);
  font-size: 11px;
}
.connection-label svg {
  width: 13px;
  height: 13px;
}
.study-footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 15px 20px;
  font-size: 12px;
  color: var(--ink-2);
  border-top: 1px solid var(--line);
}
@media (min-width: 1600px) {
  .study-content {
    height: 400px;
  }
}
@media (max-width: 1000px) {
  .walkthrough-layout,
  .walkthrough-heading {
    gap: 32px;
    grid-template-columns: 1fr 1.3fr;
  }
  .study-content {
    padding: 22px;
  }
  .reference-study {
    gap: 20px;
  }
  .step-copy strong {
    font-size: 16px;
  }
}
@media (max-width: 760px) {
  .walkthrough-step:not([aria-pressed='true']) .step-copy > span {
    display: none;
  }
  .walkthrough {
    padding-block: 64px;
  }
  .walkthrough-heading {
    display: block;
    margin-bottom: 24px;
  }
  .walkthrough-heading > p {
    margin-top: 20px;
  }
  .walkthrough-layout {
    display: flex;
    flex-direction: column;
    gap: 28px;
    align-items: stretch;
  }
  .walkthrough-steps {
    display: flex;
    flex-direction: column;
  }
  .walkthrough-step {
    padding-block: 18px;
  }
  .step-copy > span {
    max-width: none;
  }
  .studio-study {
    width: 100%;
  }
  .study-content {
    height: 330px;
  }
  .portrait-ref {
    max-width: 140px;
  }
  .place-ref {
    max-width: 200px;
  }
}
@media (max-width: 380px) {
  .study-content {
    padding: 18px;
    height: 310px;
  }
  .study-header {
    padding: 14px;
    gap: 9px;
  }
  .study-prompt {
    padding: 14px;
  }
  .study-prompt p {
    font-size: 14px;
  }
  .study-footer {
    padding: 12px;
    font-size: 11px;
  }
}
</style>
