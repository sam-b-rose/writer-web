import type { StatKind } from './store'

export const statOrder: StatKind[] = ['words', 'characters', 'charactersNoSpaces', 'sentences', 'paragraphs', 'tasks', 'reading', 'speaking']

const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const number = new Intl.NumberFormat()

const task = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\]/gm
const doneTask = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[xX]\]/gm

function plain(text: string) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?/gim, '')
    .replace(/^>\s?/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
}

function paragraphs(text: string) {
  return text.split(/\n\s*\n/).filter((p) => p.trim())
}

function duration(words: number, perMinute: number) {
  const seconds = Math.round((words / perMinute) * 60)
  if (seconds < 60) return `${seconds} sec`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function wordCount(text: string) {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

function measure(kind: StatKind, raw: string) {
  const text = plain(raw)
  switch (kind) {
    case 'words':
      return wordCount(text)
    case 'characters':
      return [...text.replace(/\n/g, '')].length
    case 'charactersNoSpaces':
      return [...text.replace(/\s/g, '')].length
    case 'tasks':
      return raw.match(task)?.length ?? 0
    case 'sentences':
      return paragraphs(text).reduce((sum, p) => sum + [...sentenceSegmenter.segment(p)].length, 0)
    case 'paragraphs':
      return paragraphs(text).length
    case 'reading':
    case 'speaking':
      return wordCount(text)
  }
}

const units: Record<StatKind, [string, string]> = {
  words: ['Word', 'Words'],
  characters: ['Character', 'Characters'],
  charactersNoSpaces: ['Character', 'Characters'],
  tasks: ['Task', 'Tasks'],
  sentences: ['Sentence', 'Sentences'],
  paragraphs: ['Paragraph', 'Paragraphs'],
  reading: ['Reading', 'Reading'],
  speaking: ['Speaking', 'Speaking'],
}

export function formatStat(kind: StatKind, doc: string, selection: string) {
  if (kind === 'reading' || kind === 'speaking') {
    const perMinute = kind === 'reading' ? 238 : 150
    const scope = selection || doc
    return `${duration(measure(kind, scope), perMinute)} ${kind === 'reading' ? 'Reading' : 'Speaking'}`
  }
  if (kind === 'tasks') return `${doc.match(doneTask)?.length ?? 0} of ${measure(kind, doc)} Tasks`
  const total = measure(kind, doc)
  const [one, many] = units[kind]
  if (selection) return `${number.format(measure(kind, selection))} of ${number.format(total)} ${many}`
  return `${number.format(total)} ${total === 1 ? one : many}`
}
