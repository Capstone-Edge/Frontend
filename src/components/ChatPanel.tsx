import { useEffect, useRef, useState } from 'react'
import { useDeviceStore } from '../store/deviceStore'
import type { ChatMessage } from '../types'

function formatTime(timestamp: number | string) {
  const date =
    typeof timestamp === 'number'
      ? new Date(timestamp)
      : new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function sourceLabel(source?: string | null) {
  if (source === 'edge') return 'EDGE'
  if (source === 'backend') return 'BACKEND'
  if (source === 'frontend') return 'FRONT'
  if (source === 'frontend-local') return 'FRONT'
  return source?.toUpperCase() || 'LOG'
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          isUser
            ? 'rounded-br-sm bg-indigo-600 text-white'
            : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800',
        ].join(' ')}
      >
        <div className="mb-1 flex items-center gap-1.5 text-[10px] opacity-80">
          <span
            className={[
              'rounded-full px-1.5 py-0.5 font-semibold',
              isUser ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600',
            ].join(' ')}
          >
            {sourceLabel(msg.source)}
          </span>

          {msg.isClarification && (
            <span className="rounded-full bg-yellow-100 px-1.5 py-0.5 font-semibold text-yellow-700">
              재질문
            </span>
          )}

          {msg.status && (
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-500">
              {msg.status}
            </span>
          )}
        </div>

        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {msg.text}
        </div>

        <div
          className={[
            'mt-1 text-right text-[10px]',
            isUser ? 'text-indigo-100' : 'text-gray-400',
          ].join(' ')}
        >
          {formatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const {
    messages,
    isLoading,
    pendingContextTrigger,
    dialogueWsConnected,
    sendCommand,
  } = useDeviceStore()

  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const text = input.trim()

    if (!text || isLoading) {
      return
    }

    setInput('')
    await sendCommand(text)
  }

  const suggestions = [
    '에어컨 켜줘',
    '집이 너무 덥네',
    '24도로 해줘',
    '거실 불 꺼줘',
    '청소기 돌려줘',
    '이전 요청 취소해',
  ]

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-gray-200 bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              Edge ↔ Backend 실시간 로그
            </h2>
            <p className="text-xs text-gray-500">
              WebSocket으로 대화 로그를 즉시 표시합니다.
            </p>
          </div>

          <span
            className={[
              'rounded-full px-2 py-1 text-xs font-semibold',
              dialogueWsConnected
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700',
            ].join(' ')}
          >
            {dialogueWsConnected ? 'LIVE ON' : 'LIVE OFF'}
          </span>
        </div>
      </header>

      {messages.length === 0 && (
        <section className="border-b border-gray-200 bg-white px-4 py-3">
          <p className="mb-2 text-xs font-semibold text-gray-500">
            빠른 테스트 명령어
          </p>

          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => sendCommand(s)}
                className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 transition hover:bg-indigo-50 hover:text-indigo-600"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-20 text-center text-sm text-gray-400">
            아직 표시할 대화가 없습니다.
            <br />
            Edge에서 말하거나 아래 입력창으로 테스트하세요.
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500 shadow-sm">
              처리 중...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-gray-200 bg-white px-4 py-3">
        {pendingContextTrigger && (
          <div className="mb-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-700">
            재질문 답변을 기다리는 중입니다.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              pendingContextTrigger
                ? '재질문 답변을 입력하세요...'
                : '프론트에서 테스트 명령 입력...'
            }
            disabled={isLoading}
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 disabled:bg-gray-50 disabled:text-gray-400"
          />

          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            전송
          </button>
        </form>
      </footer>
    </aside>
  )
}