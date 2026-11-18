import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { editSig } from './style'
import {
  drawEditText,
  embeddedFontPlan,
  hexToRgb,
  reuseFontPlan,
  stripPageText,
  type FontCache,
  type StripHit,
} from './pdfText'
import type { CommentT, TextEditT } from '../store'

export type ExportHooks = {
  /** bytes of a real font file (so the new text keeps the original look); null = use a standard font */
  fontBytes?: (family: string, bold: boolean, italic: boolean) => Promise<Uint8Array | null>
}

async function buildPdf(
  bytes: Uint8Array,
  allEdits: TextEditT[],
  comments: CommentT[],
  hooks: ExportHooks = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes.slice())
  pdf.registerFontkit(fontkit)
  const pages = pdf.getPages()
  const fonts: FontCache = new Map()

  // blocks of real PDF text that were opened but not changed stay exactly as they are
  const edits = allEdits.filter((e) => !(e.origRect && e.sig && e.sig === editSig(e)))

  // 1) like Acrobat: delete the original text from the page content itself
  const removed = new Map<string, StripHit>()
  const byPage = new Map<number, TextEditT[]>()
  for (const e of edits) if (e.origRect) byPage.set(e.page, [...(byPage.get(e.page) ?? []), e])
  for (const [n, list] of byPage) {
    const page = pages[n - 1]
    if (!page) continue
    const hits = stripPageText(pdf, page, list.map((e) => ({ id: e.id, rect: e.origRect! })))
    hits.forEach((h, id) => removed.set(id, h))
  }

  // 2) background where needed + the new text, as real text
  for (const e of edits) {
    const page = pages[e.page - 1]
    if (!page) continue
    const cb = page.getCropBox()
    if (e.cover) {
      const blob = await (await fetch(e.cover.img)).blob()
      const jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()))
      page.drawImage(jpg, {
        x: cb.x + e.cover.rect.x * cb.width,
        y: cb.y + cb.height - (e.cover.rect.y + e.cover.rect.h) * cb.height,
        width: e.cover.rect.w * cb.width,
        height: e.cover.rect.h * cb.height,
      })
    } else if (!(removed.get(e.id)?.visible ?? 0)) {
      // the lettering is part of the page image (or its text was invisible): paint the background over it
      page.drawRectangle({
        x: cb.x + e.rect.x * cb.width,
        y: cb.y + cb.height - (e.rect.y + e.rect.h) * cb.height,
        width: e.rect.w * cb.width,
        height: e.rect.h * cb.height,
        color: hexToRgb(e.bg),
      })
    }
    if (!e.text.trim()) continue
    const plan =
      reuseFontPlan(page, removed.get(e.id)?.fontRes, e) ??
      (await embeddedFontPlan(pdf, page, e, e.text, hooks.fontBytes, fonts))
    drawEditText(page, plan, e)
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

/** Builds the PDF; if embedding a custom font breaks, retries with standard PDF fonts instead of failing. */
export async function exportPdf(bytes: Uint8Array, edits: TextEditT[], comments: CommentT[], hooks: ExportHooks = {}): Promise<Uint8Array> {
  try {
    return await buildPdf(bytes, edits, comments, hooks)
  } catch (err) {
    if (!hooks.fontBytes) throw err
    console.warn('export with custom fonts failed, retrying with standard fonts', err)
    return buildPdf(bytes, edits, comments, {})
  }
}
