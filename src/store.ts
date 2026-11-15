import welcome from './welcome.md?raw'
import shortcuts from './shortcuts.md?raw'

export type AuthorRange = [from: number, to: number, author: string]

export const AI = '&AI'
export const REFERENCE = '*Reference'

export interface Doc {
  id: string
  body: string
  updated: number
  authors: AuthorRange[]
  name?: string
}

export interface SmartFolder {
  name: string
  query: string
}

export const templates = ['Duo', 'Mono', 'Quattro', 'Sans', 'Serif', 'GitHub'] as const

export type Template = (typeof templates)[number]
export type FocusScope = 'sentence' | 'paragraph'
export type PartOfSpeech = 'adjectives' | 'nouns' | 'adverbs' | 'verbs' | 'conjunctions'
export type StyleCategory = 'fillers' | 'cliches' | 'redundancies' | 'custom'
export type StatKind =
  | 'words'
  | 'characters'
  | 'charactersNoSpaces'
  | 'sentences'
  | 'paragraphs'
  | 'tasks'
  | 'reading'
  | 'speaking'

export interface Settings {
  focus: boolean
  focusScope: FocusScope
  typewriter: boolean
  syntax: Record<PartOfSpeech, boolean>
  style: Record<StyleCategory, boolean>
  customPatterns: string
  authors: boolean
  font: 'mono' | 'duo' | 'quattro'
  size: number
  appearance: 'auto' | 'light' | 'dark'
  stat: StatKind
  template: Template
  hardBreaks: boolean
  sort: 'modified' | 'name'
  smartFolders: SmartFolder[]
  library: boolean
  preview: boolean
  current: string | null
}

const DOCS_KEY = 'writer.docs'
const SETTINGS_KEY = 'writer.settings'

export const defaultSettings: Settings = {
  focus: false,
  focusScope: 'sentence',
  typewriter: false,
  syntax: { adjectives: false, nouns: false, adverbs: false, verbs: false, conjunctions: false },
  style: { fillers: false, cliches: false, redundancies: false, custom: false },
  customPatterns: '',
  authors: true,
  font: 'duo',
  size: 18,
  appearance: 'auto',
  stat: 'words',
  template: 'Duo',
  hardBreaks: false,
  sort: 'modified',
  smartFolders: [],
  library: true,
  preview: false,
  current: null,
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function newDoc(body = '', authors: AuthorRange[] = []): Doc {
  return { id: crypto.randomUUID(), body, updated: Date.now(), authors }
}

export type StoredDoc = Omit<Doc, 'authors'> & { authors?: AuthorRange[]; ai?: [number, number][] }

export const LEGACY_DOCS_KEY = DOCS_KEY

export function seedDocs(): Doc[] {
  return [newDoc(welcome), { ...newDoc(shortcuts), updated: Date.now() - 1 }]
}

export function normalizeDocs(stored: StoredDoc[]): Doc[] {
  return stored.map(({ ai, ...doc }) => ({
    ...doc,
    authors: doc.authors ?? (ai ?? []).map(([from, to]): AuthorRange => [from, to, AI]),
  }))
}

export function loadSettings(): Settings {
  const saved = read<Partial<Settings>>(SETTINGS_KEY) ?? {}
  return {
    ...defaultSettings,
    ...saved,
    syntax: { ...defaultSettings.syntax, ...saved.syntax },
    style: { ...defaultSettings.style, ...saved.style },
  }
}

export function saveSettings(settings: Settings) {
  write(SETTINGS_KEY, settings)
}

export function headingOf(doc: Doc) {
  const line = doc.body.split('\n').find((l) => l.trim())
  return line?.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim().slice(0, 80) || 'Untitled'
}

export function titleOf(doc: Doc) {
  return doc.name || headingOf(doc)
}

export function excerptOf(doc: Doc) {
  const lines = doc.body.split('\n').filter((l) => l.trim())
  return lines.slice(1).join(' ').replace(/[#*_`>]/g, '').trim().slice(0, 120)
}

const fenced = /^(```|~~~)[\s\S]*?^\1.*$/gm
const hashtag = /(?<![\p{L}\p{N}_#&/\](])#(?!\d+(?:[^\p{L}\p{N}_]|$))[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu

export function hashtagsOf(body: string) {
  return new Set([...body.replace(fenced, '').matchAll(hashtag)].map((m) => m[0].slice(1).toLowerCase()))
}

export function matchesQuery(doc: Doc, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const body = doc.body.toLowerCase()
  const tags = hashtagsOf(doc.body)
  return terms.every((term) => (term.startsWith('#') && term.length > 1 ? tags.has(term.slice(1)) : body.includes(term)))
}
