/* eslint-env jest */
/* 原生模块在 Jest 里没有实现：读书和公式用到的几个库换成最小的假实现，测试需要时再单独 mock 具体行为。 */
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const postMessage = jest.fn();
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ postMessage, reload: jest.fn() }));
    return React.createElement(View, props);
  });
  WebView.displayName = 'MockWebView';
  return { __esModule: true, default: WebView, WebView, __postMessage: postMessage };
});
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: { DocumentDir: '/docs', CacheDir: '/cache' },
      exists: jest.fn(async () => false),
      mkdir: jest.fn(async () => undefined),
      unlink: jest.fn(async () => undefined),
      readFile: jest.fn(async () => ''),
      writeFile: jest.fn(async () => undefined),
      cp: jest.fn(async () => undefined),
      ls: jest.fn(async () => []),
      stat: jest.fn(async () => ({ size: 0 })),
      hash: jest.fn(async () => ''),
    },
    config: jest.fn(() => ({ fetch: jest.fn() })),
    fetch: jest.fn(),
    wrap: (p) => 'RNFetchBlob-file://' + p,
  },
}));
jest.mock('react-native-zip-archive', () => ({ unzip: jest.fn(async (_s, d) => d) }));
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => []),
  keepLocalCopy: jest.fn(async () => []),
  types: { allFiles: '*/*', pdf: 'application/pdf', plainText: 'text/plain' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: () => false,
}));
