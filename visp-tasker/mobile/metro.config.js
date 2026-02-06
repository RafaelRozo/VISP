const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration for VISP/Tasker
 * https://reactnative.dev/docs/metro
 */
const config = {
  resolver: {
    resolverMainFields: ['react-native', 'browser', 'main'],
    unstable_conditionNames: ['react-native', 'browser', 'require'],
    unstable_enablePackageExports: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
