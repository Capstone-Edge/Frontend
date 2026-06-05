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
  tv: { power: 'off', volume: 10, channel: null, content_name: null },
  air_purifier: { power: 'off', mode: 'auto', fan_speed: 'low', air_quality: 'good', pm25: 15, filter_status: 'clean' },
  robot_vacuum: {
    status: 'docked', battery_pct: 100, zone: null,
    suction_power: 'standard', cleaning_mode: 'auto',
    cleaned_area_m2: 0, position: { x: 0, y: 0 },
    do_not_disturb: false, error: null,
  },
  oven: {
    power: 'off', mode: 'bake', target_temp: 180, current_temp: 25,
    timer_remaining: 0, fan_speed: 'off', steam: 'off',
    probe_temp: 25, light: 'off', door: 'closed',
  },
  washing_machine: {
    power: 'off', mode: 'standard', status: 'stopped',
    remaining_time: 0, spin_speed: 'medium', door: 'closed',
    water_temperature: 30, reservation_time: null, error: null,
  },
  light: {
    power: 'off', brightness: 70, color: 'white', color_temperature: 4000, scene_name: 'relax',
  },
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

  addMessage: (msg) =>
    set((state) => ({
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
    const {
      addMessage,
      setLoading,
      setSessionId,
      setPendingContextTrigger,
      setClarificationTurn,
    } = get()

    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/commands/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'edge-pi-01',
          raw_text: text,
          source: 'frontend',
        }),
      })

      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`)
      }

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

        addMessage({
          role: 'assistant',
          text: data.response_text,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      addMessage({ role: 'assistant', text: `오류가 발생했습니다: ${msg}` })
    } finally {
      setLoading(false)
    }
  },

  sendClarification: async (text: string) => {
    const {
      sessionId,
      pendingContextTrigger,
      clarificationTurn,
      addMessage,
      setLoading,
      setPendingContextTrigger,
      setClarificationTurn,
    } = get()

    if (!sessionId || !pendingContextTrigger) return

    addMessage({ role: 'user', text })
    setLoading(true)

    try {
      const res = await fetch('/api/v1/commands/process-clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          user_answer: text,
        }),
      })

      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`)
      }

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

        addMessage({
          role: 'assistant',
          text: data.response_text,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'
      addMessage({ role: 'assistant', text: `오류가 발생했습니다: ${msg}` })
    } finally {
      setLoading(false)
    }
  },

  connectWebSocket: () => {
    if (
      ws &&
      (ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    // 초기 기기 상태 로드
    fetch('/api/v1/devices/state')
      .then((r) => r.json())
      .then((data: DeviceStates) => get().setDevices(data))
      .catch(() => {})

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/device-states`)

    ws.onclose = () => {
      console.log('[WebSocket] disconnected')
      get().setWsConnected(false)
      setTimeout(() => get().connectWebSocket(), 3000)
    }
    ws.onerror = () => ws?.close()
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'device_state_update' && msg.device_type) {
          const current = get().devices
          get().setDevices({
            ...current,
            [msg.device_type]: {
              ...(current[msg.device_type as keyof DeviceStates] as object),
              ...msg.state,
            },
          })
        }
      } catch {}
    }

      ws.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data)

          console.log('[WebSocket] message:', message)

          if (message.type !== 'device_state_update') {
            return
          }

          if (message.device_name === 'living_room_tv') {
            set((state) => ({
              devices: {
                ...state.devices,
                tv: {
                  ...state.devices.tv,
                  power: message.state.power ?? state.devices.tv.power,
                  channel:
                    message.state.channel !== undefined && message.state.channel !== null
                      ? String(message.state.channel)
                      : state.devices.tv.channel,
                  content_name:
                    message.state.content_title ?? state.devices.tv.content_name,
                },
              },
            }))

            return
          }

          if (message.device_name === 'living_room_aircon') {
            set((state) => ({
              devices: {
                ...state.devices,
                air_conditioner: {
                  ...state.devices.air_conditioner,
                  ...message.state,
                },
              },
            }))

            return
          }

          console.warn('[WebSocket] unknown device:', message.device_name)
        } catch (error) {
          console.error('[WebSocket] message parse error:', error)
        }
      }
  },
}))