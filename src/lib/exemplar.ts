/**
 * Exemplar-based inpainting (Criminisi et al.): the hole is filled patch by patch with the best matching
 * patch of the surrounding image, so hatching and screentones CONTINUE through the hole instead of being
 * smeared into a flat grey. Pure function on RGBA data (no DOM), so it can be tested in Node.
 */
export function exemplarFill(
  d: Uint8ClampedArray,
  w: number,
  h: number,
  hole: Uint8Array,
  opt: { half?: number; radius?: number } = {},
): void {
  const half = opt.half ?? 4
  const R = opt.radius ?? 70
  const N = w * h

  // integral image of the ORIGINAL hole: a source patch is valid when it contains no hole pixel
  const stride = w + 1
  const integ = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x]
      integ[(y + 1) * stride + x + 1] = integ[y * stride + x + 1] + row
    }
  }
  const holeIn = (x0: number, y0: number, x1: number, y1: number) =>
    integ[(y1 + 1) * stride + x1 + 1] - integ[y0 * stride + x1 + 1] - integ[(y1 + 1) * stride + x0] + integ[y0 * stride + x0]

  // Solid dark blobs (hair, a heart, a black panel) are not texture: do not copy them into a hatched or
  // light background. If the hole sits on solid black itself, they stay allowed.
  const dark = new Uint8Array(N)
  for (let p = 0; p < N; p++) dark[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11 < 70 ? 1 : 0
  const solid = new Uint8Array(N)
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let all = 1
      for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (!dark[(y + dy) * w + x + dx]) { all = 0; break }
      solid[y * w + x] = all
    }
  }
  let ringN = 0
  let ringSolid = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (hole[y * w + x]) continue
      let near = false
      for (let dy = -6; dy <= 6 && !near; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const xx = x + dx
          const yy = y + dy
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && hole[yy * w + xx]) { near = true; break }
        }
      }
      if (near) (ringN++, (ringSolid += solid[y * w + x]))
    }
  }
  const banSolid = ringN > 0 && ringSolid / ringN < 0.12
  const sInteg = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += solid[y * w + x]
      sInteg[(y + 1) * stride + x + 1] = sInteg[y * stride + x + 1] + row
    }
  }
  const solidIn = (x0: number, y0: number, x1: number, y1: number) =>
    sInteg[(y1 + 1) * stride + x1 + 1] - sInteg[y0 * stride + x1 + 1] - sInteg[(y1 + 1) * stride + x0] + sInteg[y0 * stride + x0]

  const gray = new Float32Array(N)
  for (let p = 0; p < N; p++) gray[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11
  const known = new Uint8Array(N)
  const conf = new Float32Array(N)
  for (let p = 0; p < N; p++) {
    known[p] = hole[p] ? 0 : 1
    conf[p] = hole[p] ? 0 : 1
  }
  let todo: number[] = []
  for (let p = 0; p < N; p++) if (hole[p]) todo.push(p)

  const clampX = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x)
  const clampY = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y)

  let guard = N
  while (todo.length && guard-- > 0) {
    todo = todo.filter((p) => !known[p])
    if (!todo.length) break

    // 1) pick the front pixel with the highest priority = confidence * data term
    let bestP = -1
    let bestPri = -1
    for (const p of todo) {
      const x = p % w
      const y = (p - x) / w
      if (!(known[y > 0 ? p - w : p] || known[y < h - 1 ? p + w : p] || known[x > 0 ? p - 1 : p] || known[x < w - 1 ? p + 1 : p])) continue
      let c = 0
      let gx = 0
      let gy = 0
      let gm = -1
      for (let dy = -half; dy <= half; dy++) {
        const yy = clampY(y + dy)
        for (let dx = -half; dx <= half; dx++) {
          const xx = clampX(x + dx)
          const q = yy * w + xx
          c += conf[q]
          if (known[q] && xx > 0 && xx < w - 1 && yy > 0 && yy < h - 1 && known[q - 1] && known[q + 1] && known[q - w] && known[q + w]) {
            const ax = (gray[q + 1] - gray[q - 1]) / 2
            const ay = (gray[q + w] - gray[q - w]) / 2
            const m = ax * ax + ay * ay
            if (m > gm) ((gm = m), (gx = ax), (gy = ay))
          }
        }
      }
      c /= (2 * half + 1) ** 2
      // normal of the hole boundary
      const nx = (known[clampY(y) * w + clampX(x + 1)] ? 1 : 0) - (known[clampY(y) * w + clampX(x - 1)] ? 1 : 0)
      const ny = (known[clampY(y + 1) * w + clampX(x)] ? 1 : 0) - (known[clampY(y - 1) * w + clampX(x)] ? 1 : 0)
      const nl = Math.hypot(nx, ny) || 1
      const data = Math.abs((-gy * nx + gx * ny) / nl) / 255
      const pri = c * (data + 0.02)
      if (pri > bestPri) ((bestPri = pri), (bestP = p))
    }
    if (bestP < 0) {
      // isolated pixels with no known neighbour (should not happen): take any
      bestP = todo[0]
    }
    const px = bestP % w
    const py = (bestP - px) / w

    // 2) best matching fully-known source patch (SSD over the target's known pixels)
    const tk: number[] = []
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = px + dx
        const y = py + dy
        if (x >= 0 && x < w && y >= 0 && y < h && known[y * w + x]) tk.push(dy * w + dx)
      }
    }
    let bestCost = Infinity
    let bsx = -1
    let bsy = -1
    const search = (r: number, step: number) => {
      const x0 = Math.max(half, px - r)
      const x1 = Math.min(w - 1 - half, px + r)
      const y0 = Math.max(half, py - r)
      const y1 = Math.min(h - 1 - half, py + r)
      for (let sy = y0; sy <= y1; sy += step) {
        for (let sx = x0; sx <= x1; sx += step) {
          if (holeIn(sx - half, sy - half, sx + half, sy + half) !== 0) continue
          if (banSolid && solidIn(sx - half, sy - half, sx + half, sy + half) !== 0) continue
          const base = sy * w + sx
          let cost = 0
          for (let t = 0; t < tk.length; t++) {
            const o = tk[t]
            const a = (bestP + o) * 4
            const b = (base + o) * 4
            const dr = d[a] - d[b]
            const dg = d[a + 1] - d[b + 1]
            const db = d[a + 2] - d[b + 2]
            cost += dr * dr + dg * dg + db * db
            if (cost >= bestCost) break
          }
          if (cost < bestCost) ((bestCost = cost), (bsx = sx), (bsy = sy))
        }
      }
    }
    search(R, 1)
    if (bsx < 0) search(Math.max(w, h), 3)
    if (bsx < 0) {
      // nothing usable: leave the pixel as it is
      known[bestP] = 1
      continue
    }

    // 3) copy the unknown pixels of the target patch
    const c0 = conf[bestP] || 0.5
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = px + dx
        const y = py + dy
        if (x < 0 || x >= w || y < 0 || y >= h) continue
        const q = y * w + x
        if (known[q]) continue
        const s = ((bsy + dy) * w + (bsx + dx)) * 4
        d[q * 4] = d[s]
        d[q * 4 + 1] = d[s + 1]
        d[q * 4 + 2] = d[s + 2]
        gray[q] = gray[s / 4]
        known[q] = 1
        conf[q] = c0
      }
    }
  }
}
