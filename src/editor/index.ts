import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import type { AuthorRange, Doc, Settings } from '../store'
import { authorRanges, authorship } from './authors'
import { formatKeymap } from './commands'
import { extras } from './extras'
import { focusMode, typewriter } from './focus'
import { markup } from './markup'
import { styleCheck, styleClasses } from './stylecheck'
import { loadTagger, partsOfSpeech, syntaxClasses, taggerReady } from './syntax'

const focusSlot = new Compartment()
const typewriterSlot = new Compartment()
const syntaxSlot = new Compartment()
const styleSlot = new Compartment()

function slotContent(settings: Settings) {
  const anySyntax = Object.values(settings.syntax).some(Boolean)
  const anyStyle = Object.values(settings.style).some(Boolean)
  return new Map<Compartment, Extension>([
    [focusSlot, settings.focus ? focusMode(settings.focusScope) : []],
    [typewriterSlot, settings.typewriter ? typewriter : []],
    [syntaxSlot, anySyntax && taggerReady() ? [partsOfSpeech, EditorView.editorAttributes.of({ class: syntaxClasses(settings.syntax) })] : []],
    [styleSlot, anyStyle ? [styleCheck(settings.customPatterns), EditorView.editorAttributes.of({ class: styleClasses(settings.style) })] : []],
  ])
}

export interface EditorEvents {
  change(body: string, authors: AuthorRange[]): void
  openLink(target: string): void
  select(): void
}

export function createEditor(parent: HTMLElement, events: EditorEvents) {
  let settings: Settings | null = null

  const base: Extension[] = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    markup,
    authorship,
    extras((target) => events.openLink(target)),
    search({ top: true }),
    keymap.of([
      ...formatKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
    EditorView.updateListener.of((update) => {
      const authors = update.state.field(authorRanges)
      if (update.docChanged || authors !== update.startState.field(authorRanges, false)) events.change(update.state.doc.toString(), authors)
      else if (update.selectionSet) events.select()
    }),
  ]

  const view = new EditorView({ parent })

  const reconfigure = () => {
    view.dispatch({
      effects: [...slotContent(settings!)].map(([slot, ext]) => slot.reconfigure(ext)),
    })
  }

  return {
    view,
    load(doc: Doc) {
      view.setState(
        EditorState.create({
          doc: doc.body,
          extensions: [base, [...slotContent(settings!)].map(([slot, ext]) => slot.of(ext)), authorRanges.init(() => doc.authors)],
        }),
      )
    },
    configure(next: Settings) {
      settings = next
      reconfigure()
      if (Object.values(next.syntax).some(Boolean) && !taggerReady()) loadTagger().then(reconfigure)
    },
  }
}
