import { expect } from 'chai'
import {
  MAX_OUTPUT_FILES,
  MAX_OUTPUT_FILE_BYTES,
  MAX_OUTPUT_TOTAL_BYTES,
  checkOutputLimits,
} from '../../../frontend/js/components/editor/python/pyodide-worker-output-limits'

const BYTES_PER_MB = 1024 * 1024

function makeFiles(
  count: number,
  sizePerFile: number
): { path: string; size: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/project/file${i}.bin`,
    size: sizePerFile,
  }))
}

describe('checkOutputLimits', function () {
  it('returns null when both limits are within bounds', function () {
    const files = makeFiles(10, 1024)
    expect(checkOutputLimits(files)).to.equal(null)
  })

  it('returns null for an empty file list', function () {
    expect(checkOutputLimits([])).to.equal(null)
  })

  it('returns null at exactly the file count limit', function () {
    const files = makeFiles(MAX_OUTPUT_FILES, 1024)
    expect(checkOutputLimits(files)).to.equal(null)
  })

  it('returns a count violation reporting the actual file count when the file count exceeds the limit', function () {
    const files = makeFiles(73, 1)
    const violation = checkOutputLimits(files)
    expect(violation).to.deep.equal({
      kind: 'count',
      message: 'Output limit exceeded: 73 files generated (max 50)',
    })
  })

  it('returns null at exactly the per-file size limit', function () {
    const files = [{ path: '/project/big.bin', size: MAX_OUTPUT_FILE_BYTES }]
    expect(checkOutputLimits(files)).to.equal(null)
  })

  it('returns a single-file-size violation reporting the offending file path and size when one file exceeds the per-file limit', function () {
    const files = [
      { path: '/project/small.bin', size: 1 * BYTES_PER_MB },
      { path: '/project/huge.bin', size: 80 * BYTES_PER_MB },
    ]
    const violation = checkOutputLimits(files)
    expect(violation).to.deep.equal({
      kind: 'single-file-size',
      message:
        'Output limit exceeded: /project/huge.bin is 80MB (max 50MB per file)',
    })
  })

  it('returns a total-output-size violation when the summed size exceeds the total limit', function () {
    const files = [
      { path: '/project/a.bin', size: 40 * BYTES_PER_MB },
      { path: '/project/b.bin', size: 40 * BYTES_PER_MB },
      { path: '/project/c.bin', size: 40 * BYTES_PER_MB },
    ]
    const violation = checkOutputLimits(files)
    expect(violation).to.not.equal(null)
    expect(violation!.kind).to.equal('total-output-size')
    expect(violation!.message).to.equal(
      'Output limit exceeded: 120MB total (max 100MB)'
    )
  })

  it('returns null at exactly the total size limit', function () {
    const files = [
      { path: '/project/a.bin', size: 50 * BYTES_PER_MB },
      { path: '/project/b.bin', size: 50 * BYTES_PER_MB },
    ]
    expect(checkOutputLimits(files)).to.equal(null)
    const total = files.reduce((acc, f) => acc + f.size, 0)
    expect(total).to.equal(MAX_OUTPUT_TOTAL_BYTES)
  })

  it('reports the count violation when both limits are exceeded', function () {
    const files = makeFiles(MAX_OUTPUT_FILES + 10, MAX_OUTPUT_TOTAL_BYTES)
    const violation = checkOutputLimits(files)
    expect(violation).to.not.equal(null)
    expect(violation!.kind).to.equal('count')
  })
})
