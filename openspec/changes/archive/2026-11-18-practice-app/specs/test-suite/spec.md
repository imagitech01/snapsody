# Spec Delta

## MODIFIED Requirements

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

### Requirement: Stored exercises stay readable
The quick layer SHALL load a committed piece folder in every storage format the app has written since the change that introduced pieces, and SHALL fail when the current code cannot open one.

#### Scenario: Storage format changes
- **WHEN** a change alters the stored piece format
- **THEN** the committed piece folders of the earlier formats still load, with their pages, score, photos and practice settings
