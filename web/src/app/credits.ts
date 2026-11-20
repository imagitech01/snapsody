/*
 * The components Snapsody is built from and the licence each is shared under (openspec
 * `paper-and-ink-and-about` D7; the Credits and Licence screens read this list). It replaces the
 * credits of the instrument sounds alone (practice-app task 12.3, spec `instruments` "Recorded
 * instrument sounds": "the app SHALL credit each sound's source and licence").
 *
 * Names, licences and notices are kept as their authors wrote them, in English; they are legal text
 * and not part of the language catalogues. Only the group labels are texts (`credits.group.*`).
 * The list names the big parts, not their sub-libraries (design, "Credits list the big parts").
 * `test/credits.test.ts` keeps it true: every dependency in the build files is covered, every entry
 * has its licence file in `public/licences/` and is named in `NOTICE`.
 */

/** The sections of the Credits screen, in the order they are shown (D7). */
export const CREDIT_GROUPS = [
  'reading',
  'showing',
  'sounds',
  'models',
  'python',
  'app',
  'android',
  'scanning',
] as const

export type CreditGroup = (typeof CREDIT_GROUPS)[number]

export interface Credit {
  /** Also the name of the licence file, `public/licences/<id>.txt`, unless `licenceFile` says otherwise. */
  id: string
  name: string
  /** As the build files ask for it. Left out where one entry stands for many artifacts with their own versions. */
  version?: string
  /** The SPDX identifier, or the name of the terms when there is none. */
  licence: string
  source: string
  group: CreditGroup
  /** Lines the licence asks to be shown with the component, one each. */
  notices?: readonly string[]
  /** The component is proprietary (ML Kit): the screen must not call it free software. */
  notOpenSource?: boolean
  /** The licence file, when it is not `<id>.txt`: Apache-2.0 components without a NOTICE of their own share one text. */
  licenceFile?: string
  /**
   * The dependencies this entry stands for, with their exact versions, as `test/credits.test.ts` reads them
   * from `web/package.json` and the Gradle files: `npm:<package>@<version>`, `maven:<group>:<artifact>:<version>`,
   * `pip:<requirement>`, `project:<gradle project>` and `python:<version>`. A new or updated dependency fails
   * the test until it is listed here, and its version shown above is changed to match.
   */
  covers: readonly string[]
}

const APACHE = 'apache-2.0.txt'

/** The licence file of an entry. */
export const licenceFileOf = (credit: Credit): string => credit.licenceFile ?? `${credit.id}.txt`

/** The MuseScore_General acknowledgements and copyright lines: the SoundFont's licence asks for them in any derivative work. The same block is in `NOTICE` and `docs/samples.md`. */
const SOUNDFONT_ACKNOWLEDGEMENTS: readonly string[] = [
  'FluidR3 (original version) by Frank Wen Copyright (c) 2000-02',
  'Mono conversion (FluidR3Mono) by Michael Cowgill Copyright (c) 2014-17',
  'Adaptation for MuseScore_General.sf2 by S. Christian Collins Copyright (c) 2018-19',
  'Temple Blocks instrument provided by Ethan Winer Copyright (c) 2002',
  'Drumline Cymbals provided by Michael Schorsch Copyright (c) 2016',
]
const SOUNDFONT_COPYRIGHT: readonly string[] = [
  'Mono version: Copyright (c) 2014-16 Michael Cowgill',
  'Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>',
]

export const CREDITS: readonly Credit[] = [
  {
    id: 'homr',
    name: 'homr',
    version: '0.7.1',
    licence: 'AGPL-3.0',
    source: 'https://github.com/liebharc/homr',
    group: 'reading',
    notices: [
      "homr's model weights (segnet, transformer encoder and decoder, bundled as app assets) were partly trained on datasets with non-commercial terms (for example Camera-PrIMuS, CC BY-NC). This is fine for this free app, and must be reviewed before any commercial use.",
    ],
    covers: [],
  },
  {
    id: 'verovio',
    name: 'Verovio',
    version: '6.4.0',
    licence: 'LGPL-3.0',
    source: 'https://github.com/rism-digital/verovio',
    group: 'showing',
    // Task 4.2: the code compiled into the toolkit, read from its repository at version-6.4.0. The notices are in the licence text.
    notices: [
      'Includes pugixml, jsonxx, miniz-cpp, midifile, Tuning Library, CRC-32, base64 and libmei; their notices are in the licence text.',
    ],
    covers: ['npm:verovio@6.4.0'],
  },
  {
    id: 'leipzig',
    name: 'Leipzig',
    version: '5.2.102',
    licence: 'OFL-1.1',
    source: 'https://github.com/rism-digital/leipzig',
    group: 'showing',
    notices: ['The music font embedded in Verovio.'],
    covers: [],
  },
  {
    id: 'musescore-general',
    name: 'MuseScore_General',
    version: '0.2',
    licence: 'MIT',
    source: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/',
    group: 'sounds',
    notices: [...SOUNDFONT_ACKNOWLEDGEMENTS, ...SOUNDFONT_COPYRIGHT],
    covers: [],
  },
  {
    id: 'litert',
    name: 'LiteRT',
    version: '1.4.2',
    licence: 'Apache-2.0',
    source: 'https://github.com/google-ai-edge/LiteRT',
    group: 'models',
    licenceFile: APACHE,
    covers: [
      'maven:com.google.ai.edge.litert:litert:1.4.2',
      'maven:com.google.ai.edge.litert:litert-gpu:1.4.2',
      'maven:com.google.ai.edge.litert:litert-gpu-api:1.4.2',
    ],
  },
  {
    id: 'onnxruntime',
    name: 'ONNX Runtime',
    version: '1.31.1',
    licence: 'MIT',
    source: 'https://github.com/microsoft/onnxruntime',
    group: 'models',
    covers: ['maven:com.microsoft.onnxruntime:onnxruntime-android:1.31.1'],
  },
  {
    id: 'chaquopy',
    name: 'Chaquopy',
    version: '17.2.0',
    licence: 'MIT',
    source: 'https://github.com/chaquo/chaquopy',
    group: 'python',
    covers: ['maven:com.chaquo.python:gradle:17.2.0'],
  },
  {
    id: 'python',
    name: 'Python',
    version: '3.10',
    licence: 'PSF-2.0',
    source: 'https://www.python.org/',
    group: 'python',
    covers: ['python:3.10'],
  },
  {
    id: 'numpy',
    name: 'NumPy',
    version: '1.26.2',
    licence: 'BSD-3-Clause',
    source: 'https://github.com/numpy/numpy',
    group: 'python',
    covers: ['pip:numpy==1.26.2'],
  },
  {
    id: 'opencv',
    name: 'OpenCV',
    version: '4.5.1',
    licence: 'Apache-2.0',
    source: 'https://github.com/opencv/opencv',
    group: 'python',
    notices: ['Installed as opencv-python 4.5.1.48 (MIT, https://github.com/opencv/opencv-python); both licences are in the licence text.'],
    covers: ['pip:opencv-python==4.5.1.48'],
  },
  {
    id: 'pillow',
    name: 'Pillow',
    version: '11.0.0',
    licence: 'MIT-CMU',
    source: 'https://github.com/python-pillow/Pillow',
    group: 'python',
    covers: ['pip:pillow==11.0.0'],
  },
  {
    id: 'typing-extensions',
    name: 'typing_extensions',
    version: '4.16.0',
    licence: 'PSF-2.0',
    source: 'https://github.com/python/typing_extensions',
    group: 'python',
    covers: ['pip:typing_extensions==4.16.0'],
  },
  {
    id: 'preact',
    name: 'Preact',
    version: '11.1.1',
    licence: 'MIT',
    source: 'https://github.com/preactjs/preact',
    group: 'app',
    covers: ['npm:preact@11.1.1'],
  },
  {
    id: 'preact-signals',
    name: 'Preact Signals',
    version: '2.11.4',
    licence: 'MIT',
    source: 'https://github.com/preactjs/signals',
    group: 'app',
    notices: ['Includes signals-core 1.14.5.'],
    covers: ['npm:@preact/signals@2.11.4'],
  },
  {
    // One entry for the five packages, whose versions differ (design, "Versions in the credits are those in the build files").
    id: 'capacitor',
    name: 'Capacitor',
    version: '8.6.2',
    licence: 'MIT',
    source: 'https://github.com/ionic-team/capacitor',
    group: 'app',
    notices: ['Packages: core 8.6.2, android 8.6.2, App 8.1.2, Device 8.0.3, Filesystem 8.1.5.'],
    covers: [
      'npm:@capacitor/core@8.6.2',
      'npm:@capacitor/android@8.6.2',
      'npm:@capacitor/app@8.1.2',
      'npm:@capacitor/device@8.0.3',
      'npm:@capacitor/filesystem@8.1.5',
      'project:capacitor-android',
    ],
  },
  {
    id: 'capacitor-keep-awake',
    name: 'Capacitor Keep Awake',
    version: '8.0.1',
    licence: 'MIT',
    source: 'https://github.com/capacitor-community/keep-awake',
    group: 'app',
    covers: ['npm:@capacitor-community/keep-awake@8.0.1'],
  },
  {
    id: 'cordova-android',
    name: 'Apache Cordova Android',
    version: '14.0.1',
    licence: 'Apache-2.0',
    source: 'https://github.com/apache/cordova-android',
    group: 'app',
    covers: ['maven:org.apache.cordova:framework:14.0.1', 'project:capacitor-cordova-android-plugins'],
  },
  {
    id: 'public-sans',
    name: 'Public Sans',
    version: '2.001',
    licence: 'OFL-1.1',
    source: 'https://github.com/uswds/public-sans',
    group: 'app',
    covers: [],
  },
  {
    id: 'kotlin',
    name: 'Kotlin and kotlinx',
    version: '2.2.20',
    licence: 'Apache-2.0',
    source: 'https://kotlinlang.org/',
    group: 'android',
    notices: ['Includes the standard library and kotlinx coroutines 1.10.2.'],
    covers: ['maven:org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20'],
  },
  {
    // Many artifacts, each with its own version, so none is shown.
    id: 'androidx',
    name: 'AndroidX',
    licence: 'Apache-2.0',
    source: 'https://developer.android.com/jetpack/androidx',
    group: 'android',
    licenceFile: APACHE,
    covers: [
      'maven:androidx.appcompat:appcompat:1.7.1',
      'maven:androidx.coordinatorlayout:coordinatorlayout:1.3.0',
      'maven:androidx.core:core-splashscreen:1.2.0',
      'maven:androidx.core:core-ktx:1.17.0',
      'maven:androidx.activity:activity-ktx:1.11.0',
    ],
  },
  {
    id: 'guava-listenablefuture',
    name: 'Guava listenablefuture',
    version: '1.0',
    licence: 'Apache-2.0',
    source: 'https://github.com/google/guava',
    group: 'android',
    licenceFile: APACHE,
    covers: [],
  },
  {
    id: 'jetbrains-annotations',
    name: 'JetBrains annotations',
    version: '23.0.0',
    licence: 'Apache-2.0',
    source: 'https://github.com/JetBrains/java-annotations',
    group: 'android',
    covers: [],
  },
  {
    id: 'jspecify',
    name: 'JSpecify',
    version: '1.0.0',
    licence: 'Apache-2.0',
    source: 'https://github.com/jspecify/jspecify',
    group: 'android',
    licenceFile: APACHE,
    covers: [],
  },
  {
    id: 'mlkit-document-scanner',
    name: 'Google ML Kit Document Scanner',
    version: '16.0.0',
    licence: 'ML Kit Terms of Service',
    source: 'https://developers.google.com/ml-kit/terms',
    group: 'scanning',
    notOpenSource: true,
    covers: ['maven:com.google.android.gms:play-services-mlkit-document-scanner:16.0.0'],
  },
]

/** The entries of one section of the Credits screen. */
export interface CreditSection {
  group: CreditGroup
  credits: readonly Credit[]
}

/**
 * The entries for the Credits screen: the sections in the order of `CREDIT_GROUPS`, the entries of
 * each in list order. Every entry appears once; a group with no entry is left out.
 */
export function groupCredits(credits: readonly Credit[] = CREDITS): CreditSection[] {
  return CREDIT_GROUPS.map((group) => ({ group, credits: credits.filter((credit) => credit.group === group) })).filter(
    (section) => section.credits.length > 0,
  )
}

/** The entry with this id, for the Licence screen. */
export const findCredit = (id: string): Credit | undefined => CREDITS.find((credit) => credit.id === id)
