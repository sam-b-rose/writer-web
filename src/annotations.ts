import type { AuthorRange } from './store'

const separator = '\n\n---\nAnnotations: '

async function digest(body: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function joinAnnotations(body: string, ranges: AuthorRange[]) {
  if (!ranges.length) return body
  const byAuthor = new Map<string, string[]>()
  for (const [from, to, author] of [...ranges].sort((a, b) => a[0] - b[0])) {
    byAuthor.set(author, [...(byAuthor.get(author) ?? []), `${from},${to - from}`])
  }
  const lines = [...byAuthor.keys()].sort().map((author) => `${author}: ${byAuthor.get(author)!.join(' ')}\n`)
  return `${body}${separator}0,${body.length} SHA-256 ${await digest(body)}\n${lines.join('')}...\n`
}

export async function splitAnnotations(file: string): Promise<{ body: string; ranges: AuthorRange[] }> {
  const at = file.lastIndexOf(separator)
  if (at < 0) return { body: file, ranges: [] }
  const body = file.slice(0, at)
  const lines = file.slice(at + separator.length).split('\n').filter(Boolean)
  if (lines.length < 2 || lines.pop() !== '...') return { body: file, ranges: [] }
  const header = lines.shift()!.split(' ')
  if (header.length !== 3 || header[1] !== 'SHA-256') return { body: file, ranges: [] }
  if (header[2] !== (await digest(body))) return { body, ranges: [] }
  const ranges: AuthorRange[] = []
  for (const line of lines) {
    const colon = line.indexOf(': ')
    if (colon < 0) continue
    for (const pair of line.slice(colon + 2).split(' ')) {
      const [start, length] = pair.split(',').map(Number)
      if (start >= 0 && length > 0 && start + length <= body.length) ranges.push([start, start + length, line.slice(0, colon)])
    }
  }
  return { body, ranges }
}
