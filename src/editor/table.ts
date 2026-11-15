import type { Text } from '@codemirror/state'

export type Alignment = 'none' | 'left' | 'center' | 'right'

const delimiter = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

function pipeOffsets(line: string) {
  const offsets: number[] = []
  let escaped = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && !escaped) offsets.push(i)
    escaped = line[i] === '\\' && !escaped
  }
  return offsets
}

function cellsOf(line: string) {
  const cuts = pipeOffsets(line)
  const trimmed = line.trim()
  let start = 0
  let end = line.length
  if (trimmed.startsWith('|') && cuts.length) start = cuts.shift()! + 1
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|') && cuts.length && cuts[cuts.length - 1] >= start) end = cuts.pop()!
  const cells: string[] = []
  for (const cut of [...cuts, end]) {
    cells.push(line.slice(start, Math.max(cut, start)).trim())
    start = cut + 1
  }
  return cells
}

function columnIndex(line: string, offset: number) {
  const before = pipeOffsets(line).filter((at) => at < offset).length
  return Math.max(before - (line.trim().startsWith('|') ? 1 : 0), 0)
}

function pad(text: string, width: number, alignment: Alignment) {
  const space = Math.max(width - text.length, 0)
  if (alignment === 'right') return ' '.repeat(space) + text
  if (alignment === 'center') return ' '.repeat(Math.floor(space / 2)) + text + ' '.repeat(space - Math.floor(space / 2))
  return text + ' '.repeat(space)
}

export class MarkdownTable {
  constructor(
    public rows: string[][],
    public alignments: Alignment[],
  ) {}

  static empty(rows: number, columns: number) {
    return new MarkdownTable(
      Array.from({ length: rows }, () => Array<string>(columns).fill('')),
      Array<Alignment>(columns).fill('none'),
    )
  }

  static parse(lines: string[]) {
    if (lines.length < 2 || !lines[1].includes('-') || !delimiter.test(lines[1])) return null
    const alignments = cellsOf(lines[1]).map((cell): Alignment => {
      const left = cell.startsWith(':')
      const right = cell.endsWith(':')
      return left && right ? 'center' : left ? 'left' : right ? 'right' : 'none'
    })
    const rows = [lines[0], ...lines.slice(2)].map(cellsOf)
    const width = Math.max(alignments.length, ...rows.map((row) => row.length))
    while (alignments.length < width) alignments.push('none')
    return new MarkdownTable(rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]), alignments)
  }

  get columns() {
    return this.alignments.length
  }

  get widths() {
    return this.alignments.map((_, column) => Math.max(3, ...this.rows.map((row) => row[column].length)))
  }

  render() {
    const widths = this.widths
    const line = (cells: string[]) => `| ${cells.map((cell, i) => pad(cell, widths[i], this.alignments[i])).join(' | ')} |`
    const rule = this.alignments.map((alignment, i) => {
      const width = widths[i]
      if (alignment === 'left') return ':' + '-'.repeat(width - 1)
      if (alignment === 'right') return '-'.repeat(width - 1) + ':'
      if (alignment === 'center') return ':' + '-'.repeat(width - 2) + ':'
      return '-'.repeat(width)
    })
    return [line(this.rows[0]), `| ${rule.join(' | ')} |`, ...this.rows.slice(1).map(line)].join('\n')
  }

  offset(row: number, column: number) {
    const widths = this.widths
    const lineLength = widths.reduce((a, b) => a + b, 0) + 3 * this.columns + 1
    const cell = this.rows[row][column]
    const cellStart = 2 + widths.slice(0, column).reduce((a, b) => a + b, 0) + 3 * column
    const leading = cell ? pad(cell, widths[column], this.alignments[column]).indexOf(cell) : 0
    return (row === 0 ? 0 : row + 1) * (lineLength + 1) + cellStart + leading + cell.length
  }

  insertRow(at: number) {
    this.rows.splice(Math.min(Math.max(at, 1), this.rows.length), 0, Array<string>(this.columns).fill(''))
  }

  deleteRow(at: number) {
    if (this.rows.length > 1) this.rows.splice(at, 1)
  }

  moveRow(at: number, delta: number) {
    const target = at + delta
    if (at < 1 || target < 1 || target >= this.rows.length) return at
    ;[this.rows[at], this.rows[target]] = [this.rows[target], this.rows[at]]
    return target
  }

  insertColumn(at: number) {
    this.alignments.splice(at, 0, 'none')
    for (const row of this.rows) row.splice(at, 0, '')
  }

  deleteColumn(at: number) {
    if (this.columns < 2) return
    this.alignments.splice(at, 1)
    for (const row of this.rows) row.splice(at, 1)
  }

  moveColumn(at: number, delta: number) {
    const target = at + delta
    if (target < 0 || target >= this.columns) return at
    ;[this.alignments[at], this.alignments[target]] = [this.alignments[target], this.alignments[at]]
    for (const row of this.rows) [row[at], row[target]] = [row[target], row[at]]
    return target
  }

  sort(column: number, ascending: boolean) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const body = this.rows.slice(1).sort((a, b) => collator.compare(a[column], b[column]) * (ascending ? 1 : -1))
    this.rows = [this.rows[0], ...body]
  }
}

export interface TableLocation {
  from: number
  to: number
  table: MarkdownTable
  row: number
  column: number
}

export function locateTable(doc: Text, pos: number): TableLocation | null {
  const current = doc.lineAt(pos)
  if (!current.text.includes('|')) return null
  let first = current.number
  let last = current.number
  while (first > 1 && doc.line(first - 1).text.includes('|')) first--
  while (last < doc.lines && doc.line(last + 1).text.includes('|')) last++
  const lines = Array.from({ length: last - first + 1 }, (_, i) => doc.line(first + i))
  const table = MarkdownTable.parse(lines.map((line) => line.text))
  if (!table) return null
  const index = current.number - first
  return {
    from: lines[0].from,
    to: lines[lines.length - 1].to,
    table,
    row: index <= 1 ? 0 : index - 1,
    column: Math.min(columnIndex(current.text, pos - current.from), table.columns - 1),
  }
}
