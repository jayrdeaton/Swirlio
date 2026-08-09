const config = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.ts', './node_modules/react-native-gesture-handler/jestSetup.js'],
  transformIgnorePatterns: [],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/worktrees/'],
  moduleNameMapper: {
    '^@/app/(.*)$': '<rootDir>/src/app/$1',
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@/hooks/(.*)$': '<rootDir>/src/hooks/$1'
  }
}

export default config
