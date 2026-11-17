import { useRef } from 'react'
import { clamp } from '../lib/geometry'
import { fitSize } from '../lib/style'
import { useStore, type TextEditT } from '../store'

type Props = { edit: TextEditT; scale: number; pageW: number; pageH: number }

/** Inline editable text that covers the original lettering. Drag the top bar to move, corner to resize. */
export function EditBox({ edit, scale, pageW, pageH }: Props) {
  const active = useStore((s) => s.activeEditId === edit.id)
  const setActiveEdit = useStore((s) => s.setActiveEdit)
  const setPanel = useStore((s) => s.setPanel)
  const updateEdit = useStore((s) => s.updateEdit)
  const ref = useRef<HTMLDivElement>(null)

  const size = fitSize(edit, pageW, pageH)

  const drag = (mode: 'move' | 'resize') => (ev: React.PointerEvent) => {
    ev.preventDefault()
    ev.stopPropagation()
    const startX = ev.clientX
    const startY = ev.clientY
    const r0 = { ...edit.rect }
    const pxW = pageW * scale
    const pxH = pageH * scale
    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - startX) / pxW
      const dy = (m.clientY - startY) / pxH
      if (mode === 'move') {
        updateEdit(edit.id, { rect: { ...r0, x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h) } })
      } else {
        updateEdit(edit.id, {
          rect: { ...r0, w: clamp(r0.w + dx, 0.03, 1 - r0.x), h: clamp(r0.h + dy, 0.02, 1 - r0.y) },
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      className="absolute z-30 flex items-center justify-center"
      style={{
        left: `${edit.rect.x * 100}%`,
        top: `${edit.rect.y * 100}%`,
        width: `${edit.rect.w * 100}%`,
        height: `${edit.rect.h * 100}%`,
        background: edit.bg,
        outline: active ? '2px solid #3b82f6' : '1px solid transparent',
      }}
      onMouseDown={() => {
        setActiveEdit(edit.id)
        setPanel('format')
      }}
    >
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        className="w-full outline-none"
        style={{
          fontFamily: `"${edit.font}", sans-serif`,
          fontSize: size * scale,
          fontWeight: edit.bold ? 700 : 400,
          fontStyle: edit.italic ? 'italic' : 'normal',
          color: edit.color,
          textAlign: edit.align,
          lineHeight: edit.lineHeight,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        onBlur={(e) => {
          const text = e.currentTarget.innerText.replace(/\n$/, '')
          if (text !== edit.text) updateEdit(edit.id, { text })
        }}
      >
        {edit.text}
      </div>
      {active && (
        <>
          <div
            onPointerDown={drag('move')}
            className="absolute -top-4 left-0 right-0 h-4 cursor-move rounded-t bg-blue-500/90"
            title="Drag to move"
          />
          <div
            onPointerDown={drag('resize')}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
          />
        </>
      )}
    </div>
  )
}
