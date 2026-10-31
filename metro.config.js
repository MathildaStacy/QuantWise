const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest(context, moduleName, platform) {
      // htmlparser2（EPUB 解析）的 ESM 入口用了 RN 的 Babel 预设不支持的 export * as，改用它的 CommonJS 版本（和 Pagewise 一样）
      if (moduleName === 'htmlparser2') {
        return { type: 'sourceFile', filePath: require.resolve('htmlparser2') };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
