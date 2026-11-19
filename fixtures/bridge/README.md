# Plugin contract

The calls and events between the web layer's Capacitor adapter (`web/src/platform/capacitor/`)
and our three local Capacitor plugins (`android/app/src/main/java/be/imagitech/snapsody/`), as one
committed example per call and event (openspec practice-app, design D15):

| Plugin | JS name | Calls | Events |
|---|---|---|---|
| Scanner (`scanner/ScannerPlugin.kt`) | `Scanner` | `scan` | — |
| Reader (`reader/ReaderPlugin.kt`) | `Reader` | `read`, `cancel` | `readerEvent` |
| AtomicFiles (`files/AtomicFilesPlugin.kt`) | `AtomicFiles` | `writeTextAtomic`, `moveFile` | — |

Each plugin is a plain handler class (`ScannerHandler`, `ReaderHandler`, `AtomicFiles`) behind a
thin Capacitor adapter, so the handler runs on the JVM. Three checks use these files, all in the
quick layer:

- **Kotlin:** `android/app/src/test/java/be/imagitech/snapsody/{scanner,reader,files}/*Test.kt` run each
  handler on the example requests. The replies and events must have the example's shape, and the
  error examples must be rejected with their code. The shape check is `Contract.kt`.
- **Fake platform:** `web/test/pluginContract.test.ts` checks that the examples are well formed and
  cover every call and every `ReaderEvent` type. It also checks that the fake scanner's results and
  the fake reader's events have the examples' shapes.
- **Capacitor adapter:** `web/test/capacitorAdapter.test.ts` feeds the example replies, events and
  error codes through the adapter (over mock plugins) and checks what reaches the port.

The Capacitor npm plugins (Filesystem, App, Device, KeepAwake) have no examples here. Their
behaviour on Android is reproduced in `web/test/capacitorMocks.ts`.

A new plugin call or event comes with its example in the same change (`openspec/config.yaml`).

## Files

`<plugin>.<method>.json`, one per call (the plugin name with a lower-case first letter):

| Field | Meaning |
|---|---|
| `plugin` | the plugin's JS name |
| `method` | the call |
| `description` | what it does |
| `request` | an example of the options object |
| `reply` | an example of what it resolves with, or `replies`: a list of alternatives, one of which must match |
| `errors` | optional: `[{code, request?, description}]`. Each entry is a rejection with one of the port's error codes (`unavailable`, `not-found`, `exists`, `invalid`, `failed`). `request` is a request that gets it; an entry without one is a state, such as another job still running. |
| `shape` | optional notes for the shape check (below) |

`<plugin>.<type>.json`, one per event type (`reader.progress`, `reader.done`, `reader.no-music`,
`reader.failed`, `reader.finished`):

| Field | Meaning |
|---|---|
| `plugin` | the plugin's JS name |
| `event` | the Capacitor event name (`readerEvent`) |
| `description`, `payload`, `shape` | as above |

The Reader's event payloads are the port's `ReaderEvent` (`web/src/platform/port.ts`) plus `jobId`,
which is on the wire only. It is marked optional, so the fake's events (without it) match too, and
the adapter strips it.
`reader.done`'s `staves` and `timeEstimated` (design D7) are optional too: the Reader sends them
only when the engine knows them, and the adapter drops `staves` that are not well formed.

## Paths

Paths in requests and replies are relative to the app's data folder (Android `filesDir`, Capacitor's
`Directory.Data`): `scans/<id>/page-<n>.jpg`, `pieces/<id>/piece.json`. The Scanner returns its
pages as such paths. The adapter also accepts a scanned page's absolute path inside that folder
where a file is read and in `remove`, and sends the Reader the relative form.

## Shape check

Values are compared by shape, not by value. Two values match when they have the same keys, the same
JSON types (string, number, boolean, object, array, null) and only the listed enum values. Array
elements are compared with the example's first element; an empty example array accepts any
elements. `shape` names paths like `payload.stage` or `reply.pages[].path` (the roots are `request`,
`reply` and `payload`) in these lists:

- `optional`: the key may be missing;
- `nullable`: the value may also be `null`;
- `enum`: the allowed values;
- `any`: any value, not checked further.
