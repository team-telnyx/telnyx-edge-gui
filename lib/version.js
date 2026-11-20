import fs from 'node:fs';

/** The app version, read from package.json so it always matches the release. */
export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const USER_AGENT = `telnyx-edge-gui/${VERSION}`;
