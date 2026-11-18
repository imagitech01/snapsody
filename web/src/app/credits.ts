/*
 * The credits of the instrument sounds (practice-app task 12.3; spec `instruments` "Recorded
 * instrument sounds": "the app SHALL credit each sound's source and licence"). The text is the
 * SoundFont's own licence acknowledgements, which its licence asks to be included in any derivative
 * work. It is the same block as `NOTICE` and `docs/samples.md` and is legal text, so it is kept as it
 * is, in English, and is not part of the language catalogues.
 */

export interface SoundCredit {
  /** The SoundFont the samples were made from. */
  name: string
  /** The licence the SoundFont is shared under. */
  licence: string
  /** Where it comes from. */
  source: string
  /** The acknowledgements, one line each, as the licence gives them. */
  acknowledgements: readonly string[]
  /** The copyright lines of the licence's COPYING block. */
  copyright: readonly string[]
}

export const SOUND_CREDITS: SoundCredit = {
  name: 'MuseScore_General 0.2',
  licence: 'MIT License',
  source: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/',
  acknowledgements: [
    'FluidR3 (original version) by Frank Wen Copyright (c) 2000-02',
    'Mono conversion (FluidR3Mono) by Michael Cowgill Copyright (c) 2014-17',
    'Adaptation for MuseScore_General.sf2 by S. Christian Collins Copyright (c) 2018-19',
    'Temple Blocks instrument provided by Ethan Winer Copyright (c) 2002',
    'Drumline Cymbals provided by Michael Schorsch Copyright (c) 2016',
  ],
  copyright: ['Mono version: Copyright (c) 2014-16 Michael Cowgill', 'Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>'],
}
