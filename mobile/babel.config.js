module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must stay last. Reanimated 4 ships its Babel plugin under
    // react-native-worklets (see mobile setup notes) — the old
    // 'react-native-reanimated/plugin' path no longer exists.
    plugins: ['react-native-worklets/plugin'],
  };
};
