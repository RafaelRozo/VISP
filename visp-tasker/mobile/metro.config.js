const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration for VISP/Tasker
 * https://reactnative.dev/docs/metro
 */
const config = {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
