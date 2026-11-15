import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

export type Mark = [from: number, to: number, className: string, title?: string]

const markCache = new Map<string, Decoration>()

function markFor(className: string, title?: string) {
  const key = `${className}|${title ?? ''}`
  let mark = markCache.get(key)
  if (!mark) {
    mark = Decoration.mark({ class: className, attributes: title ? { title } : undefined })
    markCache.set(key, mark)
  }
  return mark
}

export function lineDecorator(scan: (text: string) => Mark[]) {
  const cache = new Map<string, Mark[]>()

  const marksFor = (text: string) => {
    let marks = cache.get(text)
    if (!marks) {
      if (cache.size > 4000) cache.clear()
      marks = scan(text).sort((a, b) => a[0] - b[0])
      cache.set(text, marks)
    }
    return marks
  }

  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    for (const { from, to } of view.visibleRanges) {
      let pos = from
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos)
        let last = line.from
        for (const [a, b, className, title] of marksFor(line.text)) {
          const start = line.from + a
          if (start < last) continue
          builder.add(start, line.from + b, markFor(className, title))
          last = line.from + b
        }
        pos = line.to + 1
      }
    }
    return builder.finish()
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

export function maskMarkdown(text: string) {
  const blank = (m: string) => ' '.repeat(m.length)
  return text
    .replace(/\]\([^)]*\)/g, blank)
    .replace(/`[^`]*`/g, blank)
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/[*_#>`[\]~|]/g, ' ')
}
