import { useRef, useEffect, useState } from 'react'
import { useDeviceStore } from '../store/deviceStore'
import type { ChatMessage } from '../types'

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs mr-2 mt-1 flex-shrink-0">
          AI
        </div>
      )}
      <div
        className={`
          max-w-[220px] px-3 py-2 rounded-2xl text-sm leading-snug
          ${isUser
            ? 'bg-blue-500 text-white rounded-br-sm'
            : msg.isClarification
              ? 'bg-amber-50 border border-amber-300 text-amber-900 rounded-bl-sm'
              : 'bg-gray-100 text-gray-800 rounded-bl-sm'
          }
        `}
      >
        {msg.isClarification && (
          <div className="text-xs font-semibold text-amber-600 mb-1 flex items-center gap-1">
            <span>?</span> 확인이 필요해요
          </div>
        )}
        {msg.text}
        <div className={`text-xs mt-1 ${isUser ? 'text-blue-200' : 'text-gray-400'}`}>
          {new Date(msg.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const { messages, isLoading, pendingContextTrigger, sendCommand, sendClarification } = useDeviceStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')

    if (pendingContextTrigger) {
      await sendClarification(text)
    } else {
      await sendCommand(text)
    }
  }

  const suggestions = [
    '에어컨 켜줘', 'TV 넷플릭스 틀어줘', '청소기 돌려줘',
    '집이 너무 덥네', '나 자려고', '전부 꺼줘',
  ]

  return (
    <div className="w-80 flex flex-col bg-white border-l border-gray-200 shadow-sm">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b border-gray-100 bg-indigo-600">
        <h3 className="text-white font-bold text-sm">스마트홈 어시스턴트</h3>
        <p className="text-indigo-200 text-xs mt-0.5">자연어로 기기를 제어하세요</p>
      </div>

      {/* 빠른 명령 (메시지 없을 때) */}
      {messages.length === 0 && (
        <div className="p-3 border-b border-gray-100">
          <p className="text-xs text-gray-500 mb-2 font-medium">빠른 명령어</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendCommand(s)}
                className="text-xs px-2 py-1 bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 text-gray-600 rounded-full transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 대화 영역 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-xs mt-8">
            <div className="text-3xl mb-2">🏠</div>
            명령어를 입력하거나<br />위 버튼을 눌러 시작하세요
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-2">
            <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs mr-2 mt-1">AI</div>
            <div className="bg-gray-100 px-3 py-2 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1 items-center h-4">
                {[0, 1, 2].map((i) => (
                  <div key={i}
                    className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className="border-t border-gray-100 p-3">
        {pendingContextTrigger && (
          <div className="mb-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5 flex items-center gap-1">
            <span className="font-bold">?</span>
            <span>답변을 기다리고 있어요...</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={pendingContextTrigger ? '답변을 입력하세요...' : '명령을 입력하세요...'}
            disabled={isLoading}
            className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 disabled:bg-gray-50 disabled:text-gray-400 transition"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white text-sm rounded-xl transition-colors font-medium"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  )
}
