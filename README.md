# Writer

A focused Markdown writing app modeled on iA Writer, built for the browser.

```sh
npm install
npm run dev
```

Pushes to `main` deploy to [writer.samrose.me](https://writer.samrose.me) via Cloudflare Workers Builds.

## Features

- **Library**: documents live in IndexedDB (migrated automatically from `localStorage`; falls back to it if IndexedDB is unavailable), and a visible warning appears if a save fails. Documents are sorted by date or name, searchable. Hashtags appear as chips under the search field, and a search can be saved as a smart folder. Drag in or open `.md`/`.txt` files.
- **Editor**: centered 64-character column, Markdown markup dimmed, heading `#` marks hang in the margin, thick blue caret. Wikilinks, hashtags, highlights, math and footnotes are coloured; ⌘-click follows links and wikilinks.
- **Format menu** (the Aa button): headings, lists, tasks, callouts, footnotes, dates, math, table of contents, page breaks, and table commands (add, move, align, sort, delete). Tab moves between table cells.
- **Focus Mode** (⌘D), **Typewriter Mode** (⌥⌘T), **Syntax** (⇧⌘H, via `compromise`), **Style Check** (⇧⌘K) with custom patterns.
- **Authors**: ⇧⌘V pastes text marked as AI; selections can be marked as Human, AI, Reference or a named author. Ranges are written to a footer in downloaded Markdown and read back on import, in the same format the macOS app uses.
- **Preview** (⌘R): six templates, KaTeX math, footnotes, callouts, table of contents, highlights, and content blocks (`/Title` embeds the document with that title).
- **Quick Search** (⌘O), stats (click to cycle), fonts, text size, appearance, keyboard shortcut list (⌘/).
- **Export**: Markdown (⌘S), standalone HTML, copy HTML, print or PDF (⌘P).

Fonts are the open-source iA Writer Mono, Duo and Quattro (SIL OFL 1.1) from `@fontsource`.
