import type { Rect } from './geometry'

/**
 * "Remove text": rebuilds the area under the lettering from the pixels around it, so the new
 * text can sit on screentones / textures without a flat patch. Ink (text colour) is masked,
 * grown a few pixels to swallow the white outline, then filled by diffusion from the border.
 * Returns a JPEG data URL of exactly `rect`, or null when the canvas is unusable.
 */
export function inpaintRegion(canvas: HTMLCanvasElement, rect: Rect, ink: string): string | null {
  const cw = canvas.width
  const ch = canvas.height
  const bx0 = Math.floor(rect.x * cw)
  const by0 = Math.floor(rect.y * ch)
  const bw = Math.max(2, Math.ceil(rect.w * cw))
  const bh = Math.max(2, Math.ceil(rect.h * ch))
  const m = Math.round(Math.max(bw, bh) * 0.2) + 4
  const x0 = Math.max(0, bx0 - m)
  const y0 = Math.max(0, by0 - m)
  const x1 = Math.min(cw, bx0 + bw + m)
  const y1 = Math.min(ch, by0 + bh + m)
  const W = x1 - x0
  const H = y1 - y0
  if (W < 4 || H < 4) return null

  // work at a capped resolution
  const k = Math.min(1, 700 / Math.max(W, H))
  const w = Math.max(4, Math.round(W * k))
  const h = Math.max(4, Math.round(H * k))
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(canvas, x0, y0, W, H, 0, 0, w, h)
  const img = tctx.getImageData(0, 0, w, h)
  const d = img.data

  // box in working coordinates
  const ox0 = Math.round((bx0 - x0) * k)
  const oy0 = Math.round((by0 - y0) * k)
  const ox1 = Math.min(w, Math.round((bx0 + bw - x0) * k))
  const oy1 = Math.min(h, Math.round((by0 + bh - y0) * k))

  const ir = parseInt(ink.slice(1, 3), 16)
  const ig = parseInt(ink.slice(3, 5), 16)
  const ib = parseInt(ink.slice(5, 7), 16)
  const lumInk = ir * 0.3 + ig * 0.59 + ib * 0.11

  // 1) ink mask inside the box (colour close to the text colour)
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
  // 2) grow it (letters have a white outline + anti-aliasing)
  const r = Math.max(2, Math.round(Math.min(ox1 - ox0, oy1 - oy0) * 0.025) + 2)
  const mask = new Uint8Array(w * h)
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

  // 3) diffusion fill (Gauss-Seidel sweeps, alternating direction) on masked pixels only
  const f = new Float32Array(w * h * 3)
  let sr = 0, sg = 0, sb = 0, sn = 0
  for (let p = 0; p < w * h; p++) {
    f[p * 3] = d[p * 4]
    f[p * 3 + 1] = d[p * 4 + 1]
    f[p * 3 + 2] = d[p * 4 + 2]
    if (!mask[p]) {
      sr += d[p * 4]; sg += d[p * 4 + 1]; sb += d[p * 4 + 2]; sn++
    }
  }
  if (!sn) return null
  const idx: number[] = []
  for (let p = 0; p < w * h; p++) if (mask[p]) idx.push(p)
  if (!idx.length) return null
  for (const p of idx) { f[p * 3] = sr / sn; f[p * 3 + 1] = sg / sn; f[p * 3 + 2] = sb / sn }
  const iters = 250
  for (let it = 0; it < iters; it++) {
    const rev = it % 2 === 1
    for (let n = 0; n < idx.length; n++) {
      const p = idx[rev ? idx.length - 1 - n : n]
      const x = p % w
      const y = (p - x) / w
      const l = x > 0 ? p - 1 : p
      const rr = x < w - 1 ? p + 1 : p
      const u = y > 0 ? p - w : p
      const dn = y < h - 1 ? p + w : p
      for (let c = 0; c < 3; c++) f[p * 3 + c] = (f[l * 3 + c] + f[rr * 3 + c] + f[u * 3 + c] + f[dn * 3 + c]) / 4
    }
  }
  for (const p of idx) {
    d[p * 4] = f[p * 3]; d[p * 4 + 1] = f[p * 3 + 1]; d[p * 4 + 2] = f[p * 3 + 2]
  }
  tctx.putImageData(img, 0, 0)

  const out = document.createElement('canvas')
  out.width = Math.max(1, ox1 - ox0)
  out.height = Math.max(1, oy1 - oy0)
  out.getContext('2d')!.drawImage(tmp, ox0, oy0, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.88)
}
