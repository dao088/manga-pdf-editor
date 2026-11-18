import { exemplarFill } from './exemplar'
import type { Rect } from './geometry'

/**
 * Mask of the lettering: pixels close to the ink colour inside the box, grown just enough to swallow the
 * anti-aliasing and the (usually white) outline. Only these pixels are rebuilt; everything else is kept.
 * `box` is [x0, y0, x1, y1] in the same pixel space as `d`.
 */
export function buildInkMask(d: Uint8ClampedArray, w: number, h: number, box: [number, number, number, number], ink: string, grow: number): Uint8Array {
  const [ox0, oy0, ox1, oy1] = box
  const ir = parseInt(ink.slice(1, 3), 16)
  const ig = parseInt(ink.slice(3, 5), 16)
  const ib = parseInt(ink.slice(5, 7), 16)
  const lumInk = ir * 0.3 + ig * 0.59 + ib * 0.11
  const raw = new Uint8Array(w * h)
  for (let y = oy0; y < oy1; y++) {
    for (let x = ox0; x < ox1; x++) {
      const i = (y * w + x) * 4
      const dist = Math.abs(d[i] - ir) + Math.abs(d[i + 1] - ig) + Math.abs(d[i + 2] - ib)
      const lum = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11
      const nearInk = lumInk < 128 ? lum < lumInk + 70 : lum > lumInk - 70
      if (dist < 150 && nearInk) raw[y * w + x] = 1
    }
  }
  const mask = new Uint8Array(w * h)
  const r = grow
  for (let y = oy0; y < oy1; y++) {
    for (let x = ox0; x < ox1; x++) {
      if (!raw[y * w + x]) continue
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy < oy0 || yy >= oy1) continue
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx
          if (xx < ox0 || xx >= ox1) continue
          if (dx * dx + dy * dy <= r * r) mask[yy * w + xx] = 1
        }
      }
    }
  }
  return mask
}

/**
 * "Remove text": rebuilds the area under the lettering from the pixels around it (exemplar inpainting),
 * so hatching / screentones continue through it. Returns a JPEG data URL of exactly `rect`, or null.
 */
export function inpaintRegion(canvas: HTMLCanvasElement, rect: Rect, ink: string): string | null {
  const cw = canvas.width
  const ch = canvas.height
  const bx0 = Math.floor(rect.x * cw)
  const by0 = Math.floor(rect.y * ch)
  const bw = Math.max(2, Math.ceil(rect.w * cw))
  const bh = Math.max(2, Math.ceil(rect.h * ch))
  const m = Math.round(Math.max(bw, bh) * 0.35) + 8 // plenty of surrounding texture to copy from
  const x0 = Math.max(0, bx0 - m)
  const y0 = Math.max(0, by0 - m)
  const x1 = Math.min(cw, bx0 + bw + m)
  const y1 = Math.min(ch, by0 + bh + m)
  const W = x1 - x0
  const H = y1 - y0
  if (W < 4 || H < 4) return null

  const k = Math.min(1, 520 / Math.max(W, H))
  const w = Math.max(4, Math.round(W * k))
  const h = Math.max(4, Math.round(H * k))
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(canvas, x0, y0, W, H, 0, 0, w, h)
  const img = tctx.getImageData(0, 0, w, h)

  const ox0 = Math.round((bx0 - x0) * k)
  const oy0 = Math.round((by0 - y0) * k)
  const ox1 = Math.min(w, Math.round((bx0 + bw - x0) * k))
  const oy1 = Math.min(h, Math.round((by0 + bh - y0) * k))
  // outline width grows with the size of the lettering (a 2.5x bigger page has a 2.5x wider halo)
  const grow = Math.max(2, Math.min(14, Math.round(6 * (Math.sqrt((ox1 - ox0) * (oy1 - oy0)) / 200))))
  const mask = buildInkMask(img.data, w, h, [ox0, oy0, ox1, oy1], ink, grow)
  if (!mask.some((v) => v)) return null

  exemplarFill(img.data, w, h, mask, { half: 4, radius: 70 })
  tctx.putImageData(img, 0, 0)

  const out = document.createElement('canvas')
  out.width = Math.max(1, ox1 - ox0)
  out.height = Math.max(1, oy1 - oy0)
  out.getContext('2d')!.drawImage(tmp, ox0, oy0, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.92)
}

/**
 * Looks at the original lettering: is it heavy (bold) and does it have an outline/halo of the opposite
 * tone (typical white halo around black manga lettering on art)? Used to give the new text the same look.
 */
export function lookOfPixels(d: Uint8ClampedArray, w: number, h: number, box: [number, number, number, number], ink: string, bgLum: number): { heavy: boolean; outline: string } {
  const [x0, y0, x1, y1] = box
  const area = Math.max(1, (x1 - x0) * (y1 - y0))
  const sc = Math.max(1, Math.sqrt(area) / 450)
  const R = (n: number) => Math.max(1, Math.round(n * sc))
  const ink0 = buildInkMask(d, w, h, box, ink, 0)
  let nInk = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) nInk += ink0[y * w + x]
  const lumInk = parseInt(ink.slice(1, 3), 16) * 0.3 + parseInt(ink.slice(3, 5), 16) * 0.59 + parseInt(ink.slice(5, 7), 16) * 0.11
  const opp = (p: number) => {
    const lum = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11
    return lumInk < 128 ? lum > 215 : lum < 40
  }
  // share of "opposite tone" right next to the letters vs a bit further away: a halo is a clear step up
  const share = (inner: number, outer: number) => {
    const a = buildInkMask(d, w, h, box, ink, inner)
    const b = buildInkMask(d, w, h, box, ink, outer)
    let n = 0
    let o = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * w + x
        if (!b[p] || a[p]) continue
        n++
        if (opp(p)) o++
      }
    }
    return n ? o / n : 0
  }
  // the halo's width depends on the lettering size, so look at several thin bands and keep the best one
  const near = Math.max(...([[1, 3], [2, 4], [3, 5], [4, 7], [5, 8]] as const).map(([a, b]) => share(R(a), R(b))))
  const far = share(R(9), R(13))
  void bgLum
  const bgIsOpposite = far > 0.85 // plain light bubble: nothing to outline
  return {
    heavy: nInk / area > 0.14,
    outline: !bgIsOpposite && near > 0.5 && near - far > 0.15 ? (lumInk < 128 ? '#ffffff' : '#000000') : '',
  }
}

export function detectLook(canvas: HTMLCanvasElement, rect: Rect, ink: string, bg: string): { heavy: boolean; outline: string } {
  const cw = canvas.width
  const ch = canvas.height
  const x0 = Math.max(0, Math.floor(rect.x * cw))
  const y0 = Math.max(0, Math.floor(rect.y * ch))
  const x1 = Math.min(cw, Math.ceil((rect.x + rect.w) * cw))
  const y1 = Math.min(ch, Math.ceil((rect.y + rect.h) * ch))
  const W = x1 - x0
  const H = y1 - y0
  if (W < 4 || H < 4) return { heavy: false, outline: '' }
  const img = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, W, H)
  const bgLum = parseInt(bg.slice(1, 3), 16) * 0.3 + parseInt(bg.slice(3, 5), 16) * 0.59 + parseInt(bg.slice(5, 7), 16) * 0.11
  return lookOfPixels(img.data, W, H, [0, 0, W, H], ink, bgLum)
}
