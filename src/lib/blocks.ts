import type { PDFPageProxy } from 'pdfjs-dist'
import { createWorker, type Worker } from 'tesseract.js'
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
const getWorker = () => (worker ??= createWorker('eng'))

/**
 * OCR fallback for text the PDF does not expose (e.g. big bold manga lettering).
 * Renders the page at 2x, applies a light contrast boost and returns line/paragraph blocks.
 */
export async function blocksFromOcr(page: PDFPageProxy, pageNumber: number): Promise<BlockSet> {
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport }).promise
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    const g = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11
    const v = g > 150 ? 255 : g < 90 ? 0 : g
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)

  const w = await getWorker()
  const { data } = await w.recognize(canvas, {}, { blocks: true })
  const lines: Box[] = []
  for (const block of data.blocks ?? []) {
    for (const p of block.paragraphs) {
      for (const l of p.lines) {
        if (l.confidence < 45 || !l.text.trim()) continue
        const hgt = l.bbox.y1 - l.bbox.y0
        lines.push({
          x0: l.bbox.x0 / 2,
          x1: l.bbox.x1 / 2,
          y0: l.bbox.y0 / 2,
          y1: l.bbox.y1 / 2,
          text: l.text.trim(),
          fs: (hgt / 2) / 1.2,
        })
      }
    }
  }
  return makeBlocks(pageNumber, lines, viewport.width / 2, viewport.height / 2, 'ocr')
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
