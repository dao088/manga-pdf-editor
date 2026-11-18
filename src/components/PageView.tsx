import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanText, MessageSquare } from 'lucide-react'
import { pdfjs, registerCanvas, getCanvas, type PDFDocumentProxy } from '../lib/pdf'
import { blocksFromOcr, blocksFromPdf, mergeBlockSets, ocrRegion } from '../lib/blocks'
import { clamp, contains, uid, type Rect } from '../lib/geometry'
import { detectLook, inpaintRegion } from '../lib/inpaint'
import { detectColors, editSig, parseFontName } from '../lib/style'
import { useStore, type Block, type TextEditT } from '../store'
import { EditBox } from './EditBox'

type Props = { doc: PDFDocumentProxy; pageNumber: number }

let ocrQueue: Promise<unknown> = Promise.resolve()

export function PageView({ doc, pageNumber }: Props) {
  const scale = useStore((s) => s.scale)
  const tool = useStore((s) => s.tool)
  const granularity = useStore((s) => s.granularity)
  const size = useStore((s) => s.pageSizes[pageNumber])
  const first = useStore((s) => s.pageSizes[1])
  const blocks = useStore((s) => s.blocks[pageNumber])
  const busy = useStore((s) => s.busy[pageNumber])
  const allComments = useStore((s) => s.comments)
  const allEdits = useStore((s) => s.edits)
  const activeCommentId = useStore((s) => s.activeCommentId)
  const st = useStore

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<Rect | null>(null)

  const comments = useMemo(() => allComments.filter((c) => c.page === pageNumber), [allComments, pageNumber])
  const edits = useMemo(() => allEdits.filter((e) => e.page === pageNumber), [allEdits, pageNumber])

  const dims = size ?? first ?? { w: 595, h: 842 }
  const pxW = dims.w * scale
  const pxH = dims.h * scale

  // page size at scale 1 (points)
  useEffect(() => {
    doc.getPage(pageNumber).then((p) => {
      const v = p.getViewport({ scale: 1 })
      st.getState().setPageSize(pageNumber, { w: v.width, h: v.height })
    })
  }, [doc, pageNumber, st])

  // lazy rendering
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '900px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // canvas + text layer
  useEffect(() => {
    if (!visible || !size) return
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null
    let layer: { cancel: () => void } | null = null
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      await task.promise
      registerCanvas(pageNumber, canvas)
      const container = textRef.current!
      container.replaceChildren()
      container.style.setProperty('--scale-factor', String(scale))
      container.style.setProperty('--total-scale-factor', String(scale))
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport })
      layer = tl
      await tl.render()
    })().catch((e) => {
      if (e?.name !== 'RenderingCancelledException' && e?.name !== 'AbortException') console.error(e)
    })
    return () => {
      task?.cancel()
      layer?.cancel()
    }
  }, [visible, doc, pageNumber, scale, size])

  // detect text blocks when entering edit mode
  useEffect(() => {
    if (tool !== 'edit' || !visible || blocks || !size) return
    let alive = true
    ;(async () => {
      const page = await doc.getPage(pageNumber)
      const set = await blocksFromPdf(page, pageNumber)
      if (alive) st.getState().setBlocks(pageNumber, set ?? { line: [], group: [], source: 'pdf' })
    })()
    return () => {
      alive = false
    }
  }, [tool, visible, blocks, size, doc, pageNumber, st])

  const flash = (msg: string, ms = 3000) => {
    st.getState().setBusy(pageNumber, msg)
    setTimeout(() => st.getState().setBusy(pageNumber, undefined), ms)
  }

  const runOcr = async () => {
    const s = st.getState()
    s.setBusy(pageNumber, 'Running OCR…')
    try {
      const page = await doc.getPage(pageNumber)
      const have = st.getState().blocks[pageNumber]?.line.filter((b) => b.source === 'pdf').map((b) => b.rect) ?? []
      const ocr = await blocksFromOcr(page, pageNumber, have)
      s.setBlocks(pageNumber, mergeBlockSets(st.getState().blocks[pageNumber], ocr))
      flash(`Found ${ocr.group.length} blocks — missing something? Use "Draw box"`, 5000)
    } catch (e) {
      console.error(e)
      flash('OCR failed (it needs internet the first time) — use "Draw box" instead', 7000)
    }
  }

  // toolbar button: "Detect text (OCR)" for the current page
  const runOcrRef = useRef(runOcr)
  runOcrRef.current = runOcr
  useEffect(() => {
    const onOcr = (e: Event) => {
      if ((e as CustomEvent<number>).detail === pageNumber) void runOcrRef.current()
    }
    window.addEventListener('mpe:ocr', onOcr)
    return () => window.removeEventListener('mpe:ocr', onOcr)
  }, [pageNumber])

  // like Acrobat: entering the edit tool detects the lettering by itself (queued, one page at a time)
  const autoRan = useRef(false)
  useEffect(() => {
    if (tool !== 'edit' || !visible || !blocks || autoRan.current) return
    autoRan.current = true
    st.getState().setBusy(pageNumber, 'Waiting for OCR…')
    ocrQueue = ocrQueue.then(() => runOcrRef.current()).catch(() => undefined)
  }, [tool, visible, blocks, pageNumber, st])

  const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30))

  const createEdit = async (b: Block) => {
    const s = st.getState()
    const existing = s.edits.find((e) => e.page === pageNumber && e.blockId === b.id)
    if (existing) return s.setActiveEdit(existing.id)
    const canvas = getCanvas(pageNumber)
    const colors = canvas ? detectColors(canvas, b.rect) : { bg: '#ffffff', color: '#000000' }
    const f = parseFontName(b.fontName)
    // lettering baked in the page image: copy its look (heavy? outline?) since there is no font to read
    const look = canvas && !b.fontName ? detectLook(canvas, b.rect, colors.color, colors.bg) : { heavy: false, outline: '' }
    let rectCover: TextEditT['cover']
    if (canvas && b.source === 'ocr') {
      s.setBusy(pageNumber, 'Rebuilding background…')
      await nextFrame() // let the label paint before the heavy work
      rectCover = coverFor(canvas, b.rect, colors.color)
      st.getState().setBusy(pageNumber, undefined)
    }
    const padX = b.rect.w * 0.04
    const padY = b.rect.h * 0.06
    const rect: Rect = {
      x: clamp(b.rect.x - padX, 0, 1),
      y: clamp(b.rect.y - padY, 0, 1),
      w: Math.min(1, b.rect.w + padX * 2),
      h: Math.min(1, b.rect.h + padY * 2),
    }
    const edit: TextEditT = {
      id: uid(),
      page: pageNumber,
      blockId: b.id,
      rect,
      original: b.text,
      text: b.text,
      font: look.heavy ? 'Anton' : f.font, // heavy baked-in lettering is condensed display type: Anton is the closest we have
      size: Math.max(6, Math.round(b.fontSize * 2) / 2),
      color: colors.color,
      bg: colors.bg,
      bold: look.heavy ? false : f.bold,
      italic: f.italic,
      align: b.align,
      lineHeight: Math.round(b.lineHeight * 100) / 100,
      autoFit: true,
      cover: rectCover,
      outline: look.outline || undefined,
      origRect: b.source === 'pdf' ? b.rect : undefined,
    }
    if (edit.origRect) edit.sig = editSig(edit)
    st.getState().addEdit(edit)
  }

  const norm = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const onMove = (e: React.MouseEvent) => {
    if (tool === 'edit') return
    const p = norm(e)
    const hit = comments.find((c) => !c.draft && c.rects.some((r) => contains(r, p.x, p.y)))
    setHover(hit ? { id: hit.id, x: p.x, y: p.y } : null)
  }

  const onRegionDown = (e: React.PointerEvent) => {
    const start = norm(e)
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const mk = (p: { x: number; y: number }): Rect => ({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    })
    const move = (m: PointerEvent) => setDrag(mk(norm(m)))
    const up = (m: PointerEvent) => {
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      const r = mk(norm(m))
      setDrag(null)
      if (r.w > 0.01 && r.h > 0.01) {
        st.getState().addComment({
          id: uid(),
          page: pageNumber,
          rects: [r],
          quote: '',
          text: '',
          createdAt: Date.now(),
          replies: [],
          draft: true,
        })
      }
    }
    target.addEventListener('pointermove', move as EventListener)
    target.addEventListener('pointerup', up as EventListener)
  }

  /** Manual edit: drag a box over any lettering. Colours are sampled; text is typed (OCR only suggests it). */
  const onBoxDown = (e: React.PointerEvent) => {
    const start = norm(e)
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const mk = (p: { x: number; y: number }): Rect => {
      const x0 = clamp(Math.min(start.x, p.x), 0, 1)
      const y0 = clamp(Math.min(start.y, p.y), 0, 1)
      return { x: x0, y: y0, w: clamp(Math.max(start.x, p.x), 0, 1) - x0, h: clamp(Math.max(start.y, p.y), 0, 1) - y0 }
    }
    const move = (m: PointerEvent) => setDrag(mk(norm(m)))
    const up = (m: PointerEvent) => {
      target.removeEventListener('pointermove', move as EventListener)
      target.removeEventListener('pointerup', up as EventListener)
      const r = mk(norm(m))
      setDrag(null)
      if (r.w * dims.w > 12 && r.h * dims.h > 8) createManualEdit(r)
    }
    target.addEventListener('pointermove', move as EventListener)
    target.addEventListener('pointerup', up as EventListener)
  }

  const coverFor = (canvas: HTMLCanvasElement, rect: Rect, ink: string) => {
    try {
      const img = inpaintRegion(canvas, rect, ink)
      return img ? { rect, img, ink } : undefined
    } catch (err) {
      console.error(err)
      return undefined
    }
  }

  const createManualEdit = (rect: Rect) => {
    const s = st.getState()
    const canvas = getCanvas(pageNumber)
    const colors = canvas ? detectColors(canvas, rect) : { bg: '#ffffff', color: '#000000' }
    const look = canvas ? detectLook(canvas, rect, colors.color, colors.bg) : { heavy: true, outline: '' }
    const id = uid()
    const hPt = rect.h * dims.h
    s.addEdit({
      id,
      page: pageNumber,
      blockId: `manual-${id}`,
      rect,
      original: '',
      text: '',
      font: look.heavy ? 'Anton' : 'Comic Neue',
      size: Math.max(6, Math.round((hPt / 1.3) * 2) / 2),
      color: colors.color,
      bg: colors.bg,
      bold: false,
      italic: false,
      align: 'center',
      lineHeight: 1.15,
      autoFit: true,
      cover: canvas ? coverFor(canvas, rect, colors.color) : undefined,
      outline: look.outline,
    })
    // optional suggestion: never blocks typing, only fills the box if it is still empty
    s.setBusy(pageNumber, 'Reading text…')
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        const { text, lines } = await ocrRegion(page, rect)
        const cur = st.getState().edits.find((x) => x.id === id)
        if (cur && !cur.text && text) {
          const size = Math.max(6, Math.round((hPt / (lines * cur.lineHeight * 1.1)) * 2) / 2)
          st.getState().updateEdit(id, { text, original: text, size })
        }
        flash(text ? 'Text suggested — fix it as needed' : 'Could not read it — just type the text', 3500)
      } catch (err) {
        console.error(err)
        flash('Could not read it — just type the text', 3500)
      }
    })()
  }

  const hovered = hover ? comments.find((c) => c.id === hover.id) : null
  const visibleBlocks = (blocks?.[granularity] ?? []).filter((b) => !edits.some((e) => e.blockId === b.id))

  return (
    <div className="mx-auto mb-6" style={{ width: pxW }}>
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
        <span>
          Page {pageNumber}
          {tool === 'edit' && <span className="ml-3 text-blue-300">Click a blue block, or drag a box over any lettering that has none</span>}
        </span>
        {(tool === 'edit' || tool === 'box') && (
          <button
            onClick={runOcr}
            disabled={!!busy}
            className="flex items-center gap-1 rounded bg-neutral-700 px-2 py-0.5 hover:bg-neutral-600 disabled:opacity-50"
            title="Find text the PDF does not expose (large lettering, scans)"
          >
            <ScanText size={13} /> {busy ?? 'Detect more text (OCR)'}
          </button>
        )}
      </div>
      <div
        id={`page-${pageNumber}`}
        data-page={pageNumber}
        ref={wrapRef}
        className="relative bg-white shadow-lg"
        style={{ width: pxW, height: pxH }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div ref={textRef} className="textLayer" style={{ pointerEvents: tool === 'select' ? 'auto' : 'none' }} />

        {/* comment highlights + icon */}
        {comments.map((c) => (
          <div key={c.id} className="pointer-events-none absolute inset-0 z-20">
            {c.rects.map((r, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  background: c.quote ? 'rgba(253, 224, 71, 0.45)' : 'rgba(253, 224, 71, 0.15)',
                  border: c.quote ? undefined : '2px solid rgba(234, 179, 8, 0.9)',
                  mixBlendMode: c.quote ? 'multiply' : undefined,
                  outline: activeCommentId === c.id ? '2px solid #3b82f6' : undefined,
                }}
              />
            ))}
            <button
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-sm bg-yellow-300 p-0.5 text-yellow-900 shadow"
              style={{ left: `${c.rects[0].x * 100}%`, top: `${c.rects[0].y * 100}%` }}
              onClick={() => {
                st.getState().setActiveComment(c.id)
                st.getState().setPanel('comments')
              }}
            >
              <MessageSquare size={11} fill="currentColor" />
            </button>
          </div>
        ))}

        {/* hover popup (like Acrobat's) */}
        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-50 max-w-xs whitespace-pre-wrap rounded border border-yellow-700/40 bg-yellow-50 p-2 text-xs text-neutral-900 shadow-xl"
            style={{ left: `${Math.min(hover.x, 0.6) * 100}%`, top: `${(hover.y + 0.015) * 100}%` }}
          >
            <div className="mb-1 font-semibold">USUARIO</div>
            {hovered.text}
            {hovered.replies.map((r) => (
              <div key={r.id} className="mt-1 border-t border-yellow-700/20 pt-1">
                {r.text}
              </div>
            ))}
          </div>
        )}

        {/* region comment drawing */}
        {tool === 'region' && (
          <div className="absolute inset-0 z-40 cursor-crosshair" onPointerDown={onRegionDown}>
            {drag && (
              <div
                className="absolute border-2 border-yellow-500 bg-yellow-300/20"
                style={{
                  left: `${drag.x * 100}%`,
                  top: `${drag.y * 100}%`,
                  width: `${drag.w * 100}%`,
                  height: `${drag.h * 100}%`,
                }}
              />
            )}
          </div>
        )}

        {/* edit tool: drag on any empty area (under the detected blocks) to draw a box over undetected lettering */}
        {tool === 'edit' && (
          <div className="absolute inset-0 z-[35] cursor-crosshair" onPointerDown={onBoxDown}>
            {drag && (
              <div
                className="absolute border-2 border-dashed border-blue-500 bg-blue-500/15"
                style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%`, width: `${drag.w * 100}%`, height: `${drag.h * 100}%` }}
              />
            )}
          </div>
        )}

        {/* manual box drawing */}
        {tool === 'box' && (
          <div className="absolute inset-0 z-40 cursor-crosshair" onPointerDown={onBoxDown}>
            {drag && (
              <div
                className="absolute border-2 border-dashed border-blue-500 bg-blue-500/15"
                style={{ left: `${drag.x * 100}%`, top: `${drag.y * 100}%`, width: `${drag.w * 100}%`, height: `${drag.h * 100}%` }}
              />
            )}
          </div>
        )}

        {/* rebuilt backgrounds under removed lettering */}
        {edits.map(
          (e) =>
            e.cover && (
              <img
                key={`c-${e.id}`}
                src={e.cover.img}
                alt=""
                draggable={false}
                className="pointer-events-none absolute z-[29]"
                style={{
                  left: `${e.cover.rect.x * 100}%`,
                  top: `${e.cover.rect.y * 100}%`,
                  width: `${e.cover.rect.w * 100}%`,
                  height: `${e.cover.rect.h * 100}%`,
                }}
              />
            ),
        )}

        {/* text edits */}
        {edits.map((e) => (
          <EditBox key={e.id} edit={e} scale={scale} pageW={dims.w} pageH={dims.h} raised={tool === 'box' || tool === 'edit'} />
        ))}

        {/* detected blocks (edit tool) */}
        {tool === 'edit' &&
          visibleBlocks.map((b) => (
            <button
              key={b.id}
              onClick={() => createEdit(b)}
              title={b.text}
              className="absolute z-40 border border-dashed border-blue-500 bg-blue-500/10 hover:bg-blue-500/25"
              style={{
                left: `${b.rect.x * 100}%`,
                top: `${b.rect.y * 100}%`,
                width: `${b.rect.w * 100}%`,
                height: `${b.rect.h * 100}%`,
              }}
            />
          ))}
      </div>
    </div>
  )
}
