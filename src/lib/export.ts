import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { fitSize, fontSpec, wrapLines } from './style'
import type { CommentT, TextEditT } from '../store'

const SCALE = 3

async function renderEditPng(e: TextEditT, pageW: number, pageH: number): Promise<Uint8Array> {
  const size = fitSize(e, pageW, pageH)
  await document.fonts.load(fontSpec(e, size))
  const w = Math.ceil(e.rect.w * pageW * SCALE)
  const h = Math.ceil(e.rect.h * pageH * SCALE)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = e.bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = e.color
  ctx.font = fontSpec(e, size * SCALE)
  ctx.textBaseline = 'middle'
  const lines = wrapLines(ctx, e.text, w)
  const pitch = size * SCALE * e.lineHeight
  const top = (h - lines.length * pitch) / 2 + pitch / 2
  ctx.textAlign = e.align === 'justify' ? 'left' : e.align
  const x = e.align === 'center' ? w / 2 : e.align === 'right' ? w : 0
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * pitch))
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function exportPdf(bytes: Uint8Array, edits: TextEditT[], comments: CommentT[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes.slice())
  const pages = pdf.getPages()

  for (const e of edits) {
    const page = pages[e.page - 1]
    if (!page) continue
    const { width: W, height: H } = page.getSize()
    const png = await pdf.embedPng(await renderEditPng(e, W, H))
    page.drawImage(png, {
      x: e.rect.x * W,
      y: H - (e.rect.y + e.rect.h) * H,
      width: e.rect.w * W,
      height: e.rect.h * H,
    })
  }

  const ctx = pdf.context
  for (const c of comments) {
    if (c.draft) continue
    const page = pages[c.page - 1]
    if (!page) continue
    const { width: W, height: H } = page.getSize()
    const contents = [c.text, ...c.replies.map((r) => `\n— ${r.text}`)].join('')
    const rects = c.rects.map((r) => ({ x0: r.x * W, x1: (r.x + r.w) * W, y1: H - r.y * H, y0: H - (r.y + r.h) * H }))
    const all = {
      x0: Math.min(...rects.map((r) => r.x0)),
      y0: Math.min(...rects.map((r) => r.y0)),
      x1: Math.max(...rects.map((r) => r.x1)),
      y1: Math.max(...rects.map((r) => r.y1)),
    }
    const base = {
      Type: 'Annot',
      Contents: PDFHexString.fromText(contents),
      T: PDFHexString.fromText('USUARIO'),
      F: 4,
      C: [1, 0.9, 0.3],
    }
    const annot = c.quote
      ? ctx.obj({
          ...base,
          Subtype: 'Highlight',
          Rect: [all.x0, all.y0, all.x1, all.y1],
          QuadPoints: rects.flatMap((r) => [r.x0, r.y1, r.x1, r.y1, r.x0, r.y0, r.x1, r.y0]),
        })
      : ctx.obj({
          ...base,
          Subtype: 'Text',
          Name: PDFName.of('Comment'),
          Rect: [all.x0, all.y1 - 20, all.x0 + 20, all.y1],
        })
    page.node.addAnnot(ctx.register(annot))
  }
  return pdf.save()
}
