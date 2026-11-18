// The component gallery: every shared component of web/src/ui/components/ and the score island on one
// page, with fake state. It is only in the UI tests' build (test/ui/vite.config.ts) and under
// `npm run dev` at http://localhost:5173/dev/gallery.html: web/test/ui/harness.test.ts mounts each component
// here by role and accessible name, presses it and reads the log (the element with the name "Events") and the
// island's status. `?view=` picks a part: all (the default) or score (the island). The screens of the frames
// are the app's own (web/test/ui/*.test.ts); `make ui-review` shows those beside the frames, not this page.
//
// The texts are English and written here: the real screens take theirs from app/i18n, the components
// from props.

import { render } from 'preact'
import { useState } from 'preact/hooks'
import { signal } from '@preact/signals'
import type { PlaybackEvent } from '../src/core/playback/timeline.ts'
import type { Position } from '../src/core/playback/scheduler.ts'
import { parseMusicXml } from '../src/core/score/musicxml.ts'
import { indexScore } from '../src/core/score/noteMap.ts'
import {
  Button,
  Card,
  ConfirmDialog,
  Icon,
  IconButton,
  ListRow,
  SegmentedControl,
  Sheet,
  Stepper,
  TabBar,
  Toggle,
  ToggleRow,
} from '../src/ui/components/index.ts'
import type { IconName } from '../src/ui/components/index.ts'
import { ScoreIsland } from '../src/ui/ScoreIsland.tsx'
import exerciseXml from '../test/fixtures/practice-exercise.musicxml?raw'

// ---- The log -------------------------------------------------------------------------------------

const events = signal<string[]>([])
const log = (line: string): void => {
  events.value = [...events.value, line]
}

// ---- Tabs ----------------------------------------------------------------------------------------

type TabId = 'practice' | 'library' | 'settings'
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'practice', label: 'Practice', icon: 'play' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

// ---- The fake practice session of the island demo ----------------------------------------------------

const score = parseMusicXml(exerciseXml)
const index = indexScore(score)
const firstNoteOfBar: string[] = []
for (const [id, info] of index) if (!info.note.rest && firstNoteOfBar[info.barIndex] === undefined) firstNoteOfBar[info.barIndex] = id

const bar = signal(1)
const following = signal(true)
const shownBar = signal<number | null>(null)
const playing = signal(false)
const selected = signal<readonly string[]>([])
const scrolledAway = signal<number | null>(null)
const tapped = signal<string | null>(null)

/** The event of a note, one object per note, as the scheduler gives them (the cursor compares by identity). */
const eventObjects = new Map<string, PlaybackEvent>()
const eventOf = (noteId: string): PlaybackEvent => {
  let event = eventObjects.get(noteId)
  if (!event) {
    const info = index.get(noteId)!
    event = { noteIds: [noteId], barIndex: info.barIndex, bar: info.bar, rest: false } as unknown as PlaybackEvent
    eventObjects.set(noteId, event)
  }
  return event
}
let hearing: string | undefined
const heard = (): Position | undefined => (hearing ? { beat: 0, event: eventOf(hearing), finished: false } : undefined)

function hear(barNumber: number): void {
  hearing = firstNoteOfBar[barNumber - 1]
  bar.value = barNumber
  playing.value = true
}

function IslandDemo() {
  // A parent that renders again must not touch the island: the test presses this and checks that the drawing is the same node.
  const [renders, setRenders] = useState(0)
  // The island leaves the page and comes back: it must let go of the frame loop and the drawing.
  const [mounted, setMounted] = useState(true)
  return (
    <section class="gallery-section" aria-labelledby="island-title">
      <h2 id="island-title">Score island</h2>
      <div class="gallery-row">
        <Button variant="secondary" size="small" onPress={() => hear(2)}>
          Hear bar 2
        </Button>
        <Button variant="secondary" size="small" onPress={() => hear(15)}>
          Hear bar 15
        </Button>
        <Button variant="secondary" size="small" onPress={() => hear(18)}>
          Hear bar 18
        </Button>
        <Button
          variant="secondary"
          size="small"
          onPress={() => {
            playing.value = false
            hearing = undefined
          }}
        >
          Pause
        </Button>
        <Button
          variant="secondary"
          size="small"
          onPress={() => {
            following.value = true
            shownBar.value = null
            scrolledAway.value = null
          }}
        >
          Return to playing
        </Button>
        <Button
          variant="secondary"
          size="small"
          onPress={() => {
            following.value = false
            shownBar.value = 12
          }}
        >
          Go to bar 12
        </Button>
        <Button variant="secondary" size="small" onPress={() => (selected.value = [firstNoteOfBar[3]!])}>
          Select a note
        </Button>
        <Button variant="secondary" size="small" onPress={() => setRenders(renders + 1)}>
          Render again ({renders})
        </Button>
        <Button variant="secondary" size="small" onPress={() => setMounted(!mounted)}>
          {mounted ? 'Remove the score' : 'Show the score'}
        </Button>
      </div>
      <p class="t-caption" role="status" aria-label="Island">
        {`following ${following.value ? 'on' : 'off'} · showing ${shownBar.value ?? 'none'} · scrolled away ${scrolledAway.value ?? 'none'} · tapped ${tapped.value ?? 'none'}`}
      </p>
      <div class="gallery-island">
        {mounted ? (
          <ScoreIsland
            label="Score"
            score={score}
            bar={bar}
            following={following}
            shownBar={shownBar}
            playing={playing}
            selected={selected}
            heard={heard}
            onScrollAway={(n) => {
              scrolledAway.value = n
              shownBar.value = n
              following.value = false
            }}
            onTapNote={(id) => {
              tapped.value = id
              const info = index.get(id)
              if (info) bar.value = info.barIndex + 1
            }}
          />
        ) : null}
      </div>
    </section>
  )
}

// ---- The components ---------------------------------------------------------------------------------

function Swatch({ name }: { name: string }) {
  return (
    <li class="swatch">
      <span class="swatch-chip" style={{ background: `var(${name})` }} />
      <code>{name}</code>
    </li>
  )
}

const COLOURS = [
  '--bg',
  '--surface',
  '--surface-muted',
  '--surface-dark',
  '--ink',
  '--ink-muted',
  '--primary',
  '--primary-tint',
  '--line',
  '--line-strong',
  '--danger',
  '--danger-tint',
]
const TYPE = [
  ['--fs-30', 'Screen title'],
  ['--fs-24', 'Sheet title'],
  ['--fs-19', 'Section'],
  ['--fs-15', 'Row title'],
  ['--fs-13', 'Subtitle'],
  ['--fs-11', 'Caption'],
] as const

function Tokens() {
  return (
    <section class="gallery-section" aria-labelledby="tokens-title">
      <h2 id="tokens-title">Tokens</h2>
      <ul class="swatches">
        {COLOURS.map((name) => (
          <Swatch key={name} name={name} />
        ))}
      </ul>
      <div class="type-samples">
        {TYPE.map(([token, text]) => (
          <p key={token} style={{ fontSize: `var(${token})`, fontWeight: 'var(--fw-semibold)' }}>
            {text} <code>{token}</code>
          </p>
        ))}
      </div>
    </section>
  )
}

function Components() {
  const [tab, setTab] = useState<TabId>('practice')
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState<'plain' | 'destructive' | null>(null)
  const [tempo, setTempo] = useState(60)
  const [pitch, setPitch] = useState(0)
  const [favorite, setFavorite] = useState(true)
  const [follow, setFollow] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [rest, setRest] = useState<'off' | 'one' | 'two'>('off')
  const [mode, setMode] = useState<'note' | 'marks' | 'score'>('note')
  const [instrument, setInstrument] = useState('piano')
  const [starred, setStarred] = useState(false)
  const pitchNames = ['E5', 'F5', 'F♯5', 'G5']
  return (
    <>
      <section class="gallery-section" aria-labelledby="buttons-title">
        <h2 id="buttons-title">Buttons</h2>
        <div class="gallery-row">
          <Button onPress={() => log('primary')}>Start looping bars 2–3</Button>
          <Button variant="primary" icon="camera" onPress={() => log('add music')}>
            Add music
          </Button>
          <Button variant="secondary" onPress={() => log('secondary')}>
            + Add music
          </Button>
          <Button variant="danger" onPress={() => log('danger')}>
            Delete note
          </Button>
          <Button variant="link" onPress={() => log('link')}>
            See all
          </Button>
          <Button disabled onPress={() => log('disabled')}>
            Not now
          </Button>
        </div>
        <div class="gallery-row">
          <IconButton label="Back" icon="back" onPress={() => log('back')} />
          <IconButton label="More tools" icon="more" onPress={() => log('more')} />
          <IconButton label="Restart" icon="restart" onPress={() => log('restart')} />
          <IconButton label="Pause" icon="pause" look="accent" onPress={() => log('pause')} />
          <IconButton
            label="Favorite"
            icon="star"
            look="plain"
            pressed={starred}
            onPress={() => {
              setStarred(!starred)
              log(`favorite ${starred ? 'off' : 'on'}`)
            }}
          />
        </div>
        <div class="gallery-row gallery-icons">
          {(['play', 'pause', 'restart', 'loop', 'metronome', 'library', 'settings', 'back', 'more', 'search', 'star', 'camera', 'chevron-right', 'chevron-down'] as IconName[]).map(
            (name) => (
              <span key={name} title={name}>
                <Icon name={name} />
              </span>
            ),
          )}
        </div>
      </section>

      <section class="gallery-section" aria-labelledby="cards-title">
        <h2 id="cards-title">Cards</h2>
        <div class="gallery-stack">
          <Card tone="dark" label="Dark card">
            <p>Ode to Joy</p>
          </Card>
          <Card>
            <p>A white card</p>
          </Card>
          <Card tone="muted">
            <p>Your starting sound for practice</p>
          </Card>
        </div>
      </section>

      <section class="gallery-section" aria-labelledby="tabs-title">
        <h2 id="tabs-title">Tab bar</h2>
        <TabBar label="Main" tabs={TABS} current={tab} onSelect={(id) => (setTab(id), log(`tab ${id}`))} />
      </section>

      <section class="gallery-section" aria-labelledby="controls-title">
        <h2 id="controls-title">Steppers, toggles and segments</h2>
        <div class="gallery-stack">
          <Stepper
            label="Tempo"
            value={String(tempo)}
            unit="BPM"
            decrementLabel="Slower"
            incrementLabel="Faster"
            decrementDisabled={tempo <= 30}
            onDecrement={() => setTempo(tempo - 5)}
            onIncrement={() => setTempo(tempo + 5)}
          />
          <Stepper
            size="compact"
            label="Pitch"
            value={pitchNames[pitch]!}
            decrementLabel="Semitone down"
            incrementLabel="Semitone up"
            decrementDisabled={pitch === 0}
            incrementDisabled={pitch === pitchNames.length - 1}
            onDecrement={() => setPitch(pitch - 1)}
            onIncrement={() => setPitch(pitch + 1)}
          />
          <Toggle
            label="Metronome"
            checked={metronome}
            onChange={(next) => {
              setMetronome(next)
              log(`metronome ${next ? 'on' : 'off'}`)
            }}
          />
          <SegmentedControl
            label="Rest between repeats"
            options={[
              { value: 'off', label: 'Off' },
              { value: 'one', label: '1 bar' },
              { value: 'two', label: '2 bars' },
            ]}
            value={rest}
            onChange={(value) => {
              setRest(value)
              log(`rest ${value}`)
            }}
          />
          <SegmentedControl
            look="track"
            label="Editing mode"
            options={[
              { value: 'note', label: 'Note' },
              { value: 'marks', label: 'Marks' },
              { value: 'score', label: 'Score' },
            ]}
            value={mode}
            onChange={(value) => {
              setMode(value)
              log(`mode ${value}`)
            }}
          />
        </div>
      </section>

      <section class="gallery-section" aria-labelledby="rows-title">
        <h2 id="rows-title">List rows</h2>
        <div class="gallery-stack">
          <ListRow title="Go to music" subtitle="Jump to a bar or page" chevron onPress={() => log('go to music')} />
          <ToggleRow
            title="Favorite"
            description="Keep in your practice rotation"
            checked={favorite}
            onChange={(next) => {
              setFavorite(next)
              log(`favorite row ${next ? 'on' : 'off'}`)
            }}
          />
          <ToggleRow
            title="Follow playback"
            description="Keep the playing bar in view"
            checked={follow}
            onChange={(next) => {
              setFollow(next)
              log(`follow ${next ? 'on' : 'off'}`)
            }}
          />
          <div role="radiogroup" aria-label="Default instrument" class="gallery-stack">
            {[
              ['piano', 'Piano', 'Concert pitch · Grand piano'],
              ['guitar', 'Guitar', 'Written pitch · Nylon strings'],
            ].map(([id, title, subtitle]) => (
              <ListRow
                key={id}
                size="compact"
                title={title!}
                subtitle={subtitle!}
                selected={instrument === id}
                onPress={() => {
                  setInstrument(id!)
                  log(`instrument ${id}`)
                }}
              />
            ))}
          </div>
          <ListRow
            size="compact"
            title="Ode to Joy"
            subtitle="3 pages · 12 bars · Scanned today"
            leading={<span class="gallery-thumb" aria-hidden="true" />}
            onPress={() => log('open Ode to Joy')}
            trailing={
              <IconButton
                label="Remove Ode to Joy from favorites"
                icon="star"
                look="plain"
                pressed
                onPress={() => log('unfavorite Ode to Joy')}
              />
            }
          />
        </div>
      </section>

      <section class="gallery-section" aria-labelledby="layers-title">
        <h2 id="layers-title">Sheet and dialog</h2>
        <div class="gallery-row">
          <Button variant="secondary" onPress={() => setSheet(true)}>
            Open the sheet
          </Button>
          <Button variant="secondary" onPress={() => setDialog('plain')}>
            Ask a question
          </Button>
          <Button variant="secondary" onPress={() => setDialog('destructive')}>
            Delete a piece
          </Button>
        </div>
      </section>

      {sheet ? (
        <Sheet
          title="Practice tools"
          subtitle="Everything else, only when you need it."
          closeLabel="Close"
          onClose={() => {
            setSheet(false)
            log('sheet closed')
          }}
        >
          <div class="gallery-stack">
            <ListRow title="Instrument" subtitle="Piano · Global default" chevron onPress={() => log('instrument tool')} />
            <ToggleRow title="Follow playback" description="Keep the playing bar in view" checked={follow} onChange={setFollow} />
          </div>
        </Sheet>
      ) : null}
      {dialog ? (
        <ConfirmDialog
          title={dialog === 'plain' ? 'Leave without saving?' : 'Delete Ode to Joy?'}
          message={dialog === 'plain' ? 'Your changes to the score are not saved yet.' : 'The piece and its practice settings are removed.'}
          confirmLabel={dialog === 'plain' ? 'Leave' : 'Delete'}
          cancelLabel="Keep"
          destructive={dialog === 'destructive'}
          onAnswer={(accepted) => {
            log(`dialog ${accepted ? 'confirmed' : 'cancelled'}`)
            setDialog(null)
          }}
        />
      ) : null}
    </>
  )
}

function Gallery() {
  const view = new URLSearchParams(location.search).get('view') ?? 'all'
  if (view === 'score') {
    return (
      <main class="gallery gallery--wide">
        <IslandDemo />
      </main>
    )
  }
  return (
    <main class="gallery">
      <h1>Snapsody component gallery</h1>
      <p class="t-caption" role="log" aria-label="Events">
        {events.value.join(' | ')}
      </p>
      <Tokens />
      <Components />
      <IslandDemo />
    </main>
  )
}

render(<Gallery />, document.getElementById('gallery')!)
