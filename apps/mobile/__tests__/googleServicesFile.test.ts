/**
 * android.googleServicesFile must point at a file that exists, and must be
 * absent otherwise. A path to nothing fails prebuild; omitting it is what
 * lets today's Android builds, which have no Firebase file, keep working.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfigContext } from "expo/config";
import appConfig from "../app.config";
import { GoogleServicesFile } from "../googleServicesFile.js";

const LOCAL = "/app/google-services.json";
const EAS = "/eas/secrets/google-services.json";

describe("GoogleServicesFile.resolve", () => {
  it("returns undefined when neither the env path nor the local file exists", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: undefined,
        localPath: LOCAL,
        exists: () => false,
      }),
    ).toBeUndefined();
  });

  it("uses the EAS file env var when that path exists", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: EAS,
        localPath: LOCAL,
        exists: (filePath) => filePath === EAS,
      }),
    ).toBe(EAS);
  });

  it("prefers the env path over a local file when both exist", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: EAS,
        localPath: LOCAL,
        exists: () => true,
      }),
    ).toBe(EAS);
  });

  it("falls back to the gitignored local file when the env var is unset", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: undefined,
        localPath: LOCAL,
        exists: (filePath) => filePath === LOCAL,
      }),
    ).toBe(LOCAL);
  });

  it("ignores an env var that does not point at a real file and uses the local one", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: "/missing/google-services.json",
        localPath: LOCAL,
        exists: (filePath) => filePath === LOCAL,
      }),
    ).toBe(LOCAL);
  });

  it("treats a blank env var as unset", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: "   ",
        localPath: LOCAL,
        exists: (filePath) => filePath === LOCAL,
      }),
    ).toBe(LOCAL);
  });

  it("treats a blank env var with no local file as no config", () => {
    expect(
      GoogleServicesFile.resolve({
        envPath: "",
        localPath: LOCAL,
        exists: () => false,
      }),
    ).toBeUndefined();
  });

  it("joins the local filename onto the project root", () => {
    expect(GoogleServicesFile.localPath("/workspace/apps/mobile")).toBe(
      path.join("/workspace/apps/mobile", "google-services.json"),
    );
  });
});

describe("app config googleServicesFile", () => {
  const scratch: string[] = [];
  const previous = process.env.GOOGLE_SERVICES_JSON;

  afterEach(() => {
    if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = previous;
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function context(projectRoot: string): ConfigContext {
    return {
      projectRoot,
      staticConfigPath: null,
      packageJsonPath: null,
      config: { name: "Ludo", slug: "ludo", android: { package: "com.biszaal.mobile" } },
    };
  }

  it("leaves the static android config unchanged when no file is present", () => {
    delete process.env.GOOGLE_SERVICES_JSON;
    const ctx = context(path.join(tmpdir(), "ludo-no-google-services"));
    const result = appConfig(ctx);
    expect(result.android?.googleServicesFile).toBeUndefined();
    expect(result.android).toEqual({ package: "com.biszaal.mobile" });
  });

  it("points googleServicesFile at the EAS file when that path exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ludo-gs-"));
    scratch.push(dir);
    const file = path.join(dir, "google-services.json");
    writeFileSync(file, "{}\n");
    process.env.GOOGLE_SERVICES_JSON = file;

    const result = appConfig(context(path.join(tmpdir(), "ludo-project-without-a-local-copy")));
    expect(result.android?.googleServicesFile).toBe(file);
    expect(result.android?.package).toBe("com.biszaal.mobile");
  });
});
