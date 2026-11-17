import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore, type CommentT } from '../store'

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Card({ c }: { c: CommentT }) {
  const active = useStore((s) => s.activeCommentId === c.id)
  const { updateComment, deleteComment, addReply, setActiveComment } = useStore.getState()
  const [text, setText] = useState(c.text)
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState(c.draft)
  const area = useRef<HTMLTextAreaElement>(null)
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) area.current?.focus()
  }, [editing])
  useEffect(() => {
    if (active) el.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const post = () => {
    if (!text.trim()) return
    updateComment(c.id, { text: text.trim(), draft: false })
    setEditing(false)
  }

  return (
    <div
      ref={el}
      onClick={() => {
        setActiveComment(c.id)
        document.getElementById(`page-${c.page}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }}
      className={`rounded-md border p-3 text-sm ${active ? 'border-blue-500 bg-neutral-700' : 'border-neutral-700 bg-neutral-800'}`}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
        <span className="font-semibold text-neutral-200">USUARIO · p.{c.page}</span>
        <span className="flex items-center gap-2">
          {time(c.createdAt)}
          <button
            onClick={(e) => {
              e.stopPropagation()
              deleteComment(c.id)
            }}
            className="text-neutral-500 hover:text-red-400"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      {c.quote && <div className="mb-1 line-clamp-2 border-l-2 border-yellow-400 pl-2 text-xs italic text-neutral-400">{c.quote}</div>}

      {editing ? (
        <>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post()
            }}
            rows={5}
            placeholder="Write your note… (Ctrl+Enter to post)"
            className="w-full resize-y rounded bg-neutral-900 p-2 text-sm outline-none ring-1 ring-neutral-600 focus:ring-blue-500"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => (c.draft ? deleteComment(c.id) : (setText(c.text), setEditing(false)))}
              className="rounded px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-600"
            >
              Cancel
            </button>
            <button onClick={post} className="rounded bg-blue-600 px-3 py-1 text-xs font-medium hover:bg-blue-500">
              Post
            </button>
          </div>
        </>
      ) : (
        <div className="whitespace-pre-wrap" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {c.text}
        </div>
      )}

      {!editing &&
        c.replies.map((r) => (
          <div key={r.id} className="mt-2 border-t border-neutral-600 pt-2 text-xs">
            <span className="text-neutral-400">{time(r.createdAt)}</span>
            <div className="whitespace-pre-wrap">{r.text}</div>
          </div>
        ))}

      {!editing && (
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && reply.trim()) {
              addReply(c.id, reply.trim())
              setReply('')
            }
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="Add a reply…"
          className="mt-2 w-full rounded bg-neutral-900 px-2 py-1 text-xs outline-none ring-1 ring-neutral-600 focus:ring-blue-500"
        />
      )}
    </div>
  )
}

export function CommentsPanel() {
  const comments = useStore((s) => s.comments)
  const sorted = useMemo(
    () => [...comments].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y || a.rects[0].x - b.rects[0].x),
    [comments],
  )
  const count = comments.filter((c) => !c.draft).length
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-700 px-4 py-3 text-sm font-semibold">
        {count} comment{count === 1 ? '' : 's'}
      </div>
      <div className="thin-scroll flex-1 space-y-2 overflow-y-auto p-3">
        {sorted.length === 0 && (
          <p className="text-sm text-neutral-500">Select text on the page (or use the region tool) to add a comment.</p>
        )}
        {sorted.map((c) => (
          <Card key={c.id} c={c} />
        ))}
      </div>
    </div>
  )
}
