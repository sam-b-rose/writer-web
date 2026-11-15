import { EditorState, StateEffect, StateField, type Transaction } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { AI, REFERENCE, type AuthorRange } from '../store'

const mark = StateEffect.define<[from: number, to: number, author: string | null]>()
const decorations = new Map<string, Decoration>()

let pasteAuthor: string | null = null

function decorationFor(author: string) {
  let decoration = decorations.get(author)
  if (!decoration) {
    const kind = author === AI ? 'ai' : author === REFERENCE ? 'reference' : 'other'
    decoration = Decoration.mark({ class: `cm-author cm-author-${kind}`, attributes: { title: author.slice(1) } })
    decorations.set(author, decoration)
  }
  return decoration
}

function subtract(ranges: AuthorRange[], from: number, to: number): AuthorRange[] {
  return ranges.flatMap(([a, b, author]): AuthorRange[] => {
    if (to <= a || from >= b) return [[a, b, author]]
    return ([[a, from, author], [to, b, author]] as AuthorRange[]).filter(([x, y]) => y > x)
  })
}

function apply(ranges: AuthorRange[], tr: Transaction): AuthorRange[] {
  let next = ranges
  if (tr.docChanged) {
    next = next
      .map(([a, b, author]): AuthorRange => [tr.changes.mapPos(a, 1), tr.changes.mapPos(b, -1), author])
      .filter(([a, b]) => b > a)
    tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
      if (to > from) next = subtract(next, from, to)
    })
  }
  for (const effect of tr.effects) {
    if (!effect.is(mark)) continue
    const [from, to, author] = effect.value
    next = subtract(next, from, to)
    if (author) next = [...next, [from, to, author]]
  }
  return next === ranges ? ranges : [...next].sort((x, y) => x[0] - y[0])
}

export const authorRanges = StateField.define<AuthorRange[]>({
  create: () => [],
  update: apply,
  provide: (field) =>
    EditorView.decorations.from(field, (ranges) =>
      Decoration.set(ranges.map(([from, to, author]) => decorationFor(author).range(from, to))),
    ),
})

function pasteEffects(tr: Transaction) {
  if (!pasteAuthor || !tr.isUserEvent('input.paste')) return null
  const effects: StateEffect<[number, number, string | null]>[] = []
  tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
    if (to > from) effects.push(mark.of([from, to, pasteAuthor]))
  })
  return { effects }
}

export const authorship = [
  authorRanges,
  EditorState.transactionExtender.of(pasteEffects),
  EditorView.domEventHandlers({
    keydown(event) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code === 'KeyV') pasteAuthor = AI
    },
    keyup(event) {
      if (event.code === 'KeyV') pasteAuthor = null
    },
  }),
]

export async function pasteClipboardAs(view: EditorView, author: string) {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (!text) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    effects: mark.of([from, from + text.length, author]),
    userEvent: 'input.paste',
    scrollIntoView: true,
  })
  view.focus()
}

export function markSelection(view: EditorView, author: string | null) {
  const { from, to } = view.state.selection.main
  if (from === to) return false
  view.dispatch({ effects: mark.of([from, to, author]) })
  view.focus()
  return true
}
