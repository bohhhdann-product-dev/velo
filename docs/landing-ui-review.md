# Vela landing: template-pattern and UX review

2026-11-21. Scope: public landing and the local Clerk entrance. The existing product's system font, graphite surfaces, green accent and shared Vela logo are binding constraints.

## Skills applied

- [Impeccable 4.10.0](https://github.com/pbakaus/impeccable/blob/main/.agents/skills/impeccable/SKILL.md): the **distill** and **polish** playbooks, plus the craft floor. The upstream instructions were read directly. The CLI launcher was unavailable; context and source/render review were performed manually. No detector score, browser overlay, global installation or hook is claimed.
- **Humanizer**, from the installed skill catalogue: remove generic promotion, repeated slogan fragments, forced rhetorical groups and filler; make a second copy pass after the layout changes.
- **Heuristic Evaluation**, from the catalogue: assess the new visitor's understanding, primary action, navigation, control and current feature availability against Nielsen's heuristics.
- **Web Design Guidelines**, from the catalogue, using the [current Vercel guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md): semantic controls, focus, image dimensions, readable text, reduced motion, touch behavior, responsive layout and clear actions.

Impeccable's general font/radius preferences do not replace the user's explicit requirement to match the product. The small canvas illustration intentionally retains product nodes, reference chips and a dotted board: they explain how the actual product works.

## Findings and changes

Severity follows the heuristic skill's 0–4 scale; these are local review findings, not a usability-study score.

| Location | Finding | Severity | Change |
| --- | --- | --- | --- |
| Hero overline | A green dot, tracked uppercase category label and generic AI claim added a recognizable template ornament without helping the visitor. | 2 | Removed the element and its CSS. No replacement badge or kicker. |
| Hero heading | “A world of ideas. Entirely yours.” did not explain what someone could do. Repeated gray second lines also created a template rhythm. | 3 | “Build a character from your photos.” One type treatment, with an explanation of face/body references and prompts. |
| Section framing | Decorative section numbers, repeated overlines, an editorial slogan block and a hand-drawn arrow interrupted the product explanation. | 2 | Removed them. The page now goes from an example to the canvas, characters, practical questions and the entry action. |
| Action hierarchy | Header and hero used competing green actions; the walkthrough repeated the signup action again. | 1 | The header uses a quieter surface button, the hero retains the green primary action, and the redundant walkthrough link is removed. |
| Captions and disclosures | Several useful statements were 9–11 px. Text on the hero artwork also competed with the image. | 2 | Marketing captions/disclosures are 13 px or larger; the image's title and fictional-example disclosure sit below it. Compact labels inside the miniature canvas retain product scale. |
| Walkthrough copy | Inspirational language obscured what the controls show. The sample prompt ended with an abstract “feeling” line. | 2 | Controls name actual actions. The sample prompt describes the shown character, silk, coast and lighting. Native buttons, selected state and live caption remain. |
| Auth entrance | The custom title duplicated Clerk's own account title; both were H1 elements. Extra slogans added another layer before the form. | 2 | Removed the outer title and slogans. Clerk owns the visible task heading, including later verification/password steps. |

Generation availability remains visible beside the main action and in the FAQ. The page still labels the imagery as fictional concepts; it does not promise working generation, identity authorization, customer results or free generation credits.

## Verification

- Rendered and inspected in isolated macOS Chrome. The normal browser connector returned “browser access host is unavailable”; no personal browser profile was touched.
- Layouts: 320, 390, 600, 768, 1024 and 1440 CSS pixels, with no horizontal overflow, clipped headings or broken loaded images. Inspected the hero, every walkthrough state, character section, questions, final action and auth.
- Both example frames, three walkthrough choices (mouse and keyboard), FAQ keyboard activation, reduced motion, signup/sign-in switches and back-to-landing passed. The character entry keeps `/characters`; the primary signup entry keeps `/studio?auth=sign-up`.
- The removed kicker, gray heading accent and slogan-block selectors are absent. The rendered font still uses the studio's system stack and the accent is still `#30d158`.
- Axe: zero violations for the landing at 390/1440 px (42 checks passed each). After removing the redundant auth title, the final auth checks passed at 320/390/1440 px with one H1 and zero violations.
- No runtime errors in the browser checks. Final Nuxt typecheck and production build passed.

Evidence is local and ignored under `.research/landing-review/`, including `qa.json`, `final-checks.json`, `auth-final.json` and screenshots. No accounts were created, no content generated and no backend behavior changed. Safari/Firefox and production OAuth were not tested in this pass. This review does not certify that a design can be identified as human- or AI-made; it removes the specific patterns identified in the brief and review.

## Subsequent copy direction

The later user brief refocused public copy on SFW Reels, Stories and Shorts for creators and content teams. The hero now says “Your studio for Reels, Stories and Shorts.” References, reusable creator photos and planned Seedance/MiniMax support replace the broad personal-character positioning. A plain definition list presents the explicitly requested X/Y pricing placeholders. No overlines, decorative section numbers or cheapest/guaranteed-reach claims were reintroduced. See `landing-research.md` for the current scope and verification.
