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
- **Export PDF**: like Acrobat. For text the PDF really contains, the original text is **deleted from the page content** and the new text is written as **real, selectable text** (same font resource when it can draw the new text, otherwise the chosen font embedded). Blocks you opened but did not change are left byte-for-byte untouched. Lettering that is part of the page image (OCR blocks) still gets a rebuilt background + real text on top. Comments become real PDF Highlight / Text annotations.
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
- Real-text removal handles text in the page's own content stream (what Acrobat OCR / editing produces), not text inside Form XObjects.
- The editor fonts (Comic Neue, Anton, Bangers, Patrick Hand, Bodoni Moda) are bundled with the app (@fontsource) and the same files are embedded in the exported PDF, so preview == export, offline. Verdana / Arial / Times are embedded through Chrome's Local Font Access (asks permission on export); without it a standard PDF font is used. fontkit cannot subset WOFF2, which is why WOFF files are used. If embedding ever fails, the export retries with standard fonts instead of failing.
- "Remove text (rebuild bg)" uses exemplar inpainting: hatching and screentones continue through the old lettering. Heavy lettering baked into the image is detected and gets Anton + the white outline when the original had one.
- Pending: detecting the original font of lettering that is part of the image (WhatTheFont-style).
- Tests: `python3 test/make_fixture.py test/fixture.pdf && npx tsx test/export.test.ts test/fixture.pdf test/out.pdf`
