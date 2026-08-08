# TOC Lightbox Design

## Goal

Let readers enlarge the left table of contents into a centered, larger overlay for browsing, then return to the normal sidebar after picking a chapter (or dismissing).

## Interaction

- **Enter:** “放大目录” button in the sidebar header (near collapse).
- **Exit:** chapter link click, backdrop click, `Esc`, or close button.
- State is local to `TocSidebar` (not persisted). Sidebar `tocOpen` is unchanged.
- Body scroll lock while open (same pattern as diagram lightbox).

## Visual

- Semi-transparent dark mask with light blur; paper-tone panel `#faf8f4`.
- Panel: `min(560px, 92vw)` wide, up to ~`80vh` tall, 16px radius, soft shadow.
- Larger type than sidebar (title ~22px; depth-0 ~17px; depth-1 ~15px; deeper ~14px).
- Short fade + slight rise (~200ms); respect `prefers-reduced-motion`.

## Implementation

- New `TocLightbox.vue` + `styles/toc-lightbox.css`.
- Wire from `TocSidebar.vue`; reuse `TocTreeNodes` with the same props.
- Close on `.toc-chapter-link` click via capture on the lightbox nav.

## Out of scope

- Persisting lightbox open state
- Morphing the sidebar DOM into center
- Changing `TocTreeNodes` routing / annotation logic
