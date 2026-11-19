import { marked } from 'marked'
import DOMPurify from 'dompurify'

export default function LLMChatResponse({ content }: { content: string }) {
  // モデルの回答も外部入力として扱います。Markdown 内の HTML を無害化してから
  // 表示し、スクリプト・イベント属性をチャット経由で実行させません。
  return (
    <div
      className="message-content"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(marked.parse(content) as string, {
          USE_PROFILES: { html: true, svg: false, mathMl: false },
        }),
      }}
    />
  )
}
