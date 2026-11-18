import { readFileSync } from 'node:fs'
import { buildInkMask } from '../src/lib/inpaint'
const w = 720, h = 1008
const d = new Uint8ClampedArray(readFileSync('pg.rgba'))
const box: [number, number, number, number] = [156, 186, 606, 653]
const lum = (p: number) => d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11
const share = (a: number, b: number) => {
  const A = buildInkMask(d, w, h, box, '#000000', a), B = buildInkMask(d, w, h, box, '#000000', b)
  let n = 0, o = 0
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { const p = y * w + x; if (!B[p] || A[p]) continue; n++; if (lum(p) > 215) o++ }
  return +(o / n).toFixed(2)
}
for (const [a, b] of [[1, 2], [1, 3], [2, 4], [2, 5], [4, 7], [6, 10], [8, 12]]) console.log(a, b, share(a, b))
let ink = 0
const m0 = buildInkMask(d, w, h, box, '#000000', 0)
for (let i = 0; i < m0.length; i++) ink += m0[i]
console.log('ink share', (ink / ((box[2] - box[0]) * (box[3] - box[1]))).toFixed(3))
import { lookOfPixels } from '../src/lib/inpaint'
console.log('page-scale look:', lookOfPixels(d, w, h, box, '#000000', 120))
