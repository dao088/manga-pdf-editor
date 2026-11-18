// Run: npx tsx test/export.test.ts test/fixture.pdf test/out.pdf
import { readFileSync, writeFileSync } from 'node:fs'
import { exportPdf } from '../src/lib/export'
import { editSig } from '../src/lib/style'
import type { TextEditT } from '../src/store'

const [, , inp, outp] = process.argv
const H = 800
const W = 600
// block = the 3 lines of the first bubble (same maths as blocks.ts: y0 = baseline - .85fs, y1 = baseline + .25fs)
const fs = 20
const top = (H - 700 - fs * 0.85) / H
const bot = (H - 652 + fs * 0.25) / H
const origRect = { x: 120 / W, y: top, w: 260 / W, h: bot - top }
const rect = { x: origRect.x - 0.01, y: origRect.y - 0.005, w: origRect.w + 0.02, h: origRect.h + 0.01 }

const base: TextEditT = {
  id: 'e1', page: 1, blockId: 'b1', rect, original: 'My body had finally begun to rebel against going',
  text: 'Mi cuerpo por fin empezó a rebelarse contra el trabajo… ¿Qué más?', font: 'Verdana', size: 20, color: '#000000',
  bg: '#ffffff', bold: false, italic: true, align: 'center', lineHeight: 1.2, autoFit: true, origRect,
}
const untouched: TextEditT = { ...base, id: 'e2', blockId: 'b2', origRect: { x: 120 / W, y: (H - 200 - 16 * 0.85) / H, w: 0.4, h: 0.03 },
  rect: { x: 0.18, y: 0.74, w: 0.45, h: 0.04 }, text: 'Other bubble stays', original: 'Other bubble stays', size: 16 }
untouched.sig = editSig(untouched)

const out = await exportPdf(new Uint8Array(readFileSync(inp)), [base, untouched], [])
writeFileSync(outp, out)
console.log('exported', out.length, 'bytes')
