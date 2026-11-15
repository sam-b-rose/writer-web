import { Marked } from 'marked'
import markedFootnote from 'marked-footnote'
import previewCss from './preview.css?raw'
import { titleOf, type Doc, type Template } from './store'

export interface RenderOptions {
  hardBreaks: boolean
}

interface Context {
  math: { tex: string; display: boolean }[]
  code: string[]
}

const blockedTags = 'script, style, iframe, object, embed, link, meta, base, form'
const inlineCode = /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
const math = /\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?=\S)[^$\n]+?(?<=\S)\$(?![\w$])/g
const wikilink = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g
const highlight = /==(?=\S)(.+?)(?<=\S)==/g
const contentBlock = /^\/([^\s/"][^"\n]*?)(?:\.md)?[ \t]*$/
const fence = /^ *(```|~~~)/

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sanitize(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll(blockedTags).forEach((el) => el.remove())
  parsed.querySelectorAll('*').forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      if (name.startsWith('on') || (/^(href|src|xlink:href)$/.test(name) && /^\s*javascript:/i.test(value))) {
        el.removeAttribute(name)
      }
    }
  })
  parsed.querySelectorAll('a[href]').forEach((a) => {
    if (/^https?:|^mailto:/i.test(a.getAttribute('href') ?? '')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
  })
  return parsed.body.innerHTML
}

function transformInline(chunk: string, context: Context) {
  return chunk
    .replace(inlineCode, (match) => `\uE000C${context.code.push(match) - 1}\uE001`)
    .replace(math, (match) => {
      const display = match.startsWith('$$')
      const trim = display ? 2 : 1
      return `\uE000M${context.math.push({ tex: match.slice(trim, -trim), display }) - 1}\uE001`
    })
    .replace(wikilink, (_, target: string, label?: string) => {
      const name = target.trim()
      return `<a href="#" data-wiki="${escapeHtml(name)}">${escapeHtml(label ?? name)}</a>`
    })
    .replace(highlight, '<mark>$1</mark>')
    .replace(/^\+{3}[ \t]*$/gm, '\n<div class="page-break"></div>\n')
    .replace(/^\{\{TOC\}\}[ \t]*$/gm, '\n<!--TOC-->\n')
    .replace(/\uE000C(\d+)\uE001/g, (_, index: string) => context.code[Number(index)])
}

function preprocess(markdown: string, docs: Doc[], context: Context, depth: number, self?: Doc): string {
  const out: string[] = []
  let chunk: string[] = []
  let open: string | null = null
  const flush = () => {
    if (chunk.length) out.push(transformInline(chunk.join('\n'), context))
    chunk = []
  }
  for (const line of markdown.split('\n')) {
    const marker = fence.exec(line)?.[1]
    if (marker) {
      if (!open) {
        flush()
        open = marker
      } else if (open === marker) {
        open = null
      }
      out.push(line)
      continue
    }
    if (open) {
      out.push(line)
      continue
    }
    const name = depth < 3 ? contentBlock.exec(line)?.[1].trim().toLowerCase() : undefined
    const target = name ? docs.find((doc) => doc !== self && titleOf(doc).toLowerCase() === name) : undefined
    if (target) {
      flush()
      out.push('\n' + preprocess(target.body, docs, context, depth + 1, target) + '\n')
      continue
    }
    chunk.push(line)
  }
  flush()
  return out.join('\n')
}

function slug(title: string, used: Map<string, number>) {
  const base =
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'section'
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count ? `${base}-${count}` : base
}

function postprocess(html: string, context: Context) {
  const used = new Map<string, number>()
  const headings: { level: number; title: string; id: string }[] = []
  let out = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level: string, inner: string) => {
    const title = inner.replace(/<[^>]+>/g, '')
    const id = slug(title, used)
    headings.push({ level: Number(level), title, id })
    return `<h${level} id="${id}">${inner}</h${level}>`
  })
  if (out.includes('<!--TOC-->')) {
    const top = Math.min(...headings.map((h) => h.level), 6)
    const items = headings.map((h) => `<li class="toc-${h.level - top + 1}"><a href="#${h.id}">${h.title}</a></li>`)
    out = out.replace(/<!--TOC-->/g, `<nav class="toc"><ul>${items.join('')}</ul></nav>`)
  }
  return out
    .replace(
      /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:<br ?\/?>)?\s*/g,
      (_, kind: string) =>
        `<blockquote class="callout callout-${kind.toLowerCase()}"><p class="callout-title">${kind[0]}${kind.slice(1).toLowerCase()}</p><p>`,
    )
    .replace(/\uE000M(\d+)\uE001/g, (_, index: string) => {
      const item = context.math[Number(index)]
      return `<span class="math ${item.display ? 'display' : 'inline'}">${escapeHtml(item.tex)}</span>`
    })
}

export function renderMarkdown(doc: Doc, docs: Doc[], options: RenderOptions) {
  const context: Context = { math: [], code: [] }
  const parser = new Marked({ gfm: true, breaks: options.hardBreaks }).use(markedFootnote())
  const prepared = preprocess(doc.body, docs, context, 0, doc)
  return sanitize(postprocess(parser.parse(prepared, { async: false }), context))
}

export async function renderMath(root: HTMLElement) {
  const nodes = root.querySelectorAll<HTMLElement>('.math:not(.rendered)')
  if (!nodes.length) return
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')])
  nodes.forEach((node) => {
    katex.render(node.textContent ?? '', node, { displayMode: node.classList.contains('display'), throwOnError: false })
    node.classList.add('rendered')
  })
}

export const templateClass = (template: Template) => `preview-doc template-${template.toLowerCase()}`

export function standaloneHtml(doc: Doc, docs: Doc[], options: RenderOptions, template: Template) {
  const body = renderMarkdown(doc, docs, options)
  const mathAssets = body.includes('class="math ')
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js"></script>
<script>
addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.math').forEach(function (el) {
    katex.render(el.textContent, el, { displayMode: el.classList.contains('display'), throwOnError: false });
  });
});
</script>
`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(titleOf(doc))}</title>
<style>
body { margin: 0; padding: 48px 20px; }
${previewCss}
</style>
${mathAssets}</head>
<body><article class="${templateClass(template)}">${body}</article></body>
</html>`
}
