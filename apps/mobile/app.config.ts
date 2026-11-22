import { existsSync } from "node:fs";
import type { ConfigContext, ExpoConfig } from "expo/config";
import { GoogleServicesFile } from "./googleServicesFile.js";

/**
 * app.json stays the static config (version, plugins, package). This only adds
 * `android.googleServicesFile` when a real google-services.json is present:
 * the EAS file env var `GOOGLE_SERVICES_JSON`, or a gitignored local copy.
 *
 * With neither, the object returned is the static config unchanged, so an
 * Android build without the Firebase file still configures the way it does today.
 * The returned object is the same one Expo passed in — spreading into a new
 * object drops the marker Expo uses to tell that the static config was applied.
 */
export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  const googleServicesFile = GoogleServicesFile.resolve({
    envPath: process.env[GoogleServicesFile.ENV],
    localPath: GoogleServicesFile.localPath(projectRoot),
    exists: existsSync,
  });
  if (googleServicesFile) {
    config.android = { ...config.android, googleServicesFile };
  }
  return config as ExpoConfig;
};
