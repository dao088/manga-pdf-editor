import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, Trash2, Undo2 } from 'lucide-react'
import { FONTS } from '../lib/style'
import { useStore, type Align, type TextEditT } from '../store'

const label = 'mb-1 block text-[11px] uppercase tracking-wide text-neutral-400'
const input = 'w-full rounded bg-neutral-900 px-2 py-1 text-sm outline-none ring-1 ring-neutral-600 focus:ring-blue-500'

export function FormatPanel() {
  const edit = useStore((s) => s.edits.find((e) => e.id === s.activeEditId))
  const updateEdit = useStore((s) => s.updateEdit)
  const deleteEdit = useStore((s) => s.deleteEdit)

  if (!edit) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Pick the <b>Edit text</b> tool and click a detected block to edit it. Font, size, colour and alignment are
        detected automatically and can be changed here.
      </div>
    )
  }
  const set = (patch: Partial<TextEditT>) => updateEdit(edit.id, patch)
  const aligns: [Align, typeof AlignLeft][] = [
    ['left', AlignLeft],
    ['center', AlignCenter],
    ['right', AlignRight],
    ['justify', AlignJustify],
  ]
  const toggle = (on: boolean) => (on ? 'bg-blue-600' : 'bg-neutral-700 hover:bg-neutral-600')

  return (
    <div className="thin-scroll h-full space-y-4 overflow-y-auto p-4">
      <div className="text-sm font-semibold">Format</div>

      <div>
        <label className={label}>Font</label>
        <select className={input} value={edit.font} onChange={(e) => set({ font: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Size (pt)</label>
          <input
            type="number"
            step={0.5}
            min={4}
            className={input}
            value={edit.size}
            onChange={(e) => set({ size: Number(e.target.value) || edit.size })}
          />
        </div>
        <div>
          <label className={label}>Line height</label>
          <input
            type="number"
            step={0.05}
            min={0.8}
            max={2.5}
            className={input}
            value={edit.lineHeight}
            onChange={(e) => set({ lineHeight: Number(e.target.value) || edit.lineHeight })}
          />
        </div>
        <div>
          <label className={label}>Text colour</label>
          <input type="color" className="h-8 w-full cursor-pointer rounded bg-transparent" value={edit.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <div>
          <label className={label}>Cover colour</label>
          <input type="color" className="h-8 w-full cursor-pointer rounded bg-transparent" value={edit.bg} onChange={(e) => set({ bg: e.target.value })} />
        </div>
      </div>

      <div className="flex gap-1">
        <button onClick={() => set({ bold: !edit.bold })} className={`rounded p-2 ${toggle(edit.bold)}`} title="Bold">
          <Bold size={15} />
        </button>
        <button onClick={() => set({ italic: !edit.italic })} className={`rounded p-2 ${toggle(edit.italic)}`} title="Italic">
          <Italic size={15} />
        </button>
        <span className="mx-1 w-px bg-neutral-700" />
        {aligns.map(([a, Icon]) => (
          <button key={a} onClick={() => set({ align: a })} className={`rounded p-2 ${toggle(edit.align === a)}`} title={a}>
            <Icon size={15} />
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={edit.autoFit} onChange={(e) => set({ autoFit: e.target.checked })} />
        Shrink text to fit the box
      </label>

      <div>
        <label className={label}>Original text</label>
        <div className="rounded bg-neutral-900 p-2 text-xs text-neutral-400">{edit.original}</div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => set({ text: edit.original })} className="flex items-center gap-1 rounded bg-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-600">
          <Undo2 size={13} /> Reset text
        </button>
        <button onClick={() => deleteEdit(edit.id)} className="flex items-center gap-1 rounded bg-red-900/60 px-3 py-1.5 text-xs hover:bg-red-800">
          <Trash2 size={13} /> Remove edit
        </button>
      </div>
    </div>
  )
}
