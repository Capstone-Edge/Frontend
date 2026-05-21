import { create } from 'zustand'
import type { DeviceStates, ChatMessage } from '../types'

interface DeviceStore {
  devices: DeviceStates
  messages: ChatMessage[]
  sessionId: string | null
  pendingContextTrigger: string | null
  clarificationTurn: number
  isLoading: boolean
  wsConnected: boolean

  setDevices: (devices: DeviceStates) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  setSessionId: (id: string) => void
  setPendingContextTrigger: (trigger: string | null) => void
  setClarificationTurn: (turn: number) => void
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
  clarificationTurn: 0,
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
  setClarificationTurn: (turn) => set({ clarificationTurn: turn }),
  setLoading: (loading) => set({ isLoading: loading }),
  setWsConnected: (connected) => set({ wsConnected: connected }),

  sendCommand: async (text: string) => {
    const { addMessage, setLoading, setSessionId, setPendingContextTrigger, setClarificationTurn } = get()
    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/commands/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'edge-pi-01', stt_text: text }),
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = await res.json()
      setSessionId(data.session_id)

      if (data.clarification_needed) {
        setPendingContextTrigger('pending')
        setClarificationTurn(data.clarification_turn ?? 1)
        addMessage({
          role: 'assistant',
          text: data.response_text,
          isClarification: true,
          sessionId: data.session_id,
        })
      } else {
        setPendingContextTrigger(null)
        setClarificationTurn(0)
        addMessage({ role: 'assistant', text: data.response_text })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      addMessage({ role: 'assistant', text: `오류가 발생했습니다: ${msg}` })
    } finally {
      setLoading(false)
    }
  },

  sendClarification: async (text: string) => {
    const { sessionId, pendingContextTrigger, clarificationTurn, addMessage, setLoading, setPendingContextTrigger, setClarificationTurn } = get()
    if (!sessionId || !pendingContextTrigger) return

    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/dialogues/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'edge-pi-01',
          session_id: sessionId,
          user_answer: text,
          clarification_turn: clarificationTurn,
        }),
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      const data = await res.json()

      if (data.clarification_needed) {
        setPendingContextTrigger('pending')
        setClarificationTurn(data.clarification_turn ?? clarificationTurn + 1)
        addMessage({
          role: 'assistant',
          text: data.response_text,
          isClarification: true,
        })
      } else {
        setPendingContextTrigger(null)
        setClarificationTurn(0)
        addMessage({ role: 'assistant', text: data.response_text })
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
