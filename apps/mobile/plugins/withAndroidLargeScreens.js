/**
 * Let Android rotate and resize the app, while iOS stays portrait.
 *
 * `orientation: "portrait"` in app.json feeds both platforms, and Play flags the
 * `android:screenOrientation="portrait"` it produces as a large-screen quality
 * problem. The lock is also already fiction: we target API 36, and Android 16
 * ignores orientation and resizability restrictions on displays 600dp and wider,
 * so tablets and unfolded foldables rotate us today whatever the manifest says.
 *
 * So we say it out loud instead — `unspecified` plus `resizeableActivity` —
 * and let src/lib/layout.ts do the real work of laying out for the window we get.
 *
 * This has to be a plugin rather than an app.json field because `orientation` is
 * shared by both platforms and there is no android-only counterpart. Built-in
 * prebuild plugins are registered after the ones in app.json, and a mod that is
 * registered later runs earlier, so AndroidConfig.Orientation.withOrientation
 * writes "portrait" first and this overwrites it. iOS never sees any of it.
 */

const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const withAndroidLargeScreens = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);

    activity.$["android:screenOrientation"] = "unspecified";
    activity.$["android:resizeableActivity"] = "true";
    app.$["android:resizeableActivity"] = "true";

    return cfg;
  });

module.exports = withAndroidLargeScreens;
