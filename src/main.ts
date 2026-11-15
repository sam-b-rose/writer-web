import './style.css'
import './preview.css'
import { joinAnnotations, splitAnnotations } from './annotations'
import { describeSaveError, openLibrary } from './persistence'
import { afterPaint, LARGE_DOCUMENT, progress } from './progress'
import { createEditor } from './editor'
import { markSelection, pasteClipboardAs } from './editor/authors'
import { displayKey, formatSections } from './editor/commands'
import { renderMarkdown, renderMath, standaloneHtml, templateClass } from './preview'
import { formatStat, statOrder } from './stats'
import {
  AI,
  excerptOf,
  hashtagsOf,
  headingOf,
  loadSettings,
  matchesQuery,
  newDoc,
  REFERENCE,
  saveSettings,
  templates,
  titleOf,
  type AuthorRange,
  type Doc,
  type PartOfSpeech,
  type Settings,
  type StyleCategory,
} from './store'

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

const app = byId('app')
const libraryList = byId<HTMLUListElement>('library-list')
const libraryExtras = byId('library-extras')
const librarySearch = byId<HTMLInputElement>('library-search')
const docTitle = byId<HTMLInputElement>('doc-title')
const previewPane = byId('preview')
const previewBody = byId('preview-body')
const stats = byId<HTMLButtonElement>('stats')
const menu = byId('menu')
const sheet = byId<HTMLDialogElement>('sheet')
const quick = byId('quick')
const quickInput = byId<HTMLInputElement>('quick-input')
const quickList = byId<HTMLUListElement>('quick-list')
const fileInput = byId<HTMLInputElement>('file-input')
const narrow = matchMedia('(max-width: 760px)')

let slowStart = false
const startTimer = window.setTimeout(() => {
  slowStart = true
  progress.start()
}, 150)
const library = await openLibrary()
clearTimeout(startTimer)
if (slowStart) progress.done()
let docs = library.docs
let settings = loadSettings()
let current = docs.find((d) => d.id === settings.current) ?? docs[0] ?? addDoc()

const editor = createEditor(byId('editor'), {
  change(body, authors) {
    current.body = body
    current.authors = authors
    current.updated = Date.now()
    persistSoon(current)
    renderSoon()
  },
  select() {
    renderStats()
  },
  openLink(target) {
    if (target.startsWith('wiki:')) openWikilink(target.slice(5))
    else if (/^(https?:|mailto:)/i.test(target)) window.open(target, '_blank', 'noopener')
  },
})

function addDoc(body = '', authors: AuthorRange[] = []) {
  const doc = newDoc(body, authors)
  docs.unshift(doc)
  persistSoon(doc)
  return doc
}

/* Saving */

const unsaved = new Set<Doc>()
const removed = new Set<string>()
const saveWarning = byId('save-warning')
let saveTimer = 0
let saving = Promise.resolve()
let saveFailed = false

function persistSoon(doc?: Doc) {
  if (doc) unsaved.add(doc)
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flush, 250)
}

function flush() {
  clearTimeout(saveTimer)
  saving = saving.then(async () => {
    if (!unsaved.size && !removed.size) return
    const changed = [...unsaved].filter((doc) => docs.includes(doc))
    const deleted = [...removed]
    unsaved.clear()
    removed.clear()
    try {
      await library.save(changed, deleted, docs)
      showSaveWarning(null)
    } catch (error) {
      changed.forEach((doc) => unsaved.add(doc))
      deleted.forEach((id) => removed.add(id))
      showSaveWarning(error)
    }
  })
  return saving
}

function showSaveWarning(error: unknown) {
  saveFailed = error !== null
  saveWarning.hidden = !saveFailed
  if (saveFailed) byId('save-warning-reason').textContent = describeSaveError(error)
}

byId('save-retry').addEventListener('click', () => flush())
byId('save-download').addEventListener('click', () => downloadMarkdown())

let frame = 0
function renderSoon() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    renderLibrary()
    renderTitle()
    renderStats()
    renderPreview()
  })
}

function update(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  applySettings()
}

function applySettings() {
  const root = document.documentElement
  if (settings.appearance === 'auto') delete root.dataset.theme
  else root.dataset.theme = settings.appearance
  root.dataset.font = settings.font
  root.style.setProperty('--size', `${settings.size}px`)
  root.classList.toggle('show-authors', settings.authors)
  app.classList.toggle('library-closed', !settings.library)
  app.classList.toggle('preview-open', settings.preview)
  previewPane.hidden = !settings.preview
  byId('toggle-library').setAttribute('aria-pressed', String(settings.library))
  byId('toggle-preview').setAttribute('aria-pressed', String(settings.preview))
  editor.configure(settings)
  saveSettings(settings)
  renderLibrary()
  renderStats()
  renderPreview()
  if (menuMode) renderMenu()
}

let opening = 0

function open(doc: Doc) {
  const token = ++opening
  if (doc.body.length < LARGE_DOCUMENT) return show(doc)
  progress.start()
  afterPaint().then(() => {
    if (token === opening) show(doc)
    progress.done()
  })
}

function show(doc: Doc) {
  current = doc
  settings.current = doc.id
  saveSettings(settings)
  editor.load(doc)
  if (narrow.matches && settings.library) update({ library: false })
  renderLibrary()
  renderTitle()
  renderStats()
  renderPreview()
  editor.view.focus()
}

function openWikilink(name: string) {
  const wanted = name.trim().toLowerCase()
  open(docs.find((doc) => titleOf(doc).toLowerCase() === wanted) ?? addDoc(`# ${name.trim()}\n\n`))
}

function remove(doc: Doc) {
  if (!confirm(`Delete “${titleOf(doc)}”? This can’t be undone.`)) return
  docs = docs.filter((d) => d !== doc)
  unsaved.delete(doc)
  removed.add(doc.id)
  persistSoon()
  if (doc === current) open(docs[0] ?? addDoc())
  else renderLibrary()
}

/* Library */

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function formatDate(time: number) {
  const date = new Date(time)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return timeFormat.format(date)
  return date.getFullYear() === now.getFullYear() ? dateFormat.format(date) : yearFormat.format(date)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function sortedDocs(query = '') {
  return docs
    .filter((doc) => matchesQuery(doc, query))
    .sort((a, b) => (settings.sort === 'name' ? titleOf(a).localeCompare(titleOf(b)) : b.updated - a.updated))
}

function setQuery(query: string) {
  librarySearch.value = librarySearch.value.trim() === query ? '' : query
  renderLibrary()
}

function chip(label: string, query: string, className = '') {
  const button = el('button', { className: `chip ${className}`.trim(), textContent: label })
  button.setAttribute('aria-pressed', String(librarySearch.value.trim() === query))
  button.addEventListener('click', () => setQuery(query))
  return button
}

function renderExtras() {
  const query = librarySearch.value.trim()
  const nodes: HTMLElement[] = []
  for (const folder of settings.smartFolders) {
    const item = chip(folder.name, folder.query, 'smart')
    const removeButton = el('span', { className: 'remove', textContent: '×', title: 'Delete smart folder' })
    removeButton.addEventListener('click', (event) => {
      event.stopPropagation()
      update({ smartFolders: settings.smartFolders.filter((f) => f !== folder) })
    })
    item.append(removeButton)
    nodes.push(item)
  }
  if (query && !settings.smartFolders.some((f) => f.query === query)) {
    const save = el('button', { className: 'chip action', textContent: 'Save as Smart Folder' })
    save.addEventListener('click', () => {
      const name = prompt('Smart folder name', query)?.trim()
      if (name) update({ smartFolders: [...settings.smartFolders.filter((f) => f.name !== name), { name, query }] })
    })
    nodes.push(save)
  }
  const tags = new Set(docs.flatMap((doc) => [...hashtagsOf(doc.body)]))
  for (const tag of [...tags].sort()) nodes.push(chip(`#${tag}`, `#${tag}`))
  libraryExtras.replaceChildren(...nodes)
}

function renderLibrary() {
  renderExtras()
  const items = sortedDocs(librarySearch.value)
  if (!items.length) {
    libraryList.replaceChildren(el('li', { className: 'library-empty', textContent: 'No documents' }))
    return
  }
  libraryList.replaceChildren(
    ...items.map((doc) => {
      const remover = el('button', { className: 'delete', title: 'Delete', textContent: '×' })
      remover.setAttribute('aria-label', `Delete ${titleOf(doc)}`)
      remover.addEventListener('click', (event) => {
        event.stopPropagation()
        remove(doc)
      })
      const item = el(
        'li',
        { className: 'library-item' },
        el('h3', { textContent: titleOf(doc) }),
        el('p', { textContent: excerptOf(doc) }),
        el('time', { textContent: formatDate(doc.updated) }),
        remover,
      )
      item.setAttribute('aria-current', String(doc === current))
      item.addEventListener('click', () => open(doc))
      return item
    }),
  )
}

function renderTitle() {
  const title = titleOf(current)
  if (document.activeElement !== docTitle) docTitle.value = title
  document.title = title
}

function rename(value: string) {
  const name = value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  const next = name && name !== headingOf(current) ? name : undefined
  if (next === current.name) return
  current.name = next
  current.updated = Date.now()
  persistSoon(current)
  renderLibrary()
  renderPreview()
}

docTitle.addEventListener('mousedown', (event) => {
  if (document.activeElement === docTitle) return
  event.preventDefault()
  docTitle.focus()
  docTitle.select()
})
docTitle.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    editor.view.focus()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    docTitle.value = titleOf(current)
    editor.view.focus()
  }
})
docTitle.addEventListener('blur', () => {
  rename(docTitle.value)
  renderTitle()
})

function renderStats() {
  const { state } = editor.view
  const { from, to } = state.selection.main
  stats.textContent = formatStat(settings.stat, state.doc.toString(), state.sliceDoc(from, to))
}

const renderOptions = () => ({ hardBreaks: settings.hardBreaks })

function renderPreview(force = false) {
  if (!settings.preview && !force) return
  previewBody.className = templateClass(settings.template)
  previewBody.innerHTML = renderMarkdown(current, docs, renderOptions())
  renderMath(previewBody)
}

previewBody.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  const wiki = link.dataset.wiki
  const href = link.getAttribute('href') ?? ''
  if (wiki) {
    event.preventDefault()
    openWikilink(wiki)
  } else if (href.startsWith('#')) {
    event.preventDefault()
    previewBody.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ block: 'start' })
  }
})

/* Sheets */

function showSheet(title: string, ...content: (Node | string)[]) {
  const close = el('button', { className: 'icon-btn', textContent: '×', title: 'Close' })
  close.addEventListener('click', () => sheet.close())
  sheet.replaceChildren(
    el('div', { className: 'sheet-head' }, el('h2', { textContent: title }), close),
    el('div', { className: 'sheet-body' }, ...content),
  )
  if (!sheet.open) sheet.showModal()
}

sheet.addEventListener('click', (event) => {
  if (event.target === sheet) sheet.close()
})
sheet.addEventListener('close', () => editor.view.focus())

function editCustomPatterns() {
  closeMenu()
  const area = document.createElement('textarea')
  area.value = settings.customPatterns
  area.spellcheck = false
  area.placeholder = 'One word or phrase per line'
  const save = el('button', { className: 'primary', textContent: 'Save' })
  const cancel = el('button', { textContent: 'Cancel' })
  cancel.addEventListener('click', () => sheet.close())
  save.addEventListener('click', () => {
    update({ customPatterns: area.value, style: { ...settings.style, custom: true } })
    sheet.close()
  })
  const actions = document.createElement('div')
  actions.className = 'sheet-actions'
  actions.append(cancel, save)
  showSheet(
    'Custom Style Check Patterns',
    'Words and phrases listed here are struck through while Style Check is on.',
    area,
    actions,
  )
  area.focus()
}

function showShortcuts() {
  closeMenu()
  const section = (title: string, rows: [string, string][]) => {
    const list = el('dl')
    for (const [name, keys] of rows) {
      list.append(el('dt', { textContent: name }), el('dd', {}, ...keys.split(' / ').map((key) => el('kbd', { textContent: key }))))
    }
    return el('section', {}, heading(title), list)
  }
  const app = (name: AppCommand['section']) =>
    appCommands.filter((command) => command.section === name).map((command): [string, string] => [command.title, command.keys])
  const format = formatSections.map((group) => {
    const rows = group.items.filter((item) => item.key).map((item): [string, string] => [item.title, displayKey(item.key!)])
    const headings = rows.filter(([name]) => /^Heading \d$/.test(name))
    if (headings.length > 2) {
      const merged: [string, string] = [`Heading 1–${headings.length}`, `${headings[0][1]}–${headings.length}`]
      rows.splice(rows.indexOf(headings[0]), headings.length, merged)
    }
    return section(group.title, rows)
  })
  const sections = [
    section('File', app('File')),
    section('Edit', [...app('Edit'), ['Paste as AI', '⇧⌘V'], ['Find', '⌘F']]),
    section('View', app('View')),
    ...format.filter((node) => node.querySelector('dt')),
    section('Editor', [
      ['Follow Link or Wikilink', '⌘ Click'],
      ['Next / Previous Table Cell', '⇥ / ⇧⇥'],
    ]),
  ]
  showSheet('Keyboard Shortcuts', el('div', { className: 'shortcuts' }, ...sections))
}

/* Menus */

const partsOfSpeech: [PartOfSpeech, string][] = [
  ['adjectives', 'Adjectives'],
  ['nouns', 'Nouns'],
  ['adverbs', 'Adverbs'],
  ['verbs', 'Verbs'],
  ['conjunctions', 'Conjunctions'],
]

const styleCategories: [StyleCategory, string][] = [
  ['fillers', 'Fillers'],
  ['cliches', 'Clichés'],
  ['redundancies', 'Redundancies'],
  ['custom', 'Custom Patterns'],
]

function menuItem(label: string, run: () => void, options: { checked?: boolean; keys?: string; swatch?: string } = {}) {
  const button = el('button', { className: 'menu-item' })
  if (options.checked !== undefined) {
    button.setAttribute('role', 'menuitemcheckbox')
    button.setAttribute('aria-checked', String(options.checked))
    button.append(el('span', { className: 'check', textContent: options.checked ? '✓' : '' }))
  }
  if (options.swatch) {
    const swatch = el('span', { className: 'swatch' })
    swatch.style.background = `var(--${options.swatch})`
    button.append(swatch)
  }
  button.append(label)
  if (options.keys) button.append(el('kbd', { textContent: options.keys }))
  button.addEventListener('click', run)
  return button
}

function segmented<T extends string | number>(choices: [T, string][], active: T | null, pick: (value: T) => void) {
  return el(
    'div',
    { className: 'segmented' },
    ...choices.map(([value, label]) => {
      const button = el('button', { textContent: label })
      button.setAttribute('aria-pressed', String(value === active))
      button.addEventListener('click', () => pick(value))
      return button
    }),
  )
}

const heading = (text: string) => el('h4', { textContent: text })
const rule = () => el('hr')

function markAs(author: string | null) {
  closeMenu()
  markSelection(editor.view, author)
}

function markAsOther() {
  const name = prompt('Author name')?.trim()
  if (name) markAs(`@${name}`)
}

function viewMenu() {
  return [
    heading('Focus'),
    menuItem('Focus Mode', toggleFocus, { checked: settings.focus, keys: '⌘D' }),
    segmented(
      [
        ['sentence', 'Sentence'],
        ['paragraph', 'Paragraph'],
      ],
      settings.focusScope,
      (focusScope) => update({ focusScope, focus: true }),
    ),
    menuItem('Typewriter Mode', () => update({ typewriter: !settings.typewriter }), { checked: settings.typewriter, keys: '⌥⌘T' }),
    rule(),
    heading('Syntax'),
    ...partsOfSpeech.map(([kind, label]) =>
      menuItem(label, () => update({ syntax: { ...settings.syntax, [kind]: !settings.syntax[kind] } }), {
        checked: settings.syntax[kind],
        swatch: kind,
      }),
    ),
    rule(),
    heading('Style Check'),
    ...styleCategories.map(([category, label]) =>
      menuItem(label, () => update({ style: { ...settings.style, [category]: !settings.style[category] } }), {
        checked: settings.style[category],
      }),
    ),
    menuItem('Edit Custom Patterns…', editCustomPatterns),
    rule(),
    heading('Authors'),
    menuItem('Show Authors', () => update({ authors: !settings.authors }), { checked: settings.authors }),
    menuItem('Paste as AI', () => (closeMenu(), pasteClipboardAs(editor.view, AI)), { keys: '⇧⌘V' }),
    menuItem('Paste as Reference', () => (closeMenu(), pasteClipboardAs(editor.view, REFERENCE))),
    menuItem('Mark Selection as Human', () => markAs(null)),
    menuItem('Mark Selection as AI', () => markAs(AI), { swatch: 'ai' }),
    menuItem('Mark Selection as Reference', () => markAs(REFERENCE), { swatch: 'reference' }),
    menuItem('Mark Selection as Other Author…', markAsOther, { swatch: 'other-author' }),
    rule(),
    heading('Font'),
    segmented(
      [
        ['mono', 'Mono'],
        ['duo', 'Duo'],
        ['quattro', 'Quattro'],
      ],
      settings.font,
      (font) => update({ font }),
    ),
    heading('Text Size'),
    segmented<number>(
      [
        [-1, 'A−'],
        [0, `${settings.size}`],
        [1, 'A+'],
      ],
      null,
      (step) => resize(step),
    ),
    heading('Appearance'),
    segmented(
      [
        ['auto', 'Auto'],
        ['light', 'Light'],
        ['dark', 'Dark'],
      ],
      settings.appearance,
      (appearance) => update({ appearance }),
    ),
    rule(),
    heading('Preview Template'),
    ...templates.map((template) => menuItem(template, () => update({ template }), { checked: settings.template === template })),
    menuItem('Single Return Starts a New Paragraph', () => update({ hardBreaks: !settings.hardBreaks }), { checked: settings.hardBreaks }),
    rule(),
    heading('Sort Library By'),
    segmented(
      [
        ['modified', 'Date'],
        ['name', 'Name'],
      ],
      settings.sort,
      (sort) => update({ sort }),
    ),
    rule(),
    menuItem('Open File…', () => fileInput.click()),
    menuItem('Download Markdown', downloadMarkdown, { keys: '⌘S' }),
    menuItem('Download HTML', downloadHtml),
    menuItem('Copy HTML', () => navigator.clipboard.writeText(renderMarkdown(current, docs, renderOptions()))),
    menuItem('Print or PDF', print, { keys: '⌘P' }),
    rule(),
    menuItem('Keyboard Shortcuts', showShortcuts, { keys: '⌘/' }),
  ]
}

function formatMenu() {
  return formatSections.flatMap((section, index) => [
    ...(index ? [rule()] : []),
    heading(section.title),
    ...section.items.map((item) =>
      menuItem(
        item.title,
        () => {
          closeMenu()
          item.run(editor.view)
          editor.view.focus()
        },
        { keys: item.key ? displayKey(item.key) : undefined },
      ),
    ),
  ])
}

let menuMode: 'view' | 'format' | null = null

function renderMenu() {
  menu.replaceChildren(...(menuMode === 'format' ? formatMenu() : viewMenu()))
}

function showMenu(mode: 'view' | 'format' | null) {
  menuMode = mode
  menu.hidden = !mode
  menu.style.right = mode === 'format' ? '46px' : ''
  byId('toggle-menu').setAttribute('aria-pressed', String(mode === 'view'))
  byId('toggle-format').setAttribute('aria-pressed', String(mode === 'format'))
  if (mode) renderMenu()
}

const closeMenu = () => showMenu(null)

/* Commands */

function toggleFocus() {
  update({ focus: !settings.focus })
}

function toggleAll<K extends string>(values: Record<K, boolean>) {
  const on = !Object.values(values).some(Boolean)
  return Object.fromEntries(Object.keys(values).map((k) => [k, on])) as Record<K, boolean>
}

function resize(step: number) {
  update({ size: step === 0 ? 18 : Math.min(32, Math.max(12, settings.size + step)) })
}

function isDark() {
  return settings.appearance === 'dark' || (settings.appearance === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
}

function fileName(ext: string) {
  return `${titleOf(current).replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled'}.${ext}`
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  el('a', { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadMarkdown() {
  download(fileName('md'), await joinAnnotations(current.body, current.authors), 'text/markdown')
}

function downloadHtml() {
  download(fileName('html'), standaloneHtml(current, docs, renderOptions(), settings.template), 'text/html')
}

function print() {
  closeMenu()
  renderPreview(true)
  renderMath(previewBody).then(() => window.print())
}

async function importFiles(files: Iterable<File>) {
  const list = [...files].filter((file) => /\.(md|markdown|txt|text)$/i.test(file.name) || file.type.startsWith('text/'))
  if (!list.length) return
  const total = list.reduce((sum, file) => sum + file.size, 0)
  const tracked = total >= LARGE_DOCUMENT || list.length > 3
  if (tracked) {
    progress.start(0)
    await afterPaint()
  }
  let read = 0
  let last: Doc | null = null
  try {
    for (const file of list) {
      const { body, ranges } = await splitAnnotations(await file.text())
      last = addDoc(body, ranges)
      read += file.size
      if (tracked) progress.set((read / Math.max(total, 1)) * 0.9)
    }
  } finally {
    if (last) open(last)
    if (tracked) progress.done()
  }
}

/* Quick search */

let quickIndex = 0

function quickResults() {
  const q = quickInput.value.trim().toLowerCase()
  const all = sortedDocs(q)
  return q ? all.sort((a, b) => Number(titleOf(b).toLowerCase().includes(q)) - Number(titleOf(a).toLowerCase().includes(q))) : all
}

function renderQuick() {
  const results = quickResults().slice(0, 50)
  quickIndex = Math.min(quickIndex, Math.max(results.length - 1, 0))
  quickList.replaceChildren(
    ...results.map((doc, i) => {
      const item = el('li', {}, titleOf(doc), el('span', { textContent: formatDate(doc.updated) }))
      item.setAttribute('aria-selected', String(i === quickIndex))
      item.addEventListener('mousedown', (event) => {
        event.preventDefault()
        closeQuick()
        open(doc)
      })
      return item
    }),
  )
  quickList.children[quickIndex]?.scrollIntoView({ block: 'nearest' })
}

function openQuick() {
  closeMenu()
  quick.hidden = false
  quickInput.value = ''
  quickIndex = 0
  renderQuick()
  quickInput.focus()
}

function closeQuick() {
  quick.hidden = true
  editor.view.focus()
}

quickInput.addEventListener('input', () => {
  quickIndex = 0
  renderQuick()
})

quickInput.addEventListener('keydown', (event) => {
  const results = quickResults()
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    quickIndex = (quickIndex + step + results.length) % Math.max(results.length, 1)
    renderQuick()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const doc = results[quickIndex]
    if (doc) {
      closeQuick()
      open(doc)
    } else if (quickInput.value.trim()) {
      closeQuick()
      openWikilink(quickInput.value)
    }
  } else if (event.key === 'Escape') {
    closeQuick()
  }
})

quick.addEventListener('mousedown', (event) => {
  if (event.target === quick) closeQuick()
})

/* Shortcuts */

interface AppCommand {
  section: 'File' | 'Edit' | 'View'
  title: string
  keys: string
  code: string
  shift?: boolean
  alt?: boolean
  anyShift?: boolean
  run: () => void
}

const appCommands: AppCommand[] = [
  { section: 'File', title: 'New Document', keys: '⌥⌘N', code: 'KeyN', alt: true, run: () => open(addDoc()) },
  { section: 'File', title: 'Quick Search', keys: '⌘O', code: 'KeyO', run: () => (quick.hidden ? openQuick() : closeQuick()) },
  { section: 'View', title: 'Show Library', keys: '⇧⌘L', code: 'KeyL', shift: true, run: () => update({ library: !settings.library }) },
  { section: 'View', title: 'Show Preview', keys: '⌘R', code: 'KeyR', run: () => update({ preview: !settings.preview }) },
  { section: 'View', title: 'Focus Mode', keys: '⌘D', code: 'KeyD', run: toggleFocus },
  { section: 'View', title: 'Typewriter Mode', keys: '⌥⌘T', code: 'KeyT', alt: true, run: () => update({ typewriter: !settings.typewriter }) },
  { section: 'View', title: 'Show Syntax', keys: '⇧⌘H', code: 'KeyH', shift: true, run: () => update({ syntax: toggleAll(settings.syntax) }) },
  { section: 'View', title: 'Style Check', keys: '⇧⌘K', code: 'KeyK', shift: true, run: () => update({ style: toggleAll(settings.style) }) },
  { section: 'View', title: 'Dark Appearance', keys: '⌥⌘D', code: 'KeyD', alt: true, run: () => update({ appearance: isDark() ? 'light' : 'dark' }) },
  { section: 'Edit', title: 'Paste as Reference', keys: '⌥⌘V', code: 'KeyV', alt: true, run: () => pasteClipboardAs(editor.view, REFERENCE) },
  { section: 'View', title: 'Make Text Bigger', keys: '⌘+', code: 'Equal', anyShift: true, run: () => resize(1) },
  { section: 'View', title: 'Make Text Smaller', keys: '⌘−', code: 'Minus', anyShift: true, run: () => resize(-1) },
  { section: 'View', title: 'Make Text Normal Size', keys: '⌘0', code: 'Digit0', run: () => resize(0) },
  { section: 'File', title: 'Download Markdown', keys: '⌘S', code: 'KeyS', run: downloadMarkdown },
  { section: 'File', title: 'Print or PDF', keys: '⌘P', code: 'KeyP', run: print },
  { section: 'View', title: 'Keyboard Shortcuts', keys: '⌘/', code: 'Slash', run: () => (sheet.open ? sheet.close() : showShortcuts()) },
]

window.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && menuMode) {
      closeMenu()
      return
    }
    if (!(event.metaKey || event.ctrlKey)) return
    const command = appCommands.find(
      (c) => c.code === event.code && event.altKey === !!c.alt && (c.anyShift || event.shiftKey === !!c.shift),
    )
    if (!command) return
    event.preventDefault()
    event.stopPropagation()
    command.run()
  },
  { capture: true },
)

/* Chrome */

let lastPointer = ''
editor.view.contentDOM.addEventListener('keydown', (event) => {
  if (!event.metaKey && !event.ctrlKey && event.key.length === 1) app.classList.add('typing')
})
window.addEventListener('mousemove', (event) => {
  const pointer = `${event.screenX},${event.screenY}`
  if (pointer !== lastPointer) app.classList.remove('typing')
  lastPointer = pointer
})

byId('toggle-library').addEventListener('click', () => update({ library: !settings.library }))
byId('toggle-preview').addEventListener('click', () => update({ preview: !settings.preview }))
byId('toggle-menu').addEventListener('click', () => showMenu(menuMode === 'view' ? null : 'view'))
byId('toggle-format').addEventListener('click', () => showMenu(menuMode === 'format' ? null : 'format'))
byId('toggle-format').addEventListener('mousedown', (event) => event.preventDefault())
menu.addEventListener('mousedown', (event) => {
  if (menuMode === 'format') event.preventDefault()
})
byId('new-doc').addEventListener('click', () => open(addDoc()))
librarySearch.addEventListener('input', renderLibrary)
stats.addEventListener('click', () => {
  update({ stat: statOrder[(statOrder.indexOf(settings.stat) + 1) % statOrder.length] })
})

document.addEventListener('mousedown', (event) => {
  const target = event.target as Node
  const onToggle = byId('toggle-menu').contains(target) || byId('toggle-format').contains(target)
  if (menuMode && !menu.contains(target) && !onToggle) closeMenu()
  if (narrow.matches && settings.library && !byId('library').contains(target) && !byId('toggle-library').contains(target)) {
    update({ library: false })
  }
})

editor.view.scrollDOM.addEventListener('scroll', () => {
  if (!settings.preview) return
  const source = editor.view.scrollDOM
  const ratio = source.scrollTop / Math.max(source.scrollHeight - source.clientHeight, 1)
  previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight)
})

fileInput.addEventListener('change', () => {
  if (fileInput.files) importFiles(fileInput.files)
  fileInput.value = ''
})

window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  app.classList.add('drop-target')
})
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) app.classList.remove('drop-target')
})
window.addEventListener('drop', (event) => {
  app.classList.remove('drop-target')
  if (!event.dataTransfer?.files.length) return
  event.preventDefault()
  importFiles(event.dataTransfer.files)
})

window.addEventListener('pagehide', () => flush())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
})
window.addEventListener('beforeunload', (event) => {
  flush()
  if (saveFailed) event.preventDefault()
})

if (narrow.matches) settings.library = false
applySettings()
open(current)
