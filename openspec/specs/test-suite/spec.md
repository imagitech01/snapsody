# test-suite Specification

## Purpose

Keeps development fast and changes safe. Behaviour is proven by tests on the development Mac that run in seconds to minutes. An Android device, normally the emulator, is used once per change for an end-to-end smoke test.

## Requirements

### Requirement: Three test layers, one command each
The project SHALL provide three test layers, each started by one command from the repository root:
- **quick:** unit tests;
- **mac:** the quick layer plus UI tests in a desktop browser;
- **device:** the end-to-end smoke test on the Android emulator, or on a connected phone when asked.

Each command SHALL exit non-zero when any test in it fails, and SHALL name the failing test.

#### Scenario: A failing test fails the command
- **WHEN** any test in a layer fails
- **THEN** that layer's command exits non-zero and names the failing test

### Requirement: Quick layer is fast and needs nothing external
The quick layer SHALL finish in 30 seconds or less on the development Mac, with the build tools warm. It SHALL NOT need:
- a phone or emulator;
- network access;
- the recognition model files;
- anything in the git-ignored local fixtures.

#### Scenario: Warm quick run
- **WHEN** the quick command runs a second time with no source changes
- **THEN** it completes within 30 seconds

#### Scenario: Models not built
- **WHEN** the packaged recognition models are absent
- **THEN** the quick layer still runs and passes

### Requirement: Logic is proven by unit tests
Score, editing, playback and practice logic SHALL be tested in the quick layer, not through the UI. Examples are transposition, marks, combining pages, loops and speed. Screens SHALL hold no logic that only a UI test can reach.

#### Scenario: A new playback rule
- **WHEN** a change adds a rest of one bar between loop repeats
- **THEN** a quick-layer test proves the timing, and no UI test is needed for it

### Requirement: Mac layer proves the user flows without the phone
The mac layer SHALL run the built web app in a desktop headless browser. It SHALL use a fake platform (page scanner, music reader and file storage) and committed scores instead of a recognition run. It SHALL have one journey test per main user flow, which checks that the flow works end to end. It SHALL NOT assert layout or pixels. It SHALL finish in 3 minutes or less, warm.

#### Scenario: Screen redesigned
- **WHEN** a change redesigns a screen
- **THEN** that change updates the screen's journey test, and the other journey tests are unaffected

#### Scenario: Editing without the phone
- **WHEN** the mac layer opens a committed piece, steps a note's pitch down and saves
- **THEN** the test sees the note change in the rendered score and in the stored piece, while the original reading is unchanged

#### Scenario: Recognition outcomes without a recognition run
- **WHEN** the fake reader sends scripted progress for page 1 of 2, then a "no music found" failure for page 2
- **THEN** the test sees the progress advance without moving backwards, then the message that page 2 has no music, with the action to scan again

### Requirement: Fake bridge matches the real bridge
The calls, replies and events between the web layer and the native plugins SHALL be described by one committed set of examples. Both the web tests' fake platform and the Android plugin handlers (in a JVM unit test) SHALL be checked against these examples. A plugin call or event that the web layer uses and the examples do not cover SHALL fail the quick layer.

#### Scenario: Handler reply changes shape
- **WHEN** an Android plugin handler's reply for a call no longer matches the committed example
- **THEN** the quick layer fails, naming that call

#### Scenario: New message type without an example
- **WHEN** the web layer starts making a plugin call that has no committed example
- **THEN** the quick layer fails

### Requirement: One device test, before archive
The device layer SHALL be one end-to-end smoke test, run before a change is archived. It goes from a page image through reading to a saved piece, then renders it, plays it, and reopens it after a restart. Models, accelerators and recognition quality SHALL NOT be re-tested. A change that alters them SHALL bring its own checks.

#### Scenario: Smoke test before archive
- **WHEN** a change is ready to archive and the device command runs with no phone connected
- **THEN** the emulator starts, a page image becomes a saved piece that renders, plays, and survives an app restart, and the emulator stops

### Requirement: Device layer runs on the emulator by default
The device command SHALL run the smoke test on an Android emulator that it starts and stops itself, so no phone has to be connected. A connected phone SHALL be used only when asked. The smoke test SHALL NOT depend on GPU acceleration.

#### Scenario: Smoke test on the phone
- **WHEN** the device command is asked to use the connected S24
- **THEN** the same smoke test runs on the phone

### Requirement: Screens can be compared with the design
The project SHALL provide one command that shows each screen reached in the journey tests next to its Figma reference frame, together with the deviations recorded for that frame. The comparison SHALL be for review by eye only. It SHALL never fail a test layer.

#### Scenario: Reviewing a redesigned screen
- **WHEN** a change has implemented the practice screen and the review command runs
- **THEN** the app's practice screen is shown beside the "02.1 · Play along — Portrait" frame, with an overlay toggle and the recorded deviations

#### Scenario: A screen differs from Figma
- **WHEN** the app's screen differs from its frame
- **THEN** no test fails, and the difference is either fixed or recorded with its reason

### Requirement: Bundled sound files are checked off the phone
The mac layer SHALL decode every bundled instrument sample file in the desktop browser, and SHALL fail when a file is missing from its map or does not decode.

#### Scenario: Broken sample file
- **WHEN** a new instrument's sample set contains a file that does not decode
- **THEN** the mac layer fails, naming the file

### Requirement: Stored exercises stay readable
The quick layer SHALL load a committed piece folder in every storage format the app has written since the change that introduced pieces, and SHALL fail when the current code cannot open one.

#### Scenario: Storage format changes
- **WHEN** a change alters the stored piece format
- **THEN** the committed piece folders of the earlier formats still load, with their pages, score, photos and practice settings

### Requirement: Lower layers use committed fixtures only
The quick and mac layers SHALL pass using only committed, self-made test material. A test that uses local copyrighted fixtures SHALL skip with a message when they are absent. Such a test SHALL NOT be the only test of a behaviour.

#### Scenario: Fresh checkout without local fixtures
- **WHEN** the local fixtures folder does not exist
- **THEN** the quick and mac layers pass, and each skipped test prints why it skipped

### Requirement: Lower layers are deterministic
The quick and mac layers SHALL NOT depend on wall-clock timing, test order, or leftover state from earlier runs. Behaviour that depends on time SHALL be tested with a controlled clock or scripted events.

#### Scenario: Repeated runs
- **WHEN** the mac layer runs ten times in a row with no source changes
- **THEN** every run gives the same result
