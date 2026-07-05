module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Required by react-native-reanimated v4 (a peer dep of @shopify/react-native-skia).
    // Must be listed last.
    plugins: ["react-native-worklets/plugin"],
  };
};
