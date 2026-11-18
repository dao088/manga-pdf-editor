import { readFileSync, writeFileSync } from 'node:fs'
import { exportPdf } from '../src/lib/export'
import type { TextEditT } from '../src/store'
const bytes = new Uint8Array(readFileSync('test/fixture.pdf'))
const woff2 = new Uint8Array(readFileSync('test/font.woff'))
const e: TextEditT = { id: 'e1', page: 1, blockId: 'b', rect: { x: 0.2, y: 0.08, w: 0.45, h: 0.1 }, original: 'x', text: 'Cuándo estaba… ¿sin salida?', font: 'Anton', size: 24, color: '#000000', bg: '#ffffff', bold: false, italic: false, align: 'center', lineHeight: 1.2, autoFit: true, outline: '#ffffff' }
const out = await exportPdf(bytes, [e], [], { fontBytes: async () => woff2 })
writeFileSync('test/w2.pdf', out); console.log('woff2 embed ok', out.length)
