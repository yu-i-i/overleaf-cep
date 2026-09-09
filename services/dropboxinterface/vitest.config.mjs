/** @type {import('vitest/config').VitestConfig} */
export default {
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.mjs'],
    exclude: ['node_modules', 'tests/unit/*.mjs{,.?*}']
  },
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.mjs', '.js', '.json']
  }
}
