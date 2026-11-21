# Vela design system

Updated 2026-11-21 after canvas interaction and visual refinements.

## Direction

A dark creative workspace with quiet controls and prominent media. The canvas is the main surface; references, generators and results have distinct visual roles. Green is reserved for the main action, selected navigation and connection/status details.

- Clear hierarchy: workspace → project → canvas → card → controls.
- Generators are structured cards: references, prompt, general settings (model, format, quality, outputs), action. Video adds opening/closing frame slots and duration/trial. Model selection belongs below the prompt, never in the card header.
- Keep readable labels; avoid making every setting a pill or every heading uppercase.
- Give images space. Use restrained borders, shadows and color to separate surfaces.
- Demo imagery is bundled locally, curated around one visual theme. It represents sample content, not the prompt's generated result.

## Tokens and type

Source: `frontend/app/assets/css/main.css`, mapped to Tailwind via `@theme inline`.

| Token | Value | Use |
| --- | --- | --- |
| canvas | #101112 | background |
| surface | #1c1d1f | cards and popovers |
| surface-2 / surface-3 | #27282b / #323438 | wells and hover states |
| ink | #eeeef0 | primary text |
| ink-2 / ink-3 | #a6a9af / #7d8189 | secondary text and metadata |
| line / line-strong | 7.5% / 16% white | borders |
| accent | #30d158 | Generate and focused navigation |
| edge-input / edge-output | #8b929e / #6e9c7a | reference / output connections |

System font stack, SF Pro on macOS. Collection titles 30px; project/card model titles 13px; prompt 13px at 1.65 line height; card labels 11px; compact metadata 10px. Node content scales together with its card. Avoid relying on muted metadata for critical actions.

## Layout

Desktop sidebar 208px, project header 72px. The canvas fills the remaining width, with a subtle dot pattern, an inset 14px corner radius and floating tool/zoom rails. Below 1200px the sidebar becomes narrower; below 960px navigation uses icons. No generation-history panel or permanent shortcut hint strip.

The starter composition reads left to right: one reference, one generator, two outputs stacked in a column. It is centered by Fit with room for titles and the left toolbar. Card titles float above the card. Generator width is 336px; reference width 208px; landscape output width 296px.

Card radius 20px; small controls 7–8px; workspace panels 14px. Selection uses a subtle green border; tool selection uses a light neutral fill. Do not spread the bright Generate green across the whole interface.

## Components and behavior

- `NodeFrame`: floating title, hover/focus delete action, contour-aligned quarter-circle resize handle; resize scale 0.75–4. Media grows while its caption, title and ports retain their size; generator content scales together, with title and handles outside its zoomed content.
- `GeneratorNode`: thumbnail references, textarea, then a lower settings area with the model dropdown and labeled parameter grid, followed by Generate with price. Prompt edits commit on blur or Run, while the button responds immediately to text input.
- `VPillMenu`: retained component name; renders a small rounded rectangle for all settings, including model selection. Full option labels may have shorter trigger labels.
- `VButton`: primary / soft / ghost / danger, 8px corners.
- `NodePalette`: searchable three-item menu; arrows/Enter/Escape; right-click, N or +.
- `CanvasMinimap`: a 240×154px rounded map above the bottom-right zoom rail. Image/poster thumbnails, neutral generator silhouettes, selected-node outlines and a muted green viewport frame. Drag the viewport to pan; clicking outside it recenters the camera. Zoom is preserved. The map button toggles visibility; zoom/shortcut popovers temporarily replace it. No header, footer or instructional copy inside the map.
- Library and Favorites share spacing, typography and surfaces with the studio; images use consistent crops and restrained controls.

Focus-visible uses a green outline; hidden image actions appear on keyboard focus as well as hover. Reduced-motion preference removes transitions and animations. Media viewer and picker use reka-ui dialogs.

## Mock boundaries

Everything remains in memory. Refresh restores the sample workspace. Image runs pick from bundled sample photos; video uses a bundled CC0 flower clip. Credits and generation timings are simulated. No provider requests, accounts, persistence or backend are implemented.

Canvas selection is a restrained green marquee and outline. Group backgrounds use a very low-opacity tint. Context/continuation palettes are 244px wide in screen space, with a 14px radius and measured edge clamping. Resize targets are 32px; small port visuals have an expanded pointer target. Keyboard shortcut help and zoom options stay outside the camera transform.

### Canvas refinements from the 11:51 feedback recording

- Media results are image/video-only cards; no status/metadata strip below successful media. Preserve 20px outer corners and fixed-size ports/actions during media resize.
- Favorite uses one fixed position in the top-right actions. Its saved state stays visible; hover reveals neighboring actions without moving the heart.
- Resize affordance: a 20px quarter-circle with a 2px stroke lies on the 20px card corner. Its transparent 32px hit area extends outside the corner. Light neutral on hover, accent when selected; no diagonal grip or separate L shape.
- Edge hover transitions over 160ms to a brighter 3.5px stroke. A 32×26px scissors pill follows the pointer at screen scale; click disconnects, drag does not. Respect reduced motion.
- Reference title is its editable name; the small footer exposes its unique @handle. Hover uses a text cursor and brighter title. A single click edits directly; Enter saves, Escape cancels. Dragging the title moves the node. No separate pencil action.
- Prompt expansion is a large, focused dialog using the same draft. @suggestions appear in both compact and expanded fields. Escape dismisses suggestions before closing the editor; closing keeps edits.

## Characters and mention library

- Characters is a separate workspace collection, with portrait-led cards, a small saved/draft label, visible @handle and Use in video action. The empty state explains the required portrait/full-body pair and offers one clear starting action.
- Builder content is capped at 1080px. A four-step rail gives Identity → Face → Body → Sheet & save; later steps unlock through approval. The active step uses muted sage, while primary actions retain the shared button style.
- Upload steps use a two-column layout: four stable-height photo slots plus notes on the left, a larger preview on the right. Front photo is required; other angles are optional. Keep full-body images contained. Replace and remove are available; errors stay beside the affected upload.
- The final sheet uses a light neutral background, separate face/body rows and supplied images without invented views. A narrow side column shows identity, approved source counts and save/use action. Opening the sheet uses the shared named preview dialog.
- @ uses a 286px screen-space popover independent of canvas zoom: Search, Connected, then Library → Characters / Images. Category back, thumbnails, handle labels, connected checks and an in-category Create character action. No permanent keyboard-instruction footer. Respect viewport bounds and stack above the expanded prompt dialog.
- Choosing a character connects the reference and inserts its handle together. Creating from a prompt returns to that same generator after saving. This is part of the main editing flow, not a separate unfinished settings screen.
