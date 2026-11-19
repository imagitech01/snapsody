/*
 * The two web pages Settings links to (openspec change add-privacy-policy, design D6; spec `app-shell`
 * "Privacy policy and source code"). They open in the phone's browser: the app itself has no internet
 * permission (design D4). The privacy policy is `docs/privacy/index.html`, hosted by ImagiTech; its URL
 * is repeated in `docs/store/listing.md` and in Play Console, so change them together.
 */

/** Snapsody's privacy policy, as entered in Play Console. */
export const PRIVACY_POLICY_URL = 'https://imagitech.be/snapsody/privacy/'

/** The source code, offered in the app because Snapsody is AGPL-3.0. */
export const SOURCE_CODE_URL = 'https://github.com/imagitech01/snapsody'
