export type ServerWordCountData = {
  encode: string
  textWords: number
  headWords: number
  outside: number
  headers: number
  elements: number
  mathInline: number
  mathDisplay: number
  errors: number
  messages: string
}

export type WordCountData = ServerWordCountData & {
  textCharacters: number
  headCharacters: number
  captionWords: number
  captionCharacters: number
  footnoteWords: number
  footnoteCharacters: number
  abstractWords: number
  abstractCharacters: number
  otherWords: number
  otherCharacters: number
}

export const createEmptyWordCountData = (): WordCountData => ({
  encode: 'ascii',
  textWords: 0,
  textCharacters: 0,
  headWords: 0,
  headCharacters: 0,
  abstractWords: 0,
  abstractCharacters: 0,
  captionWords: 0,
  captionCharacters: 0,
  footnoteWords: 0,
  footnoteCharacters: 0,
  outside: 0,
  otherWords: 0,
  otherCharacters: 0,
  headers: 0,
  elements: 0,
  mathInline: 0,
  mathDisplay: 0,
  errors: 0,
  messages: '',
})
