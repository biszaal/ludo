// Metro configuration for an Expo app inside an npm-workspaces monorepo.
// Lets Metro watch and resolve the shared @ludo/engine package from the repo root.
// See https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so changes in packages/* trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the app first, then the hoisted workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. Don't let a package resolve its own duplicate copy of React.
config.resolver.disableHierarchicalLookup = true;

// 4. Bundle .wav sound assets.
if (!config.resolver.assetExts.includes("wav")) config.resolver.assetExts.push("wav");

module.exports = config;
