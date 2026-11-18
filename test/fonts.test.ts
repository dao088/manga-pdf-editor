import { readFileSync, writeFileSync } from 'node:fs'
import { exportPdf } from '../src/lib/export'
import type { TextEditT } from '../src/store'

const bytes = new Uint8Array(readFileSync(process.argv[2]))
const ttf = process.argv[3] ? new Uint8Array(readFileSync(process.argv[3])) : null
const H = 800, W = 600, fs = 20
const top = (H - 700 - fs * 0.85) / H
const bot = (H - 652 + fs * 0.25) / H
const origRect = { x: 120 / W, y: top, w: 260 / W, h: bot - top }
const e: TextEditT = {
  id: 'e1', page: 1, blockId: 'b1', rect: { ...origRect, x: origRect.x - 0.01, w: origRect.w + 0.02 }, original: 'x',
  text: 'Después de más de una década\ntrabajando en una empresa explotadora', font: 'Comic Neue', size: 20, color: '#1a1aa0',
  bg: '#ffffff', bold: true, italic: false, align: 'center', lineHeight: 1.2, autoFit: true, origRect, outline: '#ffffff',
}
let asked = ''
const out = await exportPdf(bytes, [e], [], { fontBytes: async (f, b, i) => ((asked = `${f} b=${b} i=${i}`), ttf) })
writeFileSync(process.argv[4], out)
console.log('font requested:', asked)
