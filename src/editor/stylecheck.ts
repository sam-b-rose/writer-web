import type { StyleCategory } from '../store'
import { lineDecorator, type Mark } from './lines'

const phrases: Record<Exclude<StyleCategory, 'custom'>, string[]> = {
  fillers: [
    'actually', 'basically', 'certainly', 'definitely', 'essentially', 'extremely', 'fairly', 'frankly',
    'honestly', 'hopefully', 'just', 'kind of', 'literally', 'mostly', 'obviously', 'perhaps', 'pretty much',
    'quite', 'rather', 'really', 'seriously', 'simply', 'somehow', 'somewhat', 'sort of', 'surely',
    'totally', 'truly', 'utterly', 'very', 'virtually',
  ],
  cliches: [
    'a perfect storm', 'at the end of the day', 'at this point in time', 'avoid like the plague',
    'best of both worlds', 'circle back', 'deep dive', 'few and far between', 'game changer',
    'going forward', 'in the nick of time', 'in this day and age', 'it goes without saying',
    'last but not least', 'level playing field', 'low-hanging fruit', 'move the needle',
    'needle in a haystack', 'only time will tell', 'paradigm shift', 'par for the course',
    'push the envelope', 'think outside the box', 'tip of the iceberg', 'touch base', 'win-win',
  ],
  redundancies: [
    'absolutely essential', 'added bonus', 'advance planning', 'basic fundamentals', 'close proximity',
    'completely finished', 'each and every', 'end result', 'final outcome', 'free gift', 'future plans',
    'join together', 'new innovation', 'past history', 'period of time', 'reason why', 'repeat again',
    'revert back', 'true facts', 'unexpected surprise', 'very unique',
  ],
}

const labels: Record<StyleCategory, string> = {
  fillers: 'Filler',
  cliches: 'Cliché',
  redundancies: 'Redundancy',
  custom: 'Custom pattern',
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parsePatterns(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

export function styleCheck(custom: string) {
  const lists: Record<StyleCategory, string[]> = { ...phrases, custom: parsePatterns(custom) }
  const patterns = (Object.keys(lists) as StyleCategory[])
    .filter((category) => lists[category].length)
    .map((category) => ({
      category,
      regex: new RegExp(
        `(?<![\\p{L}\\p{N}])(?:${[...lists[category]]
          .sort((a, b) => b.length - a.length)
          .map(escape)
          .join('|')})(?![\\p{L}\\p{N}])`,
        'giu',
      ),
    }))

  return lineDecorator((text): Mark[] =>
    patterns.flatMap(({ category, regex }) =>
      [...text.matchAll(regex)].map((match): Mark => [
        match.index,
        match.index + match[0].length,
        `cm-style cm-style-${category}`,
        labels[category],
      ]),
    ),
  )
}

export function styleClasses(enabled: Record<StyleCategory, boolean>) {
  return Object.entries(enabled)
    .filter(([, on]) => on)
    .map(([category]) => `check-${category}`)
    .join(' ')
}
