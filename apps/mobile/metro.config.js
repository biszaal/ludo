// Expo detects npm workspaces and configures Metro resolution automatically.
// https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);

// Keep the app's sound assets available to Metro.
if (!config.resolver.assetExts.includes("wav")) config.resolver.assetExts.push("wav");

module.exports = config;
