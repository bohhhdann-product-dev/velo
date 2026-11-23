# Vela landing: research, design and acceptance

Date: 2026-11-21. Scope: public landing and the transition into the existing studio. Local implementation; no deployment, provider activation, paid generation or production account changes.

## What we researched

The research compared the public promise, product evidence, navigation, entry action and first-use friction. Observations below are an interface review, not evidence of conversion performance. Competitor copy and artwork were not reused.

| Product | Observed approach | Decision for Vela |
| --- | --- | --- |
| [Magnific](https://www.magnific.com/) | Magnific.ai now redirects here. The public page positions a broad creative platform, with a “Start creating” entry and examples spanning images, characters, video and workflows. Navigation contains many tools and models. | Show a specific creative process before introducing technical choices. Keep the top-level navigation small. |
| [Krea](https://www.krea.ai/) | Media-led demonstrations pair examples with prompts and task-specific actions. Native browser inspection also encountered a timed promotional modal. “Open Krea” led to a public application catalogue before registration. | Connect examples to an understandable action. Avoid a promotion blocking the first visit or a second catalogue between the landing and studio. |
| [FLORA](https://flora.ai/) | A canvas-oriented homepage surrounds the central proposition with varied creative work. The page then explains exploration, connected workflows and practical techniques. | Explain the connected canvas with one coherent story. Use a small interactive walkthrough so visitors can inspect the process at their pace. |
| [Figma Weave](https://weave.figma.com/) | Weavy redirects to Figma Weave. Native inspection showed large typography, a light canvas and linked media nodes. The page demonstrates editing operations and reusable workflows. | Make the relationship between inputs and a scene visible. Avoid presenting a full technical node graph as the first thing a newcomer must understand. |
| [Runway](https://runway.com/) | The public site separates its creative, developer and robotics offerings, with enterprise proof and distinct entry points. | Vela currently has one audience and one studio. One clear primary action is appropriate; enterprise navigation and unearned customer proof would add noise. |
| [Higgsfield](https://higgsfield.ai/) | The public homepage behaves like an extensive product catalogue, with many studios, new-model announcements, visual examples and a seasonal offer. | Show creative intent and a simple next step. Do not compete through a long model list or artificial urgency. |

Evidence limits: native screenshots were captured for Krea, FLORA and Weave. Magnific's public content was readable through the web research tool, but direct isolated Chrome access returned its security-filter **403** page. The connected personal browser returned **“browser access host is unavailable.”** No authenticated Magnific Spaces project was opened, changed or used for generation. Runway and Higgsfield were reviewed from their public page content; their complete signup flows were not tested. Krea's public entry was followed without creating an account.

## Practices applied

- Explain the category alongside the expressive headline. A headline alone must not leave the visitor guessing what the product does. [NN/g: explaining a site's purpose](https://www.nngroup.com/articles/tagline-blues-whats-the-site-about/).
- Prioritize the initial image, provide responsive sizes and explicit dimensions, and lazy-load lower-page artwork. No autoplay video competes with reading or loads a large movie before the visitor asks. [web.dev: optimizing LCP](https://web.dev/articles/optimize-lcp).
- Use native links, buttons and disclosures; retain focus indicators, meaningful image descriptions and a skip link. Respect reduced motion and avoid hidden keyboard-only interactions. [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md).
- Prerender the public page while retaining client rendering for the private editor. [Nuxt: hybrid rendering](https://nuxt.com/docs/4.x/guide/concepts/rendering#hybrid-rendering).

## Design direction

**A product explanation built around a photo study, within Vela’s existing visual system.** The landing and authentication use the studio’s shared graphite surfaces, light text and green accent tokens. The same system font stack as the studio, shared Vela symbol and wordmark, thin rules and generous space keep the public pages in the product’s visual identity. Large headings change the reading scale, not the typeface. Buttons share an 8 px radius, media cards a 20 px radius, and keyboard focus the same green outline. A single fictional character appears across an original coastal series. This connects the emotional promise with Vela's actual differentiator: bringing personal references and characters into one canvas.

The page uses a concrete short-form-video headline, original coastal images, an interactive canvas explanation, a character example and practical questions. The later template-pattern review removed decorative overlines, section numbering, the editorial slogan block and repeated two-tone headings. It avoids a generic feature-card grid. The public page and studio share the same dark palette; the different composition reflects their different purposes.

The page is in English, consistent with the existing product. Two scene controls switch perspective without autoplay. Three workflow buttons reveal references, an @-based prompt, and connected concept frames. These are explicitly **illustrative concepts**, not fabricated outputs from the live service. The character photo is fictional, not customer data.

Current availability appears beside the main action and in the FAQ: uploads, canvas, library and character preparation are available; generation is not connected. There are no invented testimonials, customer counts, pricing tiers or free-generation allowances. Real-person video authorization is not represented as already working.

## Entry and authentication

- `/` is public, with prerendered content and metadata. It does not initialize the private workspace.
- **Try Vela** opens `/studio?auth=sign-up`; **Log in** opens `/studio`. Clerk's forms use Vela's local shell, typography and colors.
- The registered user opens the first saved project; a genuinely new account gets one empty project. The editor's Canvas/brand navigation and missing-project fallback now use `/studio`.
- Character links keep `/characters` as their post-auth destination.
- Authentication mode and the public/private boundary follow `router.currentRoute`, since Nuxt's deferred page route cannot reliably advance while the gate withholds `NuxtPage`. This fixes a stale sign-in screen after sign-out/back navigation.
- Private API authorization remains server-enforced. Making `/` public does not make project or asset endpoints public.

## Local evidence

Evidence files are in ignored `.research/landing/` (screenshots, browser observations and audit output). No credentials or personal account data belong in this document.

- Production build prerenders the actual landing HTML, including its heading and content, rather than an empty SPA mount.
- Public homepage returns 200; anonymous bootstrap/projects/assets/characters API requests return 401.
- Native browser checks: both hero frames, all three walkthrough states, keyboard activation, native FAQ disclosure, local signup/sign-in controls, and return-to-studio navigation.
- Widths checked: 320, 390, 600, 768, 1024 and 1440 px. No horizontal overflow or broken loaded images. Mobile registration is also checked at 320 px.
- Reduced-motion emulation disables the hero and walkthrough entrance animations.
- Axe 4.11 reported zero violations for the desktop landing (43 passed checks) and mobile walkthrough (42 passed checks). Image-overlay contrast still requires visual judgment; these results are not a blanket accessibility certification.
- Dedicated Clerk Development signup: email/password → test verification code → a private empty project. Clerk's documented testing token was used for the automated signup challenge; no production protection was disabled. [Clerk testing](https://clerk.com/docs/guides/development/testing/overview), [test email behavior](https://clerk.com/docs/guides/development/testing/test-emails-and-phones).

Final verification: studio and live client regression suites, Nuxt typecheck, a production build without Clerk keys (demo configuration), and the configured live build all passed. The final dark landing had **zero axe violations at 1440 and 390 px (43 checks passed each)**. A missing footer landmark in the mobile auth shell was fixed; the final 320 px auth check also passed with zero violations. Native password login, local signup/sign-in switches, back-to-landing and sign-out-to-landing were replayed after fixing routing. The dedicated Clerk test user and its single empty project were removed; it had no assets or characters, and the credential file was deleted. No user-owned records or S3 objects were changed.

## Product-style verification follow-up

The first dark version matched the palette but still had separate Manrope/Instrument fonts, a text-only wordmark and different control radii. Those differences were removed after the user asked for complete visual continuity.

- `--font-ui` is now shared by the studio, landing and Clerk forms. Browser platform-font inspection confirmed **SF NS** on macOS Chrome, including headings and controls. Marketing headings retain their larger reading scale.
- `VelaBrand.vue` renders the existing studio symbol and wordmark everywhere. Browser comparisons matched its font family, weight, color, tracking, line height and dimensions across the three surfaces. The favicon uses the same symbol.
- Primary controls share the green fill, foreground, 600 weight and 8 px radius. Landing media and studio nodes share a 20 px radius. Clerk input backgrounds now use the actual studio surface token.
- Layouts at 320, 390, 600, 768, 1024 and 1440 px had no horizontal overflow, clipped headings or broken loaded images. A walkthrough image/footer overlap was found and fixed. Mobile headline sizing and the auth footer link were adjusted for the system font.
- Both hero frames, all three walkthrough states, keyboard FAQ activation, reduced motion, local signup/sign-in switching and return to the landing passed. Studio sidebar collapse/expand and character button radii also passed.
- Final axe checks: no violations on the landing at 390/1440 px (42 checks passed each) or auth at 320/1440 px (37/40 passed). No browser runtime errors were recorded. This follow-up used anonymous auth forms and a separate local demo studio; it did not create accounts or run generation. Safari and Firefox were not exercised.

Evidence: ignored `.research/style/comparison.json`, `parity.json`, `qa.json` and screenshots. Studio/live client regression suites, final typecheck and production build passed.

## Before publishing

The page is currently local. A production domain and hosting, Clerk production instance/redirect configuration, and real business privacy/terms content still need to be supplied for a public launch. Use the chosen domain for canonical and absolute social-image URLs. Update the early-preview wording only after generation and any required portrait authorization are actually enabled. Google OAuth completion and production deliverability are not certified by the local email/password test.

Artwork derivatives and generation briefs: [`frontend/public/landing/README.md`](../frontend/public/landing/README.md). Typography uses the studio’s shared `--font-ui` token; there are no separate marketing web fonts. No new production JavaScript dependency was added.

## Template-pattern and UX follow-up

The user identified the uppercase green-dot hero overline as an AI template pattern. It and related ornamental patterns were removed using Impeccable’s distill/polish guidance, Humanizer, Heuristic Evaluation and Web Design Guidelines. Current findings, changes and validation are recorded in [the landing UI review](landing-ui-review.md). This supersedes older screenshots and copy examples in the initial research evidence.

## Short-form content positioning

The public audience is creators and content teams preparing SFW Instagram Reels, Stories and YouTube Shorts. The headline is “Your studio for Reels, Stories and Shorts.” Copy now explains reusable creator references and different visual styles for lifestyle, travel, fitness and trend-inspired ideas. This replaces the previous broad personal-character pitch without changing the shared product identity.

The user requested neutral pricing placeholders: **$X per credit** and **Y credits per example video**. They are labeled as placeholders, not finalized prices. There is no cheapest-in-market comparison, promised savings percentage or guaranteed reach. Seedance and MiniMax are named as planned video models; only the ModelArk path is currently implemented, and live generation remains disconnected. The copy does not claim an already available MiniMax adapter or a preloaded curated reference catalogue.

Validation: 320, 390, 600, 768, 1024 and 1440 px layouts; pricing rows, all walkthrough states, FAQ keyboard interaction, frames and auth navigation. Zero axe violations at landing 390/1440 px (44 checks each) and auth 320/1440 px (37/40). No runtime errors. Evidence is ignored under `.research/social-copy/`. Typecheck and the final production build passed. No backend or provider work was done in this copy pass.
