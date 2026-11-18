/**
 * Real text editing for the exported PDF (what Acrobat does): the original text-showing operators are
 * REMOVED from the page content stream, and the new text is written as real text again, so nothing is
 * pasted on top of the page. This file has no browser dependency (it runs in Node too, for tests).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFRawStream,
  PDFStream,
  StandardFonts,
  beginText,
  decodePDFRawStream,
  endText,
  LineJoinStyle,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFPage,
} from 'pdf-lib'
import type { Rect } from './geometry'
import { parseFontName } from './style'
import type { TextEditT } from '../store'

/* ------------------------------------------------------------------ */
/* 1. Content-stream lexer                                             */
/* ------------------------------------------------------------------ */

type Tok = { k: 'num' | 'name' | 'str' | 'arr' | 'dict' | 'op'; s: number; e: number; v?: number | string }

const isWS = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32
const isDelim = (c: number) =>
  c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/

function ascii(b: Uint8Array, s: number, e: number): string {
  let out = ''
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i])
  return out
}

function skipString(b: Uint8Array, i: number): number {
  let depth = 0
  for (; i < b.length; i++) {
    const c = b[i]
    if (c === 92) i++
    else if (c === 40) depth++
    else if (c === 41 && --depth === 0) return i + 1
  }
  return b.length
}

function skipHex(b: Uint8Array, i: number): number {
  while (i < b.length && b[i] !== 62) i++
  return Math.min(b.length, i + 1)
}

function skipDict(b: Uint8Array, i: number): number {
  let depth = 0
  while (i < b.length) {
    if (b[i] === 40) i = skipString(b, i)
    else if (b[i] === 60 && b[i + 1] === 60) (depth++, (i += 2))
    else if (b[i] === 62 && b[i + 1] === 62) {
      i += 2
      if (--depth === 0) return i
    } else i++
  }
  return b.length
}

function skipArray(b: Uint8Array, i: number): number {
  let depth = 0
  while (i < b.length) {
    const c = b[i]
    if (c === 40) i = skipString(b, i)
    else if (c === 60) i = b[i + 1] === 60 ? skipDict(b, i) : skipHex(b, i + 1)
    else if (c === 91) (depth++, i++)
    else if (c === 93) {
      i++
      if (--depth === 0) return i
    } else i++
  }
  return b.length
}

/** i = index just after "BI". Returns the index just after the closing "EI". */
function skipInlineImage(b: Uint8Array, i: number): number {
  const n = b.length
  let j = i
  for (; j < n - 2; j++) if (isWS(b[j - 1] ?? 32) && b[j] === 73 && b[j + 1] === 68 && isWS(b[j + 2])) break
  for (let k = j + 3; k < n - 2; k++) {
    if (isWS(b[k]) && b[k + 1] === 69 && b[k + 2] === 73 && (k + 3 >= n || isWS(b[k + 3]))) return k + 3
  }
  return n
}

function lex(b: Uint8Array): Tok[] {
  const toks: Tok[] = []
  const n = b.length
  let i = 0
  while (i < n) {
    const c = b[i]
    if (isWS(c)) {
      i++
      continue
    }
    if (c === 37) {
      while (i < n && b[i] !== 10 && b[i] !== 13) i++
      continue
    }
    const s = i
    if (c === 40) {
      i = skipString(b, i)
      toks.push({ k: 'str', s, e: i })
    } else if (c === 91) {
      i = skipArray(b, i)
      toks.push({ k: 'arr', s, e: i })
    } else if (c === 60) {
      if (b[i + 1] === 60) {
        i = skipDict(b, i)
        toks.push({ k: 'dict', s, e: i })
      } else {
        i = skipHex(b, i + 1)
        toks.push({ k: 'str', s, e: i })
      }
    } else if (c === 47) {
      i++
      while (i < n && !isWS(b[i]) && !isDelim(b[i])) i++
      toks.push({ k: 'name', s, e: i, v: ascii(b, s + 1, i) })
    } else if (isDelim(c)) {
      i++
    } else {
      while (i < n && !isWS(b[i]) && !isDelim(b[i])) i++
      const w = ascii(b, s, i)
      if (NUM.test(w)) toks.push({ k: 'num', s, e: i, v: parseFloat(w) })
      else if (w === 'BI') {
        i = skipInlineImage(b, i)
        toks.push({ k: 'op', s, e: i, v: 'BI' })
      } else toks.push({ k: 'op', s, e: i, v: w })
    }
  }
  return toks
}

/* ------------------------------------------------------------------ */
/* 2. Removing the text that sits inside given rectangles              */
/* ------------------------------------------------------------------ */

type M = [number, number, number, number, number, number]
const I: M = [1, 0, 0, 1, 0, 0]
/** m is applied first, then n (PDF row-vector convention). */
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]

export type PageBox = { x: number; y: number; w: number; h: number }
export type StripTarget = { id: string; rect: Rect }
export type StripHit = { id: string; count: number; visible: number; fontRes?: string }

type GS = { ctm: M; font: string; size: number; tr: number; rise: number; leading: number }

export function stripShownText(src: Uint8Array, box: PageBox, targets: StripTarget[]): { out: Uint8Array; hits: Map<string, StripHit> } {
  const toks = lex(src)
  const hits = new Map<string, StripHit>(targets.map((t) => [t.id, { id: t.id, count: 0, visible: 0 }]))
  const cuts: { s: number; e: number; text: string }[] = []

  let g: GS = { ctm: I, font: '', size: 0, tr: 0, rise: 0, leading: 0 }
  const stack: GS[] = []
  let tm: M = I
  let tlm: M = I
  let args: Tok[] = []
  const num = (t?: Tok) => (t && t.k === 'num' ? (t.v as number) : 0)

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -g.leading], tlm)
    tm = tlm
  }

  const handleShow = (opTok: Tok, strTok: Tok | undefined, kind: string) => {
    if (!strTok || !args.length) return
    const x1 = tm[2] * g.rise + tm[4]
    const y1 = tm[3] * g.rise + tm[5]
    const X = g.ctm[0] * x1 + g.ctm[2] * y1 + g.ctm[4]
    const Y = g.ctm[1] * x1 + g.ctm[3] * y1 + g.ctm[5]
    const fs = Math.abs(g.size) * Math.hypot(tm[2], tm[3]) * Math.hypot(g.ctm[2], g.ctm[3])
    const tol = Math.max(1.5, fs * 0.15)
    const nx = (X - box.x) / box.w
    const ny = 1 - (Y - box.y) / box.h
    const tx = tol / box.w
    const ty = tol / box.h
    const t = targets.find((q) => nx >= q.rect.x - tx && nx <= q.rect.x + q.rect.w + tx && ny >= q.rect.y - ty && ny <= q.rect.y + q.rect.h + ty)
    if (!t) return
    const h = hits.get(t.id)!
    h.count++
    if (g.tr !== 3 && g.tr !== 7) h.visible++
    h.fontRes ??= g.font
    // keep the side effects of ' and " (move to next line, word/char spacing); drop only the glyphs
    const keep = kind === "'" ? 'T*' : kind === '"' ? `${num(args[0])} Tw ${num(args[1])} Tc T*` : ''
    cuts.push({ s: args[0].s, e: opTok.e, text: keep })
  }

  for (const t of toks) {
    if (t.k !== 'op') {
      args.push(t)
      continue
    }
    const op = t.v as string
    switch (op) {
      case 'q':
        stack.push({ ...g })
        break
      case 'Q':
        g = stack.pop() ?? g
        break
      case 'cm':
        g = { ...g, ctm: mul([num(args[0]), num(args[1]), num(args[2]), num(args[3]), num(args[4]), num(args[5])], g.ctm) }
        break
      case 'BT':
        tm = tlm = I
        break
      case 'Tf':
        g.font = (args[0]?.v as string) ?? g.font
        g.size = num(args[1])
        break
      case 'Tr':
        g.tr = num(args[0])
        break
      case 'Ts':
        g.rise = num(args[0])
        break
      case 'TL':
        g.leading = num(args[0])
        break
      case 'Td':
      case 'TD':
        if (op === 'TD') g.leading = -num(args[1])
        tlm = mul([1, 0, 0, 1, num(args[0]), num(args[1])], tlm)
        tm = tlm
        break
      case 'Tm':
        tlm = tm = [num(args[0]), num(args[1]), num(args[2]), num(args[3]), num(args[4]), num(args[5])]
        break
      case 'T*':
        nextLine()
        break
      case 'Tj':
      case 'TJ':
        handleShow(t, args[args.length - 1], op)
        break
      case "'":
        nextLine()
        handleShow(t, args[args.length - 1], op)
        break
      case '"':
        nextLine()
        handleShow(t, args[args.length - 1], op)
        break
    }
    args = []
  }

  if (!cuts.length) return { out: src, hits }
  const parts: Uint8Array[] = []
  const enc = new TextEncoder()
  let pos = 0
  for (const c of cuts) {
    parts.push(src.subarray(pos, c.s), enc.encode(c.text))
    pos = c.e
  }
  parts.push(src.subarray(pos))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return { out, hits }
}

/** Decoded content of a page as one byte array (all content streams joined). */
function readContents(page: PDFPage): Uint8Array | null {
  const c = page.node.Contents()
  const streams: PDFStream[] = []
  if (c instanceof PDFStream) streams.push(c)
  else if (c instanceof PDFArray) {
    for (let i = 0; i < c.size(); i++) {
      const s = c.lookupMaybe(i, PDFStream)
      if (s) streams.push(s)
    }
  }
  if (!streams.length) return null
  const chunks = streams.map((s) =>
    s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents(),
  )
  const out = new Uint8Array(chunks.reduce((n, p) => n + p.length + 1, 0))
  let o = 0
  for (const p of chunks) {
    out.set(p, o)
    o += p.length
    out[o++] = 10
  }
  return out
}

/** Removes the text inside the given rectangles from the page's content. Returns what was removed per target. */
export function stripPageText(pdf: PDFDocument, page: PDFPage, targets: StripTarget[]): Map<string, StripHit> {
  const none = new Map<string, StripHit>(targets.map((t) => [t.id, { id: t.id, count: 0, visible: 0 }]))
  const src = readContents(page)
  if (!src) return none
  const cb = page.getCropBox()
  const { out, hits } = stripShownText(src, { x: cb.x, y: cb.y, w: cb.width, h: cb.height }, targets)
  if ([...hits.values()].some((h) => h.count > 0)) {
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(out)))
  }
  return hits
}

/* ------------------------------------------------------------------ */
/* 3. Fonts for the new text                                           */
/* ------------------------------------------------------------------ */

export type FontPlan = {
  key: PDFName
  width: (s: string, size: number) => number
  encode: (s: string) => PDFHexString
  /** distance from the middle of a line box down to its baseline, in em */
  baselineK: number
  /** replace characters the font cannot draw */
  clean: (s: string) => string
  reused: boolean
}

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}
const winAnsi = (cp: number): number | null =>
  (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? cp : (CP1252[cp] ?? null)

const hex = (codes: number[]) => PDFHexString.of(codes.map((c) => c.toString(16).padStart(2, '0')).join(''))

/** Same font resource the original text used, when it can draw the new text (simple, WinAnsi, with widths). */
export function reuseFontPlan(page: PDFPage, res: string | undefined, e: Pick<TextEditT, 'font' | 'bold' | 'italic'>): FontPlan | null {
  if (!res) return null
  const fonts = page.node.normalizedEntries().Resources.lookupMaybe(PDFName.of('Font'), PDFDict)
  const fd = fonts?.lookupMaybe(PDFName.of(res), PDFDict)
  if (!fd) return null
  const sub = fd.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText()
  if (sub !== 'TrueType' && sub !== 'Type1' && sub !== 'MMType1') return null
  const base = fd.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? ''
  const desc = fd.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
  const embedded = !!desc && (desc.has(PDFName.of('FontFile')) || desc.has(PDFName.of('FontFile2')) || desc.has(PDFName.of('FontFile3')))
  if (embedded && /^[A-Z]{6}\+/.test(base)) return null // subset: it only has the glyphs it already used

  const encObj = fd.lookup(PDFName.of('Encoding'))
  let encName: string | undefined
  if (encObj instanceof PDFName) encName = encObj.decodeText()
  else if (encObj instanceof PDFDict) {
    if (encObj.has(PDFName.of('Differences'))) return null
    encName = encObj.lookupMaybe(PDFName.of('BaseEncoding'), PDFName)?.decodeText()
  }
  if (encName !== 'WinAnsiEncoding') return null

  const first = fd.lookupMaybe(PDFName.of('FirstChar'), PDFNumber)?.asNumber()
  const wArr = fd.lookupMaybe(PDFName.of('Widths'), PDFArray)
  if (first === undefined || !wArr) return null
  const widths: number[] = []
  for (let i = 0; i < wArr.size(); i++) widths.push(wArr.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0)
  const missing = desc?.lookupMaybe(PDFName.of('MissingWidth'), PDFNumber)?.asNumber() ?? 0

  // style must still be the original one (if the user changed font/bold/italic, embed the chosen font instead)
  const parsed = parseFontName(base)
  const flags = desc?.lookupMaybe(PDFName.of('Flags'), PDFNumber)?.asNumber() ?? 0
  const angle = desc?.lookupMaybe(PDFName.of('ItalicAngle'), PDFNumber)?.asNumber() ?? 0
  const italic = parsed.italic || angle !== 0 || (flags & 64) !== 0
  const bold = parsed.bold || (flags & 262144) !== 0
  if (parsed.font !== e.font || italic !== e.italic || bold !== e.bold) return null

  const asc = desc?.lookupMaybe(PDFName.of('Ascent'), PDFNumber)?.asNumber()
  const dsc = desc?.lookupMaybe(PDFName.of('Descent'), PDFNumber)?.asNumber()
  const codesOf = (s: string) => [...s].map((ch) => winAnsi(ch.codePointAt(0)!) ?? 0x3f)
  return {
    key: PDFName.of(res),
    reused: true,
    baselineK: asc !== undefined && dsc !== undefined ? (asc + dsc) / 2000 : 0.35,
    clean: (s) => [...s].map((ch) => (ch === '\n' || winAnsi(ch.codePointAt(0)!) !== null ? ch : '?')).join(''),
    encode: (s) => hex(codesOf(s)),
    width: (s, size) => (codesOf(s).reduce((w, c) => w + (widths[c - first] || missing), 0) / 1000) * size,
  }
}

const STANDARD: Record<string, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
}

export type FontCache = Map<string, PDFFont>

/** A font embedded in the PDF: the real font file when bytes are available, otherwise a standard font. */
export async function embeddedFontPlan(
  pdf: PDFDocument,
  page: PDFPage,
  e: Pick<TextEditT, 'font' | 'bold' | 'italic'>,
  text: string,
  fontBytes: ((family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>) | undefined,
  cache: FontCache,
): Promise<FontPlan> {
  const need = [...text].filter((ch) => ch !== '\n').map((ch) => ch.codePointAt(0)!)
  const ck = `${e.font}|${e.bold}|${e.italic}`
  const has = (f: PDFFont) => {
    const set = new Set(f.getCharacterSet())
    return need.every((cp) => set.has(cp) || cp === 32 || cp === 0xa0)
  }
  let font = cache.get(ck)
  if (!font && fontBytes && !cache.has(`${ck}|tried`)) {
    try {
      const bytes = await fontBytes(e.font, e.bold, e.italic)
      if (bytes) font = await pdf.embedFont(bytes, { subset: true })
    } catch (err) {
      console.warn('font embed failed, using a standard font', err)
    }
    if (font) cache.set(ck, font)
    else cache.set(`${ck}|tried`, null as unknown as PDFFont)
  }
  if (!font || !has(font)) {
    const serif = /times|bodoni|georgia|garamond|serif/i.test(e.font)
    const list = STANDARD[serif ? 'serif' : 'sans']
    const sk = `std|${serif}|${e.bold}|${e.italic}`
    font = cache.get(sk) ?? (await pdf.embedFont(list[e.bold && e.italic ? 3 : e.italic ? 2 : e.bold ? 1 : 0]))
    cache.set(sk, font)
  }

  const f = font
  const set = new Set(f.getCharacterSet())
  const kf = (f as unknown as { embedder?: { font?: { ascent: number; descent: number; unitsPerEm: number } } }).embedder?.font
  return {
    key: page.node.newFontDictionary(f.name, f.ref),
    reused: false,
    baselineK: kf && Number.isFinite((kf.ascent + kf.descent) / kf.unitsPerEm) ? (kf.ascent + kf.descent) / kf.unitsPerEm / 2 : 0.33,
    clean: (s) => [...s].map((ch) => (set.has(ch.codePointAt(0)!) || ch === ' ' || ch === '\n' ? ch : set.has(63) ? '?' : '')).join(''),
    encode: (s) => f.encodeText(s),
    width: (s, size) => f.widthOfTextAtSize(s, size),
  }
}

/* ------------------------------------------------------------------ */
/* 4. Writing the new text                                             */
/* ------------------------------------------------------------------ */

function wrap(plan: FontPlan, text: string, size: number, maxW: number): string[] {
  const out: string[] = []
  for (const para of plan.clean(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = words[0]
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`
      if (plan.width(next, size) <= maxW) line = next
      else {
        out.push(line)
        line = words[i]
      }
    }
    out.push(line)
  }
  return out
}

const hexColor = (h: string) => {
  const v = /^#?([0-9a-f]{6})$/i.exec(h)?.[1] ?? '000000'
  return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255)
}
export const hexToRgb = hexColor

const opNum = (name: string, n: number) => PDFOperator.of(name as never, [PDFNumber.of(n)])

/** Lays the edit's text out inside its rectangle (same rules as the on-screen editor) and writes it as real text. */
export function drawEditText(page: PDFPage, plan: FontPlan, e: TextEditT): void {
  if (!e.text.trim()) return
  const cb = page.getCropBox()
  const W = e.rect.w * cb.width
  const H = e.rect.h * cb.height
  let size = e.size
  let lines = wrap(plan, e.text, size, W)
  if (e.autoFit) {
    for (let s = e.size; s > 4; s -= 0.5) {
      const l = wrap(plan, e.text, s, W)
      size = s
      lines = l
      if (l.length * s * e.lineHeight <= H) break
    }
  }
  const pitch = size * e.lineHeight
  const top = (H - lines.length * pitch) / 2 + pitch / 2 // middle of the first line, from the box top
  const left = cb.x + e.rect.x * cb.width
  const topPdf = cb.y + cb.height - e.rect.y * cb.height

  const ops: PDFOperator[] = [pushGraphicsState()]
  const pass = (mode: 'stroke' | 'fill') => {
    ops.push(beginText(), setFontAndSize(plan.key, size), opNum('Tc', 0), opNum('Tw', 0), opNum('Tz', 100), opNum('Ts', 0))
    if (mode === 'stroke') {
      ops.push(setStrokingColor(hexColor(e.outline!)), setLineWidth(size * 0.18), setLineJoin(LineJoinStyle.Round), setTextRenderingMode(TextRenderingMode.Outline))
    } else {
      ops.push(setFillingColor(hexColor(e.color)), setTextRenderingMode(TextRenderingMode.Fill))
    }
    lines.forEach((l, i) => {
      if (!l) return
      const w = plan.width(l, size)
      const x = e.align === 'center' ? left + (W - w) / 2 : e.align === 'right' ? left + W - w : left
      const y = topPdf - (top + i * pitch + plan.baselineK * size)
      ops.push(setTextMatrix(1, 0, 0, 1, x, y), showText(plan.encode(l)))
    })
    ops.push(endText())
  }
  if (e.outline) pass('stroke') // outline first, letters on top (same as the editor)
  pass('fill')
  ops.push(popGraphicsState())
  page.pushOperators(...ops)
}
