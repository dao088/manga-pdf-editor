import type { PDFPageProxy } from 'pdfjs-dist'
import { ocrCanvas } from './ppocr'
import { pdfjs } from './pdf'
import { overlapRatio, union, uid, type Rect } from './geometry'
import { detectAlign } from './style'
import type { Block, BlockSet } from '../store'

type Box = { x0: number; y0: number; x1: number; y1: number; text: string; fs: number; font?: string }

const toRect = (b: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number): Rect => ({
  x: b.x0 / W,
  y: b.y0 / H,
  w: (b.x1 - b.x0) / W,
  h: (b.y1 - b.y0) / H,
})

/** Real font name of a pdf.js font id (only available once the page has been rendered). */
function realFontName(page: PDFPageProxy, id: string): string | undefined {
  try {
    if (page.commonObjs.has(id)) {
      const f = page.commonObjs.get(id) as { name?: string; bold?: boolean; italic?: boolean } | undefined
      if (!f?.name) return undefined
      // the real name is often generic (e.g. "*Verdana-5441"): add the style flags pdf.js knows
      return `${f.name}${f.bold && !/bold/i.test(f.name) ? '-Bold' : ''}${f.italic && !/italic|oblique/i.test(f.name) ? '-Italic' : ''}`
    }
  } catch {
    /* font not resolved yet */
  }
  return undefined
}

/** Merge boxes into paragraphs: vertically close + horizontally overlapping. */
function groupLines(lines: Box[], blocked?: (a: Box, b: Box) => boolean): Box[][] {
  const parent = lines.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]
      const b = lines[j]
      const [top, bot] = a.y0 <= b.y0 ? [a, b] : [b, a]
      const gap = bot.y0 - top.y1
      const fs = Math.max(a.fs, b.fs)
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
      const minW = Math.min(a.x1 - a.x0, b.x1 - b.x0)
      const maxW = Math.max(a.x1 - a.x0, b.x1 - b.x0)
      const centred = Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) < maxW * 0.4
      const leftAligned = Math.abs(a.x0 - b.x0) < fs * 1.2
      if (gap < fs * 0.6 && ov > minW * 0.3 && Math.abs(a.fs - b.fs) < fs * 0.4 && (centred || leftAligned) && !blocked?.(a, b))
        parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, Box[]>()
  lines.forEach((l, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), l])
  })
  return [...groups.values()].map((g) => g.sort((p, q) => p.y0 - q.y0))
}

function makeBlocks(page: number, lines: Box[], W: number, H: number, source: 'pdf' | 'ocr', fontOf?: (b: Box) => string | undefined, blocked?: (a: Box, b: Box) => boolean): BlockSet {
  const line: Block[] = lines.map((l) => ({
    id: uid(),
    page,
    rect: toRect(l, W, H),
    text: l.text,
    fontSize: l.fs,
    fontName: fontOf?.(l) ?? l.font,
    align: 'center',
    lineHeight: 1.2,
    source,
  }))
  const group: Block[] = groupLines(lines, blocked).map((g) => {
    const rects = g.map((l) => toRect(l, W, H))
    const pitch =
      g.length > 1 ? ((g[g.length - 1].y0 + g[g.length - 1].y1) / 2 - (g[0].y0 + g[0].y1) / 2) / (g.length - 1) : 0
    let fs = g.reduce((s, l) => s + l.fs, 0) / g.length
    // OCR line boxes hug the ink (shorter than the font size): the line pitch is the reliable measure
    if (source === 'ocr' && pitch > 0) fs = pitch / 1.2
    return {
      id: uid(),
      page,
      rect: union(rects),
      text: g.map((l) => l.text.trim()).join(' '),
      fontSize: fs,
      fontName: fontOf?.(g[0]) ?? g[0].font,
      align: detectAlign(rects),
      lineHeight: pitch > 0 ? Math.min(1.8, Math.max(1, pitch / fs)) : 1.2,
      source,
    }
  })
  return { line, group, source }
}

/** Blocks from the PDF's own (or Acrobat-OCR'd) text layer. Gives real font names and sizes. */
export async function blocksFromPdf(page: PDFPageProxy, pageNumber: number): Promise<BlockSet | null> {
  const viewport = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items: Box[] = []
  for (const raw of tc.items) {
    if (!('str' in raw) || !raw.str.trim()) continue
    const t = pdfjs.Util.transform(viewport.transform, raw.transform)
    const fs = Math.hypot(t[2], t[3])
    if (fs < 2) continue
    items.push({
      x0: t[4],
      x1: t[4] + raw.width,
      y0: t[5] - fs * 0.85,
      y1: t[5] + fs * 0.25,
      text: raw.str,
      fs,
      font: raw.fontName,
    })
  }
  if (!items.length) return null

  // items -> lines (same baseline, small horizontal gap)
  items.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const lines: Box[] = []
  for (const it of items) {
    const cy = (it.y0 + it.y1) / 2
    const target = lines.find((l) => {
      const lcy = (l.y0 + l.y1) / 2
      return Math.abs(lcy - cy) < it.fs * 0.5 && it.x0 - l.x1 < it.fs * 1.5 && it.x0 - l.x1 > -it.fs
    })
    if (target) {
      target.text += target.text.endsWith(' ') || it.text.startsWith(' ') ? it.text : ` ${it.text}`
      target.x0 = Math.min(target.x0, it.x0)
      target.x1 = Math.max(target.x1, it.x1)
      target.y0 = Math.min(target.y0, it.y0)
      target.y1 = Math.max(target.y1, it.y1)
      target.fs = Math.max(target.fs, it.fs)
    } else lines.push({ ...it })
  }
  return makeBlocks(pageNumber, lines, viewport.width, viewport.height, 'pdf', (b) => (b.font ? realFontName(page, b.font) : undefined))
}

/**
 * Local OCR (PaddleOCR via ONNX/WASM, no internet) for text the PDF does not expose: lettering that is
 * part of the page image. Every detected line keeps its own box so bubbles are never merged together.
 */
/**
 * True when a speech-bubble outline (a thin dark line with light on both sides) lies between two text lines:
 * they belong to different bubbles and must not be merged. Boxes are in page points, `scale` = px per point.
 */
function borderBetween(img: ImageData, scale: number, a: Box, b: Box): boolean {
  const lum = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 128
    const i = (Math.floor(y) * img.width + Math.floor(x)) * 4
    return img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11
  }
  const inside = (bx: Box, x: number, y: number) => x >= bx.x0 - 3 && x <= bx.x1 + 3 && y >= bx.y0 - 3 && y <= bx.y1 + 3
  const ax = (a.x0 + a.x1) / 2
  const ay = (a.y0 + a.y1) / 2
  const bx = (b.x0 + b.x1) / 2
  const by = (b.y0 + b.y1) / 2
  const len = Math.hypot(bx - ax, by - ay) * scale
  let light = 0
  let dark = 0
  let sawLight = false
  for (let t = 0; t <= len; t++) {
    const px = ax + ((bx - ax) * t) / len
    const py = ay + ((by - ay) * t) / len
    if (inside(a, px, py) || inside(b, px, py)) {
      light = dark = 0
      sawLight = false
      continue
    }
    const l = lum(px * scale, py * scale)
    if (l > 170) {
      if (dark >= 2 && dark <= 16 && sawLight && light >= 0) return true
      light++
      dark = 0
      if (light >= 3) sawLight = true
    } else if (l < 90) {
      dark++
      if (dark > 16) sawLight = false
      light = 0
    }
  }
  return false
}

/**
 * Local OCR (PaddleOCR via ONNX/WASM, no internet) for text the PDF does not expose: lettering that is
 * part of the page image. Lines already covered by real PDF text (`skip`) are ignored, so a bubble that has
 * real text always uses the PDF's own text and font. Lines of different bubbles are never merged.
 */
export async function blocksFromOcr(page: PDFPageProxy, pageNumber: number, skip: Rect[] = []): Promise<BlockSet> {
  const OCR_SCALE = 2
  const viewport = page.getViewport({ scale: OCR_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
  const found = await ocrCanvas(canvas)
  const W = viewport.width / OCR_SCALE
  const H = viewport.height / OCR_SCALE
  const lines: Box[] = []
  for (const l of found) {
    const letters = (l.text.match(/[A-Za-z0-9]/g) ?? []).length
    const bh = l.y1 - l.y0
    const bw = l.x1 - l.x0
    if (l.conf < 0.6 || letters < 2 || letters / l.text.replace(/\s/g, '').length < 0.6) continue
    if (bh < 10 || bw < 12) continue
    const box = { x0: l.x0 / OCR_SCALE, x1: l.x1 / OCR_SCALE, y0: l.y0 / OCR_SCALE, y1: l.y1 / OCR_SCALE }
    if (skip.some((r) => overlapRatio(r, toRect(box, W, H)) > 0.3)) continue
    lines.push({ ...box, text: l.text, fs: bh / OCR_SCALE / 0.95 })
  }
  const img = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
  return makeBlocks(pageNumber, lines, W, H, 'ocr', undefined, (a, b) => borderBetween(img, OCR_SCALE, a, b))
}

/** Best-effort read of the text inside one user-drawn rectangle (normalized). Only a suggestion. */
export async function ocrRegion(page: PDFPageProxy, rect: Rect): Promise<{ text: string; lines: number }> {
  const SCALE = 3
  const base = page.getViewport({ scale: 1 })
  const PAD = 16
  const viewport = page.getViewport({
    scale: SCALE,
    offsetX: -rect.x * base.width * SCALE + PAD,
    offsetY: -rect.y * base.height * SCALE + PAD,
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(32, Math.floor(rect.w * base.width * SCALE) + PAD * 2)
  canvas.height = Math.max(32, Math.floor(rect.h * base.height * SCALE) + PAD * 2)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, viewport }).promise
  const found = (await ocrCanvas(canvas)).filter((l) => l.conf >= 0.5)
  found.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  return { text: found.map((l) => l.text).join(' '), lines: found.length }
}

/** Adds OCR blocks that are not already covered by existing blocks. */
export function mergeBlockSets(base: BlockSet | undefined, extra: BlockSet): BlockSet {
  if (!base) return extra
  const fresh = (list: Block[], extraList: Block[]) =>
    extraList.filter((b) => !list.some((o) => overlapRatio(o.rect, b.rect) > 0.5))
  return {
    line: [...base.line, ...fresh(base.line, extra.line)],
    group: [...base.group, ...fresh(base.group, extra.group)],
    source: 'mixed',
  }
}
