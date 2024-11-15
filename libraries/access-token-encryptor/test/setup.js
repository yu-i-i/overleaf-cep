const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const SandboxedModule = require('sandboxed-module')

chai.use(chaiAsPromised)

SandboxedModule.configure({
  sourceTransformers: {
    removeNodePrefix: function (source) {
      return source.replace(/require\(['"]node:/g, "require('")
    },
  },
})
