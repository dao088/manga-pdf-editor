# Manga PDF Editor (MVP)

React + TypeScript + Tailwind v4 + pdf.js. English text only, no backend yet.

```bash
pnpm install   # or npm install
pnpm dev
```

## What it does

- **Select / comment**: select text -> "Comment" button -> note in the side panel (Post / Cancel, replies, delete).
  The text gets a yellow highlight + small comment icon; hovering shows the popup (like Acrobat).
- **Region comment**: drag a rectangle on anything that is not selectable text.
- **Edit text**: click a detected block (dashed blue). The original is covered with the sampled background colour
  and replaced by editable text. Font / size / colour / alignment / line height are auto-detected and editable in
  the **Format** tab. `Inline` = one line per block, `Group` = whole paragraph or bubble.
- **Detect more text (OCR)**: tesseract.js on the page for text the PDF does not expose (big bold lettering).
- **Export PDF**: edits are flattened as images over the original; comments become real PDF Highlight / Text annotations.
- Comments and edits are saved in `localStorage` per file (name + size).

## Layout

- `src/store.ts` — zustand state (comments, edits, blocks, tool)
- `src/lib/blocks.ts` — block detection (pdf.js text items -> lines -> paragraphs; OCR fallback)
- `src/lib/style.ts` — font-name mapping, colour sampling, fit-to-box, alignment
- `src/lib/export.ts` — pdf-lib export
- `src/components/` — PageView (canvas + text layer + overlays), EditBox, panels, toolbar

## Known limits

- Font detection is exact only when the PDF exposes the real font name (e.g. Acrobat-OCR'd files). For OCR-only
  blocks it defaults to Comic Neue and you pick the font by hand.
- Only upright (non-rotated) pages.
- Export flattens edited text to images (keeps any web font, but is not selectable afterwards).
