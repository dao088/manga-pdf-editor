import { create } from 'zustand'
import type { Rect } from './lib/geometry'

export type Tool = 'select' | 'region' | 'edit' | 'box'
export type Granularity = 'line' | 'group'
export type Align = 'left' | 'center' | 'right' | 'justify'

export type Reply = { id: string; text: string; createdAt: number }
export type CommentT = {
  id: string
  page: number
  rects: Rect[]
  quote: string
  text: string
  createdAt: number
  replies: Reply[]
  draft: boolean
}

export type TextEditT = {
  id: string
  page: number
  blockId: string
  rect: Rect
  original: string
  text: string
  font: string
  /** font size in PDF points */
  size: number
  color: string
  bg: string
  bold: boolean
  italic: boolean
  align: Align
  lineHeight: number
  autoFit: boolean
  /** rebuilt background under the removed lettering (fixed to the area it was made for) */
  cover?: { rect: Rect; img: string; ink: string }
  /** outline colour around the letters ('' = none) */
  outline?: string
  /** where the original (real PDF) text was: used at export to delete exactly that text */
  origRect?: Rect
  /** signature of the edit when it was created: an untouched edit is skipped at export */
  sig?: string
}

export type Block = {
  id: string
  page: number
  rect: Rect
  text: string
  /** font size in PDF points */
  fontSize: number
  fontName?: string
  align: Align
  lineHeight: number
  source: 'pdf' | 'ocr'
}
export type BlockSet = { line: Block[]; group: Block[]; source: 'pdf' | 'ocr' | 'mixed' }

type PageSize = { w: number; h: number }

interface State {
  fileName: string | null
  fileKey: string | null
  bytes: Uint8Array | null
  numPages: number
  scale: number
  page: number
  tool: Tool
  granularity: Granularity
  panel: 'comments' | 'format'
  comments: CommentT[]
  edits: TextEditT[]
  activeCommentId: string | null
  activeEditId: string | null
  pageSizes: Record<number, PageSize>
  blocks: Record<number, BlockSet>
  busy: Record<number, string | undefined>

  openFile: (name: string, bytes: Uint8Array) => void
  setNumPages: (n: number) => void
  setScale: (s: number) => void
  setPage: (p: number) => void
  setTool: (t: Tool) => void
  setGranularity: (g: Granularity) => void
  setPanel: (p: 'comments' | 'format') => void
  setPageSize: (page: number, s: PageSize) => void
  setBlocks: (page: number, b: BlockSet) => void
  setBusy: (page: number, msg?: string) => void

  addComment: (c: CommentT) => void
  updateComment: (id: string, patch: Partial<CommentT>) => void
  deleteComment: (id: string) => void
  addReply: (id: string, text: string) => void
  setActiveComment: (id: string | null) => void

  addEdit: (e: TextEditT) => void
  updateEdit: (id: string, patch: Partial<TextEditT>) => void
  deleteEdit: (id: string) => void
  setActiveEdit: (id: string | null) => void
}

const storageKey = (k: string) => `mpe:${k}`

export const useStore = create<State>((set) => ({
  fileName: null,
  fileKey: null,
  bytes: null,
  numPages: 0,
  scale: 1,
  page: 1,
  tool: 'select',
  granularity: 'group',
  panel: 'comments',
  comments: [],
  edits: [],
  activeCommentId: null,
  activeEditId: null,
  pageSizes: {},
  blocks: {},
  busy: {},

  openFile: (name, bytes) => {
    const key = `${name}:${bytes.length}`
    let saved: { comments?: CommentT[]; edits?: TextEditT[] } = {}
    try {
      saved = JSON.parse(localStorage.getItem(storageKey(key)) ?? '{}')
    } catch {
      /* ignore corrupted storage */
    }
    set({
      fileName: name,
      fileKey: key,
      bytes,
      numPages: 0,
      page: 1,
      comments: saved.comments ?? [],
      edits: saved.edits ?? [],
      activeCommentId: null,
      activeEditId: null,
      pageSizes: {},
      blocks: {},
      busy: {},
    })
  },
  setNumPages: (numPages) => set({ numPages }),
  setScale: (scale) => set({ scale: Math.min(4, Math.max(0.25, scale)) }),
  setPage: (page) => set({ page }),
  setTool: (tool) => set({ tool }),
  setGranularity: (granularity) => set({ granularity }),
  setPanel: (panel) => set({ panel }),
  setPageSize: (page, s) =>
    set((st) => {
      const cur = st.pageSizes[page]
      if (cur && cur.w === s.w && cur.h === s.h) return st
      return { pageSizes: { ...st.pageSizes, [page]: s } }
    }),
  setBlocks: (page, b) => set((st) => ({ blocks: { ...st.blocks, [page]: b } })),
  setBusy: (page, msg) => set((st) => ({ busy: { ...st.busy, [page]: msg } })),

  addComment: (c) => set((st) => ({ comments: [...st.comments, c], activeCommentId: c.id, panel: 'comments' })),
  updateComment: (id, patch) =>
    set((st) => ({ comments: st.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
  deleteComment: (id) =>
    set((st) => ({
      comments: st.comments.filter((c) => c.id !== id),
      activeCommentId: st.activeCommentId === id ? null : st.activeCommentId,
    })),
  addReply: (id, text) =>
    set((st) => ({
      comments: st.comments.map((c) =>
        c.id === id ? { ...c, replies: [...c.replies, { id: crypto.randomUUID(), text, createdAt: Date.now() }] } : c,
      ),
    })),
  setActiveComment: (activeCommentId) => set({ activeCommentId }),

  addEdit: (e) => set((st) => ({ edits: [...st.edits, e], activeEditId: e.id, panel: 'format' })),
  updateEdit: (id, patch) => set((st) => ({ edits: st.edits.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
  deleteEdit: (id) =>
    set((st) => ({
      edits: st.edits.filter((e) => e.id !== id),
      activeEditId: st.activeEditId === id ? null : st.activeEditId,
    })),
  setActiveEdit: (activeEditId) => set({ activeEditId }),
}))

// Persist comments + edits per file (name + size) so a refresh does not lose work.
useStore.subscribe((st, prev) => {
  if (!st.fileKey) return
  if (st.comments === prev.comments && st.edits === prev.edits && st.fileKey === prev.fileKey) return
  try {
    localStorage.setItem(
      storageKey(st.fileKey),
      JSON.stringify({ comments: st.comments.filter((c) => !c.draft), edits: st.edits }),
    )
  } catch {
    /* storage full: ignore */
  }
})
