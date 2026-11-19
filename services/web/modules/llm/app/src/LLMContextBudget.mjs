// Keep reference labels in sync with the blocks actually sent to the model.
export function fitContextBlocks(parts, files, budget) {
  const output = []
  const included = []
  let size = 0
  for (let i = 0; i < parts.length; i++) {
    const separator = output.length ? 2 : 0
    const available = budget - size - separator
    const part = parts[i]
    const headerEnd = part.indexOf('\n')
    // Reserve room for the heading, source, and a truncation notice.
    if (available < (headerEnd >= 0 ? headerEnd + 100 : 100)) continue
    const suffix = '\n…（抜粋・以降省略）'
    const block =
      part.length <= available
        ? part
        : part.slice(0, available - suffix.length) + suffix
    output.push(block)
    size += separator + block.length
    if (i > 0) included.push(files[i - 1])
  }
  return { context: output.join('\n\n'), files: [...new Set(included)] }
}
