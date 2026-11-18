/**
 * Real font files for the exported text, so it keeps the look of the editor:
 *  1. the web fonts of the editor (Comic Neue, Anton, Bangers, Patrick Hand, Bodoni Moda), bundled with the
 *     app as WOFF files (works offline; fontkit cannot subset WOFF2, so we do not use Google's files);
 *  2. fonts installed on the computer (Verdana, Arial, Times...) via the Local Font Access API
 *     (Chrome/Edge asks permission once, when you export).
 * Returns null when neither works: the export then falls back to a standard PDF font.
 */
type LocalFont = { family: string; style: string; blob: () => Promise<Blob> }

const bundled = import.meta.glob(
  '../../node_modules/@fontsource/{anton,bangers,comic-neue,patrick-hand,bodoni-moda}/files/*-latin-{400,700}-{normal,italic}.woff',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>

const slug = (family: string) => family.toLowerCase().replace(/\s+/g, '-')

async function fromBundled(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  const s = slug(family)
  const find = (w: number, st: string) => Object.entries(bundled).find(([k]) => k.endsWith(`/${s}-latin-${w}-${st}.woff`))?.[1]
  const url =
    find(bold ? 700 : 400, italic ? 'italic' : 'normal') ??
    find(bold ? 700 : 400, 'normal') ??
    find(400, italic ? 'italic' : 'normal') ??
    find(400, 'normal')
  if (!url) return null
  return new Uint8Array(await (await fetch(url)).arrayBuffer())
}

let localList: Promise<LocalFont[]> | null = null
const listLocal = () =>
  (localList ??= (async () => {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
    if (!q) return []
    try {
      return await q.call(window)
    } catch {
      return [] // permission denied
    }
  })())

async function fromLocal(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  const all = (await listLocal()).filter((f) => f.family.toLowerCase() === family.toLowerCase())
  const hit = all.find((f) => /bold/i.test(f.style) === bold && /italic|oblique/i.test(f.style) === italic)
  if (!hit) return null
  const buf = new Uint8Array(await (await hit.blob()).arrayBuffer())
  // a .ttc collection cannot be embedded as is
  return String.fromCharCode(...buf.subarray(0, 4)) === 'ttcf' ? null : buf
}

const cache = new Map<string, Promise<Uint8Array | null>>()
export function loadFontBytes(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  const key = `${family}|${bold}|${italic}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      try {
        return (await fromBundled(family, bold, italic)) ?? (await fromLocal(family, bold, italic))
      } catch (e) {
        console.warn('font lookup failed', family, e)
        return null
      }
    })()
    cache.set(key, p)
  }
  return p
}
