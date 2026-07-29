/**
 * Raise every CocoaPods target's iOS deployment target to the app's minimum.
 *
 * Xcode 27 refuses to build any target below iOS 15, and several pods still
 * ship resource-bundle targets pinned to 12.0/13.4 in their podspecs —
 * Google-Mobile-Ads-SDK, GoogleUserMessagingPlatform and RNCAsyncStorage all do.
 * CocoaPods honours each podspec's own minimum, so setting `platform :ios` (what
 * expo-build-properties does) is not enough to lift them.
 *
 * The fix is the standard post_install sweep. It lives in a config plugin rather
 * than in ios/Podfile because ios/ is CNG-generated and gitignored — a hand-edit
 * there vanishes on the next `expo prebuild`.
 */

const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# ludo: raise pod deployment targets";

/** @param {import('expo/config').ExpoConfig} config */
const withPodDeploymentTarget = (config, { deploymentTarget = "16.4" } = {}) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");

      if (contents.includes(MARKER)) return cfg;

      const sweep = `
    ${MARKER} — Xcode 27 rejects anything below iOS 15, and some pods
    # still declare 12.0/13.4 in their podspecs.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |cfg|
        current = cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || current.to_f < ${deploymentTarget}
          cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'
        end
      end
    end
`;

      // Append inside the existing post_install block, after the RN hook.
      const anchor = /(post_install do \|installer\|[\s\S]*?\n)(  end\n)/;
      if (!anchor.test(contents)) {
        throw new Error("withPodDeploymentTarget: could not find post_install block in Podfile");
      }
      contents = contents.replace(anchor, `$1${sweep}$2`);

      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);

module.exports = withPodDeploymentTarget;
