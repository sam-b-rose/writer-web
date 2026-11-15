import { EditorSelection } from '@codemirror/state'
import type { Command, EditorView, KeyBinding } from '@codemirror/view'
import { locateTable, MarkdownTable, type TableLocation } from './table'

export interface FormatCommand {
  title: string
  run: Command
  key?: string
}

export interface FormatSection {
  title: string
  items: FormatCommand[]
}

const blockPrefix = /^[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|(?:>[ \t]?)+)/
const taskBox = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])\]/

function replace(view: EditorView, from: number, to: number, insert: string, anchor: number) {
  view.dispatch({ changes: { from, to, insert }, selection: { anchor }, userEvent: 'input', scrollIntoView: true })
  view.focus()
  return true
}

function wrap(open: string, close = open): Command {
  return (view) => {
    const { state } = view
    view.dispatch(
      state.update(
        state.changeByRange((range) => {
          const before = state.sliceDoc(range.from - open.length, range.from)
          const after = state.sliceDoc(range.to, range.to + close.length)
          if (before === open && after === close) {
            return {
              changes: [
                { from: range.from - open.length, to: range.from },
                { from: range.to, to: range.to + close.length },
              ],
              range: EditorSelection.range(range.from - open.length, range.to - open.length),
            }
          }
          return {
            changes: [
              { from: range.from, insert: open },
              { from: range.to, insert: close },
            ],
            range: EditorSelection.range(range.from + open.length, range.to + open.length),
          }
        }),
        { userEvent: 'input' },
      ),
    )
    view.focus()
    return true
  }
}

function setPrefix(make: (index: number) => string): Command {
  return (view) => {
    const { doc, selection } = view.state
    const first = doc.lineAt(selection.main.from)
    const last = doc.lineAt(selection.main.to)
    const lines: string[] = []
    for (let number = first.number; number <= last.number; number++) {
      const text = doc.line(number).text
      const existing = blockPrefix.exec(text)?.[0] ?? ''
      const prefix = make(number - first.number)
      lines.push(existing === prefix ? text.slice(existing.length) : prefix + text.slice(existing.length))
    }
    const joined = lines.join('\n')
    return replace(view, first.from, last.to, joined, first.from + joined.length)
  }
}

function insertBlock(block: string | (() => string), cursorOffset?: number): Command {
  return (view) => {
    const { doc, selection } = view.state
    const { from, to } = selection.main
    const text = typeof block === 'string' ? block : block()
    const before = doc.sliceString(Math.max(0, from - 2), from)
    const after = doc.sliceString(to, to + 2)
    const prefix = from === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const suffix = to === doc.length ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    return replace(view, from, to, prefix + text + suffix, from + prefix.length + (cursorOffset ?? text.length))
  }
}

const insertLink: Command = (view) => {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  return /^https?:\/\//.test(text)
    ? replace(view, from, to, `[](${text})`, from + 1)
    : replace(view, from, to, `[${text}]()`, from + text.length + 3)
}

const insertImage: Command = (view) => {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  return replace(view, from, to, `![${text}]()`, from + text.length + 4)
}

const codeBlock: Command = (view) => {
  const { from, to } = view.state.selection.main
  return from === to
    ? insertBlock('```\n\n```', 4)(view)
    : insertBlock('```\n' + view.state.sliceDoc(from, to) + '\n```')(view)
}

const addFootnote: Command = (view) => {
  const { doc, selection } = view.state
  const text = doc.toString()
  const highest = Math.max(0, ...[...text.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1])))
  const marker = `[^${highest + 1}]`
  const definition = `${text.endsWith('\n') ? '\n' : '\n\n'}${marker}: `
  const { from, to } = selection.main
  view.dispatch({
    changes: [
      { from, to, insert: marker },
      { from: doc.length, insert: definition },
    ],
    selection: { anchor: doc.length - (to - from) + marker.length + definition.length },
    userEvent: 'input',
    scrollIntoView: true,
  })
  view.focus()
  return true
}

const toggleTask: Command = (view) => {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const match = taskBox.exec(line.text)
  if (!match) return setPrefix(() => '- [ ] ')(view)
  const at = line.from + match[1].length
  view.dispatch({ changes: { from: at, to: at + 1, insert: match[2] === ' ' ? 'x' : ' ' }, userEvent: 'input' })
  return true
}

function replaceTable(view: EditorView, location: TableLocation, table: MarkdownTable, row: number, column: number) {
  const rendered = table.render()
  const anchor = location.from + table.offset(row, column)
  if (rendered === view.state.sliceDoc(location.from, location.to)) {
    view.dispatch({ selection: { anchor }, scrollIntoView: true })
    return true
  }
  return replace(view, location.from, location.to, rendered, anchor)
}

function moveCell(delta: number): Command {
  return (view) => {
    const { main } = view.state.selection
    const location = main.empty ? locateTable(view.state.doc, main.head) : null
    if (!location) return false
    const { table } = location
    const index = location.row * table.columns + location.column + delta
    if (index < 0) return true
    if (index >= table.rows.length * table.columns) table.insertRow(table.rows.length)
    return replaceTable(view, location, table, Math.floor(index / table.columns), index % table.columns)
  }
}

type TableOperation = (table: MarkdownTable, row: number, column: number) => [row: number, column: number] | void

function tableCommand(operation: TableOperation): Command {
  return (view) => {
    const location = locateTable(view.state.doc, view.state.selection.main.head)
    if (!location) return false
    const { table } = location
    const [row, column] = operation(table, location.row, location.column) ?? [location.row, location.column]
    return replaceTable(view, location, table, Math.min(row, table.rows.length - 1), Math.min(column, table.columns - 1))
  }
}

const heading = (level: number) => setPrefix(() => (level ? '#'.repeat(level) + ' ' : ''))
const callout = (kind: string) => insertBlock(`> [!${kind}]\n> `)
const today = () => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date())

export const formatSections: FormatSection[] = [
  {
    title: 'Text',
    items: [
      { title: 'Bold', key: 'Mod-b', run: wrap('**') },
      { title: 'Italic', key: 'Mod-i', run: wrap('*') },
      { title: 'Strikethrough', key: 'Mod-Shift-u', run: wrap('~~') },
      { title: 'Highlight', key: 'Mod-Shift-e', run: wrap('==') },
      { title: 'Code', key: 'Mod-j', run: wrap('`') },
      { title: 'Inline Math', run: wrap('$') },
    ],
  },
  {
    title: 'Paragraph',
    items: [
      { title: 'Body', key: 'Mod-Alt-0', run: heading(0) },
      ...[1, 2, 3, 4, 5, 6].map((level) => ({ title: `Heading ${level}`, key: `Mod-Alt-${level}`, run: heading(level) })),
      { title: 'List', key: 'Mod-Alt-l', run: setPrefix(() => '- ') },
      { title: 'Ordered List', key: 'Mod-Alt-o', run: setPrefix((i) => `${i + 1}. `) },
      { title: 'Task List', key: 'Mod-Alt-x', run: setPrefix(() => '- [ ] ') },
      { title: 'Mark Task as Completed', key: 'Mod-l', run: toggleTask },
      { title: 'Blockquote', key: "Mod-'", run: setPrefix(() => '> ') },
      { title: 'Code Block', key: 'Mod-Shift-j', run: codeBlock },
    ],
  },
  {
    title: 'Callout',
    items: ['Note', 'Tip', 'Important', 'Warning', 'Caution'].map((kind) => ({ title: kind, run: callout(kind.toUpperCase()) })),
  },
  {
    title: 'Insert',
    items: [
      { title: 'Link', key: 'Mod-k', run: insertLink },
      { title: 'Wikilink', key: 'Mod-Alt-k', run: wrap('[[', ']]') },
      { title: 'Image', run: insertImage },
      { title: 'Footnote', key: 'Mod-Alt-f', run: addFootnote },
      { title: 'Date', key: 'Mod-Shift-d', run: (view) => (view.dispatch(view.state.replaceSelection(today())), true) },
      { title: 'Table', run: insertBlock(() => MarkdownTable.empty(3, 3).render(), 2) },
      { title: 'Display Math', run: insertBlock('$$\n\n$$', 3) },
      { title: 'Table of Contents', run: insertBlock('{{TOC}}') },
      { title: 'Page Break', run: insertBlock('+++') },
      { title: 'Horizontal Rule', run: insertBlock('---') },
    ],
  },
  {
    title: 'Table',
    items: [
      { title: 'Add Row Above', run: tableCommand((t, r, c) => (t.insertRow(Math.max(r, 1)), [Math.max(r, 1), c])) },
      { title: 'Add Row Below', run: tableCommand((t, r, c) => (t.insertRow(r + 1), [r + 1, c])) },
      { title: 'Add Column Before', run: tableCommand((t, _r, c) => t.insertColumn(c)) },
      { title: 'Add Column After', run: tableCommand((t, r, c) => (t.insertColumn(c + 1), [r, c + 1])) },
      { title: 'Move Row Up', run: tableCommand((t, r, c) => [t.moveRow(r, -1), c]) },
      { title: 'Move Row Down', run: tableCommand((t, r, c) => [t.moveRow(r, 1), c]) },
      { title: 'Move Column Left', run: tableCommand((t, r, c) => [r, t.moveColumn(c, -1)]) },
      { title: 'Move Column Right', run: tableCommand((t, r, c) => [r, t.moveColumn(c, 1)]) },
      { title: 'Align Column Left', run: tableCommand((t, _r, c) => void (t.alignments[c] = 'left')) },
      { title: 'Align Column Center', run: tableCommand((t, _r, c) => void (t.alignments[c] = 'center')) },
      { title: 'Align Column Right', run: tableCommand((t, _r, c) => void (t.alignments[c] = 'right')) },
      { title: 'Sort Column Ascending', run: tableCommand((t, _r, c) => t.sort(c, true)) },
      { title: 'Sort Column Descending', run: tableCommand((t, _r, c) => t.sort(c, false)) },
      { title: 'Delete Row', run: tableCommand((t, r) => t.deleteRow(r)) },
      { title: 'Delete Column', run: tableCommand((t, _r, c) => t.deleteColumn(c)) },
      { title: 'Reformat Table', run: tableCommand(() => {}) },
    ],
  },
]

export const formatKeymap: KeyBinding[] = [
  ...formatSections.flatMap((section) => section.items).flatMap(({ key, run }) => (key ? [{ key, run }] : [])),
  { key: 'Tab', run: moveCell(1) },
  { key: 'Shift-Tab', run: moveCell(-1) },
]

export function displayKey(key: string) {
  const parts = key.split('-')
  const last = parts.pop()!
  const glyphs: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' }
  const order = ['Ctrl', 'Alt', 'Shift', 'Mod']
  return order.filter((name) => parts.includes(name)).map((name) => glyphs[name]).join('') + (last.length === 1 ? last.toUpperCase() : last)
}
