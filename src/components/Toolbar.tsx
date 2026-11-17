import { useRef, useState } from 'react'
import { BoxSelect, SquarePen, Download, FolderOpen, MousePointer2, Minus, Plus, ScanText, Type } from 'lucide-react'
import { exportPdf } from '../lib/export'
import { useStore, type Tool } from '../store'

const tools: { id: Tool; label: string; Icon: typeof Type }[] = [
  { id: 'select', label: 'Select / comment', Icon: MousePointer2 },
  { id: 'region', label: 'Region comment', Icon: BoxSelect },
  { id: 'edit', label: 'Edit text', Icon: Type },
  { id: 'box', label: 'Draw box', Icon: SquarePen },
]

export function Toolbar() {
  const s = useStore()
  const input = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState(false)

  const open = async (f: File) => s.openFile(f.name, new Uint8Array(await f.arrayBuffer()))

  const doExport = async () => {
    if (!s.bytes || !s.fileName) return
    setExporting(true)
    try {
      const out = await exportPdf(s.bytes, s.edits, s.comments)
      const url = URL.createObjectURL(new Blob([out.slice().buffer as ArrayBuffer], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = s.fileName.replace(/\.pdf$/i, '') + '_translated.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const btn = 'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm'
  return (
    <div className="flex items-center gap-3 border-b border-neutral-700 bg-neutral-900 px-3 py-2">
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => e.target.files?.[0] && open(e.target.files[0])}
      />
      <button className={`${btn} bg-neutral-700 hover:bg-neutral-600`} onClick={() => input.current?.click()}>
        <FolderOpen size={16} /> Open
      </button>

      <div className="mx-1 h-6 w-px bg-neutral-700" />

      {tools.map(({ id, label, Icon }) => (
        <button
          key={id}
          title={id === 'box' ? 'Drag a box over ANY lettering (even if it was not detected) and type the new text' : label}
          onClick={() => s.setTool(id)}
          className={`${btn} ${s.tool === id ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
        >
          <Icon size={16} /> {label}
        </button>
      ))}

      {s.tool === 'edit' && (
        <div className="ml-1 flex overflow-hidden rounded text-xs ring-1 ring-neutral-600">
          {(['line', 'group'] as const).map((g) => (
            <button
              key={g}
              onClick={() => s.setGranularity(g)}
              className={`px-2.5 py-1.5 ${s.granularity === g ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
              title={g === 'line' ? 'Edit one line at a time' : 'Edit the whole paragraph / bubble'}
            >
              {g === 'line' ? 'Inline' : 'Group'}
            </button>
          ))}
        </div>
      )}

      {s.tool === 'edit' && s.numPages > 0 && (
        <button
          className={`${btn} bg-amber-600 hover:bg-amber-500 disabled:opacity-60`}
          disabled={!!s.busy[s.page]}
          onClick={() => window.dispatchEvent(new CustomEvent('mpe:ocr', { detail: s.page }))}
          title="Finds lettering the PDF does not expose (big bold text). Takes a few seconds."
        >
          <ScanText size={16} /> {s.busy[s.page] ?? `Detect text (OCR) · p.${s.page}`}
        </button>
      )}

      <div className="flex-1" />

      {s.numPages > 0 && (
        <>
          <span className="text-sm text-neutral-400">
            <input
              value={s.page}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (n >= 1 && n <= s.numPages) {
                  s.setPage(n)
                  document.getElementById(`page-${n}`)?.scrollIntoView()
                }
              }}
              className="w-10 rounded bg-neutral-800 px-1 text-center"
            />{' '}
            / {s.numPages}
          </span>
          <button className={`${btn} bg-neutral-800 hover:bg-neutral-700`} onClick={() => s.setScale(s.scale - 0.1)}>
            <Minus size={14} />
          </button>
          <span className="w-12 text-center text-sm">{Math.round(s.scale * 100)}%</span>
          <button className={`${btn} bg-neutral-800 hover:bg-neutral-700`} onClick={() => s.setScale(s.scale + 0.1)}>
            <Plus size={14} />
          </button>
          <button
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50`}
            onClick={doExport}
            disabled={exporting}
          >
            <Download size={16} /> {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </>
      )}
    </div>
  )
}
