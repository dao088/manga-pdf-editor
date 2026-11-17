import type { PDFPageProxy } from 'pdfjs-dist'
import { createWorker, PSM, type Worker } from 'tesseract.js'
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
    if (page.commonObjs.has(id)) return page.commonObjs.get(id)?.name as string | undefined
  } catch {
    /* font not resolved yet */
  }
  return undefined
}

/** Merge boxes into paragraphs: vertically close + horizontally overlapping. */
function groupLines(lines: Box[]): Box[][] {
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
      if (gap < fs * 0.6 && ov > minW * 0.3 && Math.abs(a.fs - b.fs) < fs * 0.4) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, Box[]>()
  lines.forEach((l, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), l])
  })
  return [...groups.values()].map((g) => g.sort((p, q) => p.y0 - q.y0))
}

function makeBlocks(page: number, lines: Box[], W: number, H: number, source: 'pdf' | 'ocr', fontOf?: (b: Box) => string | undefined): BlockSet {
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
  const group: Block[] = groupLines(lines).map((g) => {
    const rects = g.map((l) => toRect(l, W, H))
    const pitch =
      g.length > 1 ? ((g[g.length - 1].y0 + g[g.length - 1].y1) / 2 - (g[0].y0 + g[0].y1) / 2) / (g.length - 1) : 0
    const fs = g.reduce((s, l) => s + l.fs, 0) / g.length
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

let worker: Promise<Worker> | null = null
const getWorker = async () => {
  worker ??= createWorker('eng')
    .then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
      return w
    })
    .catch((e) => {
      worker = null // do not cache a failed load (e.g. offline), allow retry
      throw e
    })
  return worker
}

const overlapsBox = (a: Box, b: Box) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (ix <= 0 || iy <= 0) return false
  return (ix * iy) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) > 0.5
}

/**
 * OCR fallback for text the PDF does not expose (e.g. big bold manga lettering).
 *
 * Manga lettering is usually pure black ink (often with a white outline) over grey screentones.
 * A normal contrast boost keeps the tones and confuses the OCR, so we run it on "ink only"
 * versions of the page (only very dark pixels survive) at two strictness levels and merge.
 */
export async function blocksFromOcr(page: PDFPageProxy, pageNumber: number): Promise<BlockSet> {
  const OCR_SCALE = 2
  const viewport = page.getViewport({ scale: OCR_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const original = ctx.getImageData(0, 0, canvas.width, canvas.height)

  const w = await getWorker()
  const lines: Box[] = []
  for (const cutoff of [50, 80]) {
    const img = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height)
    for (let i = 0; i < img.data.length; i += 4) {
      const g = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11
      const v = g < cutoff ? 0 : 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    }
    ctx.putImageData(img, 0, 0)
    const { data } = await w.recognize(canvas, {}, { blocks: true })
    for (const block of data.blocks ?? []) {
      for (const p of block.paragraphs) {
        for (const l of p.lines) {
          const text = l.text.trim()
          const letters = (text.match(/[A-Za-z0-9]/g) ?? []).length
          const bw = l.bbox.x1 - l.bbox.x0
          const bh = l.bbox.y1 - l.bbox.y0
          // drop noise: low confidence, too short, mostly symbols, or thin slivers
          if (l.confidence < 40 || text.length < 3 || letters / text.length < 0.6) continue
          if (bh < 14 || bw < bh * 0.8) continue
          const box: Box = {
            x0: l.bbox.x0 / OCR_SCALE,
            x1: l.bbox.x1 / OCR_SCALE,
            y0: l.bbox.y0 / OCR_SCALE,
            y1: l.bbox.y1 / OCR_SCALE,
            text,
            fs: bh / OCR_SCALE / 1.2,
          }
          if (!lines.some((o) => overlapsBox(o, box))) lines.push(box)
        }
      }
    }
  }
  return makeBlocks(pageNumber, lines, viewport.width / OCR_SCALE, viewport.height / OCR_SCALE, 'ocr')
}

/**
 * Best-effort read of the text inside one user-drawn rectangle (normalized). The result is only a
 * suggestion: the manual box works even when this returns an empty string.
 */
export async function ocrRegion(page: PDFPageProxy, rect: Rect): Promise<{ text: string; lines: number }> {
  const SCALE = 3
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({
    scale: SCALE,
    offsetX: -rect.x * base.width * SCALE,
    offsetY: -rect.y * base.height * SCALE,
  })
  const PAD = 12
  const cw = Math.max(8, Math.floor(rect.w * base.width * SCALE))
  const ch = Math.max(8, Math.floor(rect.h * base.height * SCALE))
  const src = document.createElement('canvas')
  src.width = cw
  src.height = ch
  await page.render({ canvas: src, viewport }).promise
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const original = sctx.getImageData(0, 0, cw, ch)

  const out = document.createElement('canvas')
  out.width = cw + PAD * 2
  out.height = ch + PAD * 2
  const octx = out.getContext('2d')!

  const w = await getWorker()
  await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
  let best = { text: '', lines: 0, score: 0 }
  try {
    // dark ink on light (normal lettering) and light ink on dark (white text in black bubbles)
    for (const [cutoff, inverted] of [[60, false], [100, false], [140, false], [190, true]] as const) {
      const img = new ImageData(new Uint8ClampedArray(original.data), cw, ch)
      for (let i = 0; i < img.data.length; i += 4) {
        const g = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11
        const ink = inverted ? g > cutoff : g < cutoff
        img.data[i] = img.data[i + 1] = img.data[i + 2] = ink ? 0 : 255
      }
      src.getContext('2d')!.putImageData(img, 0, 0)
      octx.fillStyle = '#fff'
      octx.fillRect(0, 0, out.width, out.height)
      octx.drawImage(src, PAD, PAD)
      const { data } = await w.recognize(out, {}, { blocks: true })
      const lines = (data.blocks ?? [])
        .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
        .filter((l) => {
          const t = l.text.trim()
          const letters = (t.match(/[A-Za-z]/g) ?? []).length
          return letters >= 3 && letters / t.replace(/\s/g, '').length >= 0.7 && l.confidence >= 30
        })
      const score =
        lines.reduce((sum, l) => sum + (l.text.match(/[A-Za-z]/g) ?? []).length * l.confidence, 0) * (inverted ? 0.6 : 1)
      if (score > best.score) best = { text: lines.map((l) => l.text.trim()).join(' '), lines: lines.length, score }
    }
  } finally {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT })
  }
  return { text: best.text, lines: best.lines }
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
