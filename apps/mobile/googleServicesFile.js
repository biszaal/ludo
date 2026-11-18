const path = require("node:path");

/**
 * Where prebuild should read google-services.json from.
 *
 * EAS turns a file environment variable into a path on the builder
 * (`GOOGLE_SERVICES_JSON=/path/to/the/uploaded/file` — Expo's documented name
 * for this file). A checkout with the gitignored copy next to app.json is the
 * local fallback for `expo run:android`.
 *
 * Either path has to exist before it is written into the config. Naming a
 * missing file fails the Android prebuild, and a build that has no Firebase
 * file yet — every build today — has to keep compiling.
 *
 * Plain CommonJS on purpose: Expo evaluates app.config.ts with require(), and
 * that require does not load a neighbouring TypeScript file.
 */
class GoogleServicesFile {
  /** Filename Firebase and Expo both expect, beside app.json. */
  static FILENAME = "google-services.json";

  /** Env var EAS sets to the absolute path of an uploaded file variable. */
  static ENV = "GOOGLE_SERVICES_JSON";

  /** @param {string} projectRoot */
  static localPath(projectRoot) {
    return path.join(projectRoot, GoogleServicesFile.FILENAME);
  }

  /**
   * The path for `android.googleServicesFile`, or undefined so the config is
   * left exactly as app.json has it.
   *
   * The env path wins when it points at a real file (that is the EAS build).
   * A blank or dangling env var is ignored, and the gitignored local file is
   * used only when it is actually on disk.
   *
   * @param {{
   *   envPath: string | undefined;
   *   localPath: string;
   *   exists: (filePath: string) => boolean;
   * }} input
   * @returns {string | undefined}
   */
  static resolve(input) {
    const fromEnv = input.envPath?.trim() ?? "";
    if (fromEnv && input.exists(fromEnv)) return fromEnv;
    if (input.exists(input.localPath)) return input.localPath;
    return undefined;
  }
}

module.exports = { GoogleServicesFile };
