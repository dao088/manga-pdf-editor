import { readFileSync } from 'node:fs'
import { lookOfPixels } from '../src/lib/inpaint'
const d = new Uint8ClampedArray(readFileSync('test/crop.rgba'))
console.log('heavy text on hatching:', lookOfPixels(d, 372, 399, [80, 95, 315, 315], '#000000', 120))
