import type Compromise from 'compromise'
import type { PartOfSpeech } from '../store'
import { lineDecorator, maskMarkdown, type Mark } from './lines'

let nlp: typeof Compromise | null = null
let loading: Promise<void> | null = null

export const taggerReady = () => nlp !== null

export function loadTagger() {
  loading ??= import('compromise').then((module) => {
    nlp = module.default
  })
  return loading
}

const tagOrder: [tag: string, kind: PartOfSpeech][] = [
  ['Conjunction', 'conjunctions'],
  ['Adverb', 'adverbs'],
  ['Adjective', 'adjectives'],
  ['Verb', 'verbs'],
  ['Noun', 'nouns'],
]

interface Term {
  tags: string[]
  offset: { start: number; length: number }
}

function tagLine(text: string): Mark[] {
  if (!nlp || !/\p{L}/u.test(text)) return []
  const sentences = nlp(maskMarkdown(text)).json({ offset: true }) as { terms: Term[] }[]
  const marks: Mark[] = []
  for (const { terms } of sentences) {
    for (const { tags, offset } of terms) {
      const kind = tags.includes('Pronoun') ? undefined : tagOrder.find(([tag]) => tags.includes(tag))?.[1]
      if (kind) marks.push([offset.start, offset.start + offset.length, `cm-pos cm-pos-${kind}`])
    }
  }
  return marks
}

export const partsOfSpeech = lineDecorator(tagLine)

export function syntaxClasses(enabled: Record<PartOfSpeech, boolean>) {
  return Object.entries(enabled)
    .filter(([, on]) => on)
    .map(([kind]) => `show-${kind}`)
    .join(' ')
}
