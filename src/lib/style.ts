import type { Rect } from './geometry'
import type { Align, TextEditT } from '../store'

export const FONTS = [
  'Bodoni Moda',
  'Comic Neue',
  'Patrick Hand',
  'Bangers',
  'Anton',
  'Verdana',
  'Arial',
  'Times New Roman',
] as const

export type DetectedFont = { font: string; bold: boolean; italic: boolean }

/** Maps a real PDF font name (e.g. "*Verdana-BoldItalic-5442") to one of our available fonts. */
export function parseFontName(raw?: string): DetectedFont {
  const s = (raw ?? '').toLowerCase()
  const bold = /bold|black|heavy|semibold|demi/.test(s)
  const italic = /italic|oblique/.test(s)
  let font = 'Comic Neue'
  if (/bodoni|didot/.test(s)) font = 'Bodoni Moda'
  else if (/verdana|tahoma|segoe/.test(s)) font = 'Verdana'
  else if (/arial|helvet/.test(s)) font = 'Arial'
  else if (/times|georgia|garamond|serif|minion|palatino/.test(s)) font = 'Times New Roman'
  else if (/anton|impact|condensed/.test(s)) font = 'Anton'
  else if (/comic|wildwords|anime/.test(s)) font = 'Comic Neue'
  return { font, bold, italic }
}

type RGB = [number, number, number]
const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/**
 * Samples the rendered page canvas: background = dominant colour of a ring just outside the
 * block; text colour = the pixels inside the block that are furthest from that background.
 */
export function detectColors(canvas: HTMLCanvasElement, rect: Rect): { bg: string; color: string } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { bg: '#ffffff', color: '#000000' }
  const cw = canvas.width
  const ch = canvas.height
  const pad = Math.max(3, Math.round(cw * 0.004))
  const x0 = Math.max(0, Math.floor(rect.x * cw) - pad)
  const y0 = Math.max(0, Math.floor(rect.y * ch) - pad)
  const x1 = Math.min(cw, Math.ceil((rect.x + rect.w) * cw) + pad)
  const y1 = Math.min(ch, Math.ceil((rect.y + rect.h) * ch) + pad)
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return { bg: '#ffffff', color: '#000000' }
  const data = ctx.getImageData(x0, y0, w, h).data

  // background: histogram of the outer ring
  const hist = new Map<number, { n: number; r: number; g: number; b: number }>()
  const ring = pad + 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onRing = x < ring || y < ring || x >= w - ring || y >= h - ring
      if (!onRing) continue
      const i = (y * w + x) * 4
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
      const e = hist.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      e.n++
      e.r += data[i]
      e.g += data[i + 1]
      e.b += data[i + 2]
      hist.set(key, e)
    }
  }
  let best = { n: 0, r: 255, g: 255, b: 255 }
  for (const e of hist.values()) if (e.n > best.n) best = e
  const bg: RGB = best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255]

  // text colour: furthest pixels from bg
  let maxD = 0
  const dist = (i: number) => Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2])
  for (let i = 0; i < data.length; i += 4) maxD = Math.max(maxD, dist(i))
  if (maxD < 90) return { bg: toHex(bg), color: toHex(bg[0] + bg[1] + bg[2] > 380 ? [0, 0, 0] : [255, 255, 255]) }
  let n = 0
  const sum: RGB = [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    if (dist(i) >= maxD * 0.75) {
      sum[0] += data[i]
      sum[1] += data[i + 1]
      sum[2] += data[i + 2]
      n++
    }
  }
  return { bg: toHex(bg), color: toHex([sum[0] / n, sum[1] / n, sum[2] / n]) }
}

let measureCtx: CanvasRenderingContext2D | null = null
const getMeasure = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!)

export const fontSpec = (e: Pick<TextEditT, 'bold' | 'italic' | 'font'>, size: number) =>
  `${e.italic ? 'italic ' : ''}${e.bold ? '700 ' : '400 '}${size}px "${e.font}", sans-serif`

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = words[0]
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`
      if (ctx.measureText(next).width <= maxW) line = next
      else {
        out.push(line)
        line = words[i]
      }
    }
    out.push(line)
  }
  return out
}

/** Largest size (<= e.size) at which the text fits inside the edit box. Units: PDF points. */
export function fitSize(e: TextEditT, pageW: number, pageH: number): number {
  if (!e.autoFit) return e.size
  const ctx = getMeasure()
  const W = e.rect.w * pageW
  const H = e.rect.h * pageH
  for (let s = e.size; s > 4; s -= 0.5) {
    ctx.font = fontSpec(e, s)
    const lines = wrapLines(ctx, e.text, W)
    if (lines.length * s * e.lineHeight <= H) return s
  }
  return 4
}

export function detectAlign(lines: Rect[]): Align {
  if (lines.length < 2) return 'center'
  const tol = Math.max(...lines.map((l) => l.w)) * 0.06
  const lefts = lines.map((l) => l.x)
  const centers = lines.map((l) => l.x + l.w / 2)
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
  if (spread(lefts) <= tol && spread(centers) > tol) return 'left'
  return 'center'
}
