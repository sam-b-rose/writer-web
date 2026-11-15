const bar = document.getElementById('progress')!
const app = document.getElementById('app')!

export const LARGE_DOCUMENT = 400_000

let depth = 0
let hideTimer = 0

function set(fraction?: number) {
  bar.classList.toggle('indeterminate', fraction === undefined)
  if (fraction !== undefined) {
    const value = Math.min(Math.max(fraction, 0), 1)
    bar.style.setProperty('--progress', String(value))
    bar.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  } else {
    bar.removeAttribute('aria-valuenow')
  }
}

export const progress = {
  start(fraction?: number) {
    depth++
    if (depth > 1) return
    clearTimeout(hideTimer)
    bar.classList.remove('done')
    bar.style.setProperty('--progress', '0')
    bar.hidden = false
    app.setAttribute('aria-busy', 'true')
    set(fraction)
  },
  set,
  done() {
    if (depth === 0 || --depth > 0) return
    set(1)
    bar.classList.add('done')
    app.removeAttribute('aria-busy')
    hideTimer = window.setTimeout(() => (bar.hidden = true), 450)
  },
}

export const afterPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
