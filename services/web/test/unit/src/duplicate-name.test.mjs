/* global describe, it */
import { expect } from 'chai'
import { generateDuplicateName } from '../../../app/src/Features/Project/ProjectDuplicator.mjs'

describe('generateDuplicateName (New 2 — file tree duplicate)', () => {
  it('appends _copy to the stem', () => {
    expect(generateDuplicateName('a.b', [])).to.equal('a_copy.b')
  })
  it('bumps (1), (2), ... when names collide', () => {
    expect(generateDuplicateName('a.b', ['a_copy.b'])).to.equal('a_copy(1).b')
    expect(
      generateDuplicateName('a.b', ['a_copy.b', 'a_copy(1).b'])
    ).to.equal('a_copy(2).b')
    expect(
      generateDuplicateName('a.b', ['a_copy.b', 'a_copy(2).b'])
    ).to.equal('a_copy(1).b')
  })
  it('handles multiple dots (last dot is the extension)', () => {
    expect(generateDuplicateName('archive.tar.gz', [])).to.equal(
      'archive.tar_copy.gz'
    )
  })
  it('handles names without an extension', () => {
    expect(generateDuplicateName('LICENSE', [])).to.equal('LICENSE_copy')
  })
  it('handles dotfiles', () => {
    expect(generateDuplicateName('.gitignore', [])).to.equal('.gitignore_copy')
  })
})
