/* global jest */
module.exports = {
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn()
  }),
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: ({ children }: any) => children || null, Protected: ({ children }: any) => children || null }
}
