import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { pdfjs, type PDFDocumentProxy } from './lib/pdf'
import { uid, type Rect } from './lib/geometry'
import { useStore } from './store'
import { Toolbar } from './components/Toolbar'
import { PageView } from './components/PageView'
import { CommentsPanel } from './components/CommentsPanel'
import { FormatPanel } from './components/FormatPanel'

type Pending = { page: number; rects: Rect[]; quote: string; x: number; y: number }

export default function App() {
  const bytes = useStore((s) => s.bytes)
  const numPages = useStore((s) => s.numPages)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const tool = useStore((s) => s.tool)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const viewer = useRef<HTMLDivElement>(null)

  // load document
  useEffect(() => {
    if (!bytes) return
    let cancelled = false
    const task = pdfjs.getDocument({ data: bytes.slice() })
    task.promise.then((d) => {
      if (cancelled) return
      setDoc(d)
      useStore.getState().setNumPages(d.numPages)
    })
    return () => {
      cancelled = true
      task.destroy()
    }
  }, [bytes])

  // text selection -> floating "comment" button
  useEffect(() => {
    const onUp = () => {
      if (useStore.getState().tool !== 'select') return setPending(null)
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPending(null)
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const pageEl = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-page]')
      if (!pageEl) return setPending(null)
      const box = pageEl.getBoundingClientRect()
      const client = [...range.getClientRects()].filter((r) => r.width > 2 && r.height > 2)
      if (!client.length) return setPending(null)
      const rects: Rect[] = client.map((r) => ({
        x: (r.left - box.left) / box.width,
        y: (r.top - box.top) / box.height,
        w: r.width / box.width,
        h: r.height / box.height,
      }))
      const last = client[client.length - 1]
      setPending({
        page: Number(pageEl.dataset.page),
        rects,
        quote: sel.toString().replace(/\s+/g, ' ').trim(),
        x: last.right,
        y: last.bottom,
      })
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [])

  // current page from scroll position
  const onScroll = () => {
    const el = viewer.current
    if (!el) return
    const mid = el.getBoundingClientRect().top + el.clientHeight / 3
    let best = 1
    let bestD = Infinity
    el.querySelectorAll<HTMLElement>('[data-page]').forEach((p) => {
      const d = Math.abs(p.getBoundingClientRect().top - mid)
      if (d < bestD) {
        bestD = d
        best = Number(p.dataset.page)
      }
    })
    useStore.getState().setPage(best)
  }

  const startComment = () => {
    if (!pending) return
    useStore.getState().addComment({
      id: uid(),
      page: pending.page,
      rects: pending.rects,
      quote: pending.quote,
      text: '',
      createdAt: Date.now(),
      replies: [],
      draft: true,
    })
    window.getSelection()?.removeAllRanges()
    setPending(null)
  }

  const tab = (id: 'comments' | 'format', label: string) => (
    <button
      onClick={() => setPanel(id)}
      className={`flex-1 py-2 text-sm ${panel === id ? 'border-b-2 border-blue-500 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div ref={viewer} onScroll={onScroll} className="thin-scroll relative flex-1 overflow-auto bg-neutral-800 p-6">
          {!doc && (
            <div className="mt-32 text-center text-neutral-400">
              <p className="text-lg">Open a PDF to start</p>
              <p className="mt-1 text-sm">Comments, highlights and text edits are saved in this browser per file.</p>
            </div>
          )}
          {doc &&
            Array.from({ length: numPages }, (_, i) => (
              <PageView key={`${bytes?.length}-${i}`} doc={doc} pageNumber={i + 1} />
            ))}
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-700 bg-neutral-900">
          <div className="flex border-b border-neutral-700">
            {tab('comments', 'Comments')}
            {tab('format', 'Format')}
          </div>
          <div className="min-h-0 flex-1">{panel === 'comments' ? <CommentsPanel /> : <FormatPanel />}</div>
        </aside>
      </div>

      {pending && tool === 'select' && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={startComment}
          className="fixed z-[100] flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium shadow-lg hover:bg-blue-500"
          style={{ left: pending.x + 6, top: pending.y + 6 }}
        >
          <MessageSquarePlus size={14} /> Comment
        </button>
      )}
    </div>
  )
}
