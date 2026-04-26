import { create } from 'zustand'
import type { DeviceStates, ChatMessage, NLUResult } from '../types'

interface DeviceStore {
  devices: DeviceStates
  messages: ChatMessage[]
  sessionId: string | null
  pendingContextTrigger: string | null
  isLoading: boolean
  wsConnected: boolean

  setDevices: (devices: DeviceStates) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setSessionId: (id: string) => void
  setPendingContextTrigger: (trigger: string | null) => void
  setLoading: (loading: boolean) => void
  setWsConnected: (connected: boolean) => void
  sendCommand: (text: string) => Promise<void>
  sendClarification: (text: string) => Promise<void>
  connectWebSocket: () => void
}

const DEFAULT_DEVICES: DeviceStates = {
  air_conditioner: { power: 'off', temperature: 24, mode: 'cool', fan_speed: 'auto', louver_angle: 'mid' },
  tv: { power: 'off', channel: null, content_name: null },
  air_purifier: { power: 'off', mode: 'auto' },
  robot_vacuum: { action: 'idle', zone: null, suction_power: 'standard', cleaning_mode: 'auto' },
}

let ws: WebSocket | null = null

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: DEFAULT_DEVICES,
  messages: [],
  sessionId: null,
  pendingContextTrigger: null,
  isLoading: false,
  wsConnected: false,

  setDevices: (devices) => set({ devices }),

  addMessage: (msg) => set((state) => ({
    messages: [
      ...state.messages,
      { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
    ],
  })),

  setSessionId: (id) => set({ sessionId: id }),
  setPendingContextTrigger: (trigger) => set({ pendingContextTrigger: trigger }),
  setLoading: (loading) => set({ isLoading: loading }),
  setWsConnected: (connected) => set({ wsConnected: connected }),

  sendCommand: async (text: string) => {
    const { sessionId, addMessage, setLoading, setSessionId, setPendingContextTrigger } = get()
    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/command/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, session_id: sessionId }),
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = await res.json()
      if (!data.nlu) throw new Error('응답 형식 오류')
      const nlu: NLUResult = data.nlu
      setSessionId(data.session_id)

      if (nlu.clarification_needed && nlu.clarification_question) {
        setPendingContextTrigger(nlu.context_trigger)
        addMessage({
          role: 'assistant',
          text: nlu.clarification_question,
          isClarification: true,
          contextTrigger: nlu.context_trigger ?? undefined,
          sessionId: data.session_id,
        })
      } else {
        setPendingContextTrigger(null)
        addMessage({ role: 'assistant', text: nlu.response_text })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      addMessage({ role: 'assistant', text: `오류가 발생했습니다: ${msg}` })
    } finally {
      setLoading(false)
    }
  },

  sendClarification: async (text: string) => {
    const { sessionId, pendingContextTrigger, addMessage, setLoading, setPendingContextTrigger } = get()
    if (!sessionId || !pendingContextTrigger) return

    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/dialogue/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          session_id: sessionId,
          context_trigger: pendingContextTrigger,
        }),
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = await res.json()
      if (!data.nlu) throw new Error('응답 형식 오류')
      const nlu: NLUResult = data.nlu

      if (nlu.clarification_needed && nlu.clarification_question) {
        setPendingContextTrigger(nlu.context_trigger)
        addMessage({
          role: 'assistant',
          text: nlu.clarification_question,
          isClarification: true,
          contextTrigger: nlu.context_trigger ?? undefined,
        })
      } else {
        setPendingContextTrigger(null)
        addMessage({ role: 'assistant', text: nlu.response_text })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      addMessage({ role: 'assistant', text: `오류가 발생했습니다: ${msg}` })
    } finally {
      setLoading(false)
    }
  },

  connectWebSocket: () => {
    if (ws && ws.readyState === WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => get().setWsConnected(true)
    ws.onclose = () => {
      get().setWsConnected(false)
      // 3초 후 재연결
      setTimeout(() => get().connectWebSocket(), 3000)
    }
    ws.onerror = () => ws?.close()
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as DeviceStates
        get().setDevices(data)
      } catch {}
    }
  },
}))
