import { EditorView } from '@codemirror/view'
import { lineDecorator, type Mark } from './lines'

const patterns: [RegExp, string, group?: number][] = [
  [/\[\[([^\]\n]+)\]\]/g, 'cm-wikilink', 1],
  [/\[\^[^\]\n]+\]:?/g, 'cm-footnote'],
  [/==(?=\S)(.+?)(?<=\S)==/g, 'cm-mark', 1],
  [/(?<![\\$\w])\$(?=\S)[^$\n]+?(?<=\S)\$(?![\w$])/g, 'cm-math'],
  [/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g, 'cm-hashtag'],
  [/^\{\{TOC\}\}[ \t]*$/g, 'cm-hashtag'],
  [/(?<![\p{L}\p{N}_#&/\](])#(?!\d+(?:[^\p{L}\p{N}_]|$))[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu, 'cm-hashtag'],
]

function scan(text: string): Mark[] {
  const code = [...text.matchAll(/`[^`]*`|\]\([^)]*\)|https?:\/\/\S+/g)].map((m) => [m.index, m.index + m[0].length])
  const marks: Mark[] = []
  for (const [regex, className, group] of patterns) {
    for (const match of text.matchAll(regex)) {
      const inner = group ? match[group] : match[0]
      const from = match.index + match[0].indexOf(inner)
      if (code.some(([a, b]) => from < b && from + inner.length > a)) continue
      marks.push([from, from + inner.length, className])
    }
  }
  return marks
}

const linkPatterns: [RegExp, prefix: string][] = [
  [/\[\[([^\]|\n]+)(?:\|[^\]\n]+)?\]\]/g, 'wiki:'],
  [/\[[^\]\n]*\]\(([^)\s]+)[^)\n]*\)/g, ''],
  [/(https?:\/\/[^\s<>)\]]+)/g, ''],
]

export function extras(openLink: (target: string) => void) {
  return [
    lineDecorator(scan),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.metaKey && !event.ctrlKey) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null) return false
        const line = view.state.doc.lineAt(pos)
        const offset = pos - line.from
        for (const [regex, prefix] of linkPatterns) {
          for (const match of line.text.matchAll(regex)) {
            if (offset < match.index || offset > match.index + match[0].length) continue
            event.preventDefault()
            openLink(prefix + match[1].trim())
            return true
          }
        }
        return false
      },
    }),
  ]
}
