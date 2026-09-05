export type SentenceSegment = {
  segment: string
}

export type SentenceSegmenter = {
  segment(input: string): {
    [Symbol.iterator](): IterableIterator<SentenceSegment>
  }
}

const sentenceRe = /[^.!?。！？…]+(?:[.!?。！？…]+|$)/gu

const fallbackSentenceSegmenter: SentenceSegmenter = {
  segment(input: string) {
    const segments: SentenceSegment[] = []

    for (const match of input.matchAll(sentenceRe)) {
      segments.push({ segment: match[0] })
    }

    return segments
  },
}

export const createSentenceSegmenter = (locale?: string): SentenceSegmenter => {
  if (!Intl.Segmenter) {
    return fallbackSentenceSegmenter
  }

  try {
    return new Intl.Segmenter(locale, {
      granularity: 'sentence',
    })
  } catch {
    return fallbackSentenceSegmenter
  }
}
