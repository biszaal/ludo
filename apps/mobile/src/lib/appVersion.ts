/**
 * What this build calls itself.
 *
 * Read straight from app config, the same way SettingsScreen has always shown
 * it — expo-constants is not a direct dependency and this needs no native
 * module. One source so the string a player reads in Settings and the string
 * the server gates on can never drift apart.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const APP_VERSION: string = require("../../app.json").expo.version ?? "1.0.0";
