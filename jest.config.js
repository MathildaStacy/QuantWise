module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Local Claude worktrees contain separate source, tests and mocks; keep them outside this checkout's run.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/.*/helpers/', '/\\.claude/'],
  // lucide 的 ESM 入口是 .mjs，Jest 不转译，改用 CommonJS 版本
  moduleNameMapper: {
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context|react-native-svg|lucide-react-native|htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)/)',
  ],
};
