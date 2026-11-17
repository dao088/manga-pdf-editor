/** All rects are normalized (0..1) relative to the page, so they survive zoom. */
export type Rect = { x: number; y: number; w: number; h: number }

export const uid = () => crypto.randomUUID()

export const contains = (r: Rect, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

export function union(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  const x1 = Math.max(...rs.map((r) => r.x + r.w))
  const y1 = Math.max(...rs.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function overlapRatio(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return 0
  const inter = (x1 - x0) * (y1 - y0)
  return inter / Math.min(a.w * a.h, b.w * b.h)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
