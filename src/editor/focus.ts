import { RangeSetBuilder, type Text } from '@codemirror/state'
import type { FocusScope } from '../store'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

const dim = Decoration.mark({ class: 'cm-dim' })
const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })

function paragraphAt(doc: Text, pos: number) {
  let first = doc.lineAt(pos)
  let last = first
  if (!first.text.trim()) return { from: first.from, to: first.to }
  while (first.number > 1) {
    const prev = doc.line(first.number - 1)
    if (!prev.text.trim()) break
    first = prev
  }
  while (last.number < doc.lines) {
    const next = doc.line(last.number + 1)
    if (!next.text.trim()) break
    last = next
  }
  return { from: first.from, to: last.to }
}

function sentenceAt(doc: Text, pos: number) {
  const paragraph = paragraphAt(doc, pos)
  const text = doc.sliceString(paragraph.from, paragraph.to)
  const offset = pos - paragraph.from
  let match = { from: paragraph.from, to: paragraph.to }
  for (const { index, segment } of sentences.segment(text)) {
    const end = index + segment.length
    match = { from: paragraph.from + index, to: paragraph.from + index + segment.trimEnd().length }
    if (offset < end) break
  }
  return match
}

function build(view: EditorView, scope: FocusScope): DecorationSet {
  const { doc, selection } = view.state
  const head = selection.main.head
  const focus = scope === 'sentence' ? sentenceAt(doc, head) : paragraphAt(doc, head)
  const builder = new RangeSetBuilder<Decoration>()
  if (focus.from > 0) builder.add(0, focus.from, dim)
  if (focus.to < doc.length) builder.add(focus.to, doc.length, dim)
  return builder.finish()
}

export function focusMode(scope: FocusScope) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view, scope)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.decorations = build(update.view, scope)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function scrollDuration(distance: number) {
  return reducedMotion.matches ? 0 : Math.min(Math.max(120 * Math.sqrt(distance / 30), 120), 300)
}

function easeOut(t: number) {
  return 1 - (1 - t) ** 3
}

const centerCaret = ViewPlugin.fromClass(
  class {
    frame = 0
    resize = new ResizeObserver(() => this.center())
    pointerSelected = false

    constructor(readonly view: EditorView) {
      this.center(view.contentDOM.getBoundingClientRect().top)
      this.resize.observe(view.scrollDOM)
      window.addEventListener('pointerup', this.release)
    }

    update(update: ViewUpdate) {
      const pointer = update.transactions.some((tr) => tr.isUserEvent('select.pointer'))
      if (pointer && update.selectionSet) this.pointerSelected = true
      else if (update.docChanged || update.selectionSet) this.center()
    }

    release = () => {
      if (this.pointerSelected) this.center()
      this.pointerSelected = false
    }

    destroy() {
      cancelAnimationFrame(this.frame)
      this.resize.disconnect()
      window.removeEventListener('pointerup', this.release)
    }

    center(contentTopBefore?: number) {
      this.view.requestMeasure({
        read: (view) => {
          const caret = view.coordsAtPos(view.state.selection.main.head)
          if (!caret) return null
          const scroller = view.scrollDOM
          const box = scroller.getBoundingClientRect()
          const shift = contentTopBefore === undefined ? 0 : view.contentDOM.getBoundingClientRect().top - contentTopBefore
          const limit = scroller.scrollHeight - scroller.clientHeight
          const target = scroller.scrollTop + (caret.top + caret.bottom) / 2 - (box.top + box.height / 2)
          return { shift, target: Math.min(Math.max(target, 0), limit) }
        },
        write: (measured, view) => {
          if (!measured) return
          view.scrollDOM.scrollTop += measured.shift
          this.animate(measured.target)
        },
      })
    }

    animate(target: number) {
      cancelAnimationFrame(this.frame)
      const scroller = this.view.scrollDOM
      const start = scroller.scrollTop
      const distance = target - start
      if (Math.abs(distance) < 0.5) return
      const duration = scrollDuration(Math.abs(distance))
      const began = performance.now()
      const step = (now: number) => {
        const progress = duration ? Math.min((now - began) / duration, 1) : 1
        scroller.scrollTop = start + distance * easeOut(progress)
        if (progress < 1) this.frame = requestAnimationFrame(step)
      }
      this.frame = requestAnimationFrame(step)
    }
  },
)

export const typewriter = [centerCaret, EditorView.editorAttributes.of({ class: 'cm-typewriter' })]
