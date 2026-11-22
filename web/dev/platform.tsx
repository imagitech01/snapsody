// A page for `npm run dev` only (never part of the build): it drives the browser-dev platform the
// way the add-music flow will. Scan pages with the file dialog, keep them with a piece-like
// folder, read them, and see what was stored, which stays after a reload (IndexedDB).
// Open it at http://localhost:5173/dev/platform.html (docs/testing.md).

import { render } from 'preact'
import { signal } from '@preact/signals'
import { createBrowserDevPlatform } from '../src/platform/browserDev/index.ts'
import type { ReaderEvent, ReaderJob } from '../src/platform/port.ts'

const platform = await createBrowserDevPlatform()
const { files, scanner, reader } = platform

const FOLDER = 'dev-check'

interface Shown {
  path: string
  url: string
  width: number
  height: number
}

const pages = signal<Shown[]>([])
const events = signal<string[]>([])
const stored = signal<string[]>([])
const message = signal('')
let job: ReaderJob | undefined

async function listAll(folder: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await files.list(folder)) {
    const path = `${folder}/${entry.name}`
    if (entry.kind === 'folder') found.push(...(await listAll(path)))
    else found.push(path)
  }
  return found
}

async function refresh(): Promise<void> {
  stored.value = await listAll(FOLDER)
}

async function scan(): Promise<void> {
  message.value = ''
  try {
    const result = await scanner.scan({ maxPages: 10 })
    if (result.cancelled) {
      message.value = 'Scan cancelled'
      return
    }
    await files.remove(FOLDER)
    const shown: Shown[] = []
    for (const [index, page] of result.pages.entries()) {
      const kept = `${FOLDER}/pages/${index + 1}/source.jpg`
      await files.copy(page.path, kept)
      shown.push({ path: kept, url: await files.imageUrl(kept), width: page.width, height: page.height })
    }
    pages.value = shown
    events.value = []
    message.value = `Scanned ${shown.length} page${shown.length === 1 ? '' : 's'}`
  } catch (error) {
    message.value = `Scan failed: ${error instanceof Error ? error.message : String(error)}`
  }
  await refresh()
}

function read(): void {
  events.value = []
  job = reader.read(
    pages.value.map((p) => p.path),
    (event: ReaderEvent) => {
      events.value = [...events.value, describe(event)]
      if (event.type === 'done') {
        void files.writeTextAtomic(`${FOLDER}/pages/${event.page + 1}/recognised.musicxml`, event.musicxml).then(refresh)
      }
    },
  )
}

function describe(event: ReaderEvent): string {
  switch (event.type) {
    case 'progress':
      return `page ${event.page + 1}/${event.pages}: ${event.stage} ${Math.round(event.fraction * 100)}%`
    case 'done':
      return `page ${event.page + 1}/${event.pages}: done, ${event.musicxml.length} characters of MusicXML`
    case 'no-music':
      return `page ${event.page + 1}/${event.pages}: no music`
    case 'failed':
      return `page ${event.page + 1}/${event.pages}: failed, ${event.message}`
    case 'finished':
      return `finished: ${event.status}`
  }
}

async function clear(): Promise<void> {
  await files.remove(FOLDER)
  pages.value = []
  events.value = []
  message.value = 'Cleared'
  await refresh()
}

function Check() {
  return (
    <main>
      <h1>Platform check (browser-dev)</h1>
      <p>
        <button type="button" onClick={() => void scan()}>Scan pages</button>
        <button type="button" onClick={read} disabled={pages.value.length === 0}>Read pages</button>
        <button type="button" onClick={() => void job?.cancel()}>Cancel reading</button>
        <button type="button" onClick={() => void clear()}>Clear</button>
      </p>
      <p role="status">{message.value}</p>
      <h2>Pages</h2>
      <div class="pages">
        {pages.value.map((page) => (
          <img key={page.path} src={page.url} alt={`Scanned page ${page.path} (${page.width} by ${page.height})`} />
        ))}
      </div>
      <h2>Reading</h2>
      <ol aria-label="Reader events">
        {events.value.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ol>
      <h2>Stored</h2>
      <ul aria-label="Stored files">
        {stored.value.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
    </main>
  )
}

render(<Check />, document.getElementById('check')!)
void refresh()
