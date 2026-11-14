// 翻訳完了イベント（complete）の本文。結果テキストと使用情報を運びます。
// failed_chunks が空でなければ、失敗したチャンクは原文保持のまま保存されます。
export type TranslationReply = {
  text: string
  model: string
  chunks: number
  protected_tokens: number
  failed_chunks?: number[]
}
// SSE で届くイベントの連合型（進捗・訳片・チャンク完了・完了・エラー）。
export type TranslationStreamEvent =
  | {
      type: 'progress'
      phase: string
      chunk: number
      total: number
      message: string
    }
  | { type: 'delta'; chunk: number; text: string }
  | { type: 'chunk_complete'; chunk: number; text: string; ok?: boolean }
  | ({ type: 'complete' } & TranslationReply)
  | { type: 'error'; detail: string }

// 保護マーカーの語頭（バックエンドの QZPROTECTED000000XZQ と同一語）。
const MARKER_WORD = 'QZPROTECTED'

/**
 * 生成途中の訳片の仮表示用です。保護マーカーを「…」に伏せます。
 * マーカーが delta で分割された場合（例: QZPROTECTED00 + 00XZQ）も伏せきれるよう、
 * 完全形・数字まで途切れ・語頭の途中表記（QZPR…）の順に末尾の断片を隠します。
 */
export function maskPartialMarkers(text: string): string {
  // 完全なマーカーを「…」に置換します。
  let masked = text.replace(/QZPROTECTED\d{0,6}XZQ/g, '…')
  // 末尾でマーカーの途中まで届いた分（数字や XZQ がまだ来ていない）も隠します。
  masked = masked.replace(/QZPROTECTED\d*(?:X(?:Z(?:Q)?)?)?$/, '')
  // 末尾がちょうど「QZPROTECTED」の途中表記なら、その断片も隠します。
  for (let length = MARKER_WORD.length - 1; length >= 1; length -= 1) {
    if (MARKER_WORD.startsWith(masked.slice(-length))) {
      masked = masked.slice(0, -length)
      break
    }
  }
  return masked
}

/** HTTP の分割位置に依存せず SSE を読み、検証済みの完了結果を返します。 */
export async function readTranslationStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TranslationStreamEvent) => void
): Promise<TranslationReply> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: TranslationReply | null = null
  let streamError = ''

  const consumeEvent = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const event = JSON.parse(data) as TranslationStreamEvent
    if (event.type === 'complete') result = event
    if (event.type === 'error') streamError = event.detail
    onEvent(event)
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        consumeEvent(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
      if (done) break
    }
    if (buffer.trim()) consumeEvent(buffer)
  } finally {
    // 解析失敗や停止時も、本文の受信を打ち切って上流の接続を解放します。
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }

  if (streamError) throw new Error(streamError)
  if (!result)
    throw new Error('翻訳ストリームが完了イベントを返しませんでした。')
  return result
}
