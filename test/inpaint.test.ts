// npx tsx test/inpaint.test.ts crop.rgba W H x0 y0 x1 y1 out.rgba
import { readFileSync, writeFileSync } from 'node:fs'
import { buildInkMask } from '../src/lib/inpaint'
import { exemplarFill } from '../src/lib/exemplar'
const [, , f, W, H, x0, y0, x1, y1, outp] = process.argv
const w = +W, h = +H
const d = new Uint8ClampedArray(readFileSync(f))
const mask = buildInkMask(d, w, h, [+x0, +y0, +x1, +y1], '#000000', 3)
const t = Date.now()
exemplarFill(d, w, h, mask, { half: 4, radius: 70 })
console.log('mask px', mask.reduce((a, b) => a + b, 0), 'ms', Date.now() - t)
writeFileSync(outp, d)
