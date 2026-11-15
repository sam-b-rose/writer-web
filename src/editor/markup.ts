import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const markupStyle = HighlightStyle.define([
  { tag: [t.processingInstruction, t.url, t.contentSeparator, t.labelName, t.escape], class: 'cm-markup' },
  { tag: t.heading, class: 'cm-strong' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strike' },
  { tag: t.monospace, class: 'cm-code' },
  { tag: t.link, class: 'cm-link' },
])

const headingLines = new Map<number, Decoration>()

function headingLine(hashes: number) {
  let deco = headingLines.get(hashes)
  if (!deco) {
    deco = Decoration.line({ class: 'cm-heading', attributes: { style: `--hang: ${hashes + 1}ch` } })
    headingLines.set(hashes, deco)
  }
  return deco
}

function buildHeadings(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const match = /^(#{1,6})(?:\s|$)/.exec(line.text)
      if (match) builder.add(line.from, line.from, headingLine(match[1].length))
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const hangingHeadings = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildHeadings(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = buildHeadings(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

export const markup = [syntaxHighlighting(markupStyle), hangingHeadings]
