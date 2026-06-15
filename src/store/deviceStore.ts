const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws')

import { create } from 'zustand'

import type {
  ChatMessage,
  DeviceStates,
  DialogueLogMessage,
  DialogueRecentResponse,
  DialogueWebSocketPayload,
} from '../types'

interface DeviceStore {
  devices: DeviceStates
  messages: ChatMessage[]
  sessionId: string | null
  pendingContextTrigger: string | null
  isLoading: boolean
  dialogueWsConnected: boolean

  setDevices: (devices: DeviceStates) => void
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void
  addServerDialogueMessage: (msg: DialogueLogMessage) => void
  setServerDialogueMessages: (messages: DialogueLogMessage[]) => void
  setSessionId: (id: string | null) => void
  setPendingContextTrigger: (trigger: string | null) => void
  setLoading: (loading: boolean) => void
  setDialogueWsConnected: (connected: boolean) => void

  sendCommand: (text: string) => Promise<void>
  connectWebSocket: () => void
  connectDialogueWebSocket: () => void
  loadRecentDialogues: () => Promise<void>
}

const DEFAULT_DEVICES: DeviceStates = {
  air_conditioner: {
    power: 'off',
    temperature: 24,
    mode: 'cool',
    fan_speed: 'auto',
    louver_angle: 'mid',
  },
  tv: {
    power: 'off',
    volume: 10,
    channel: null,
    content_name: null,
  },
  air_purifier: {
    power: 'off',
    mode: 'auto',
    fan_speed: 'low',
    air_quality: 'good',
    pm25: 15,
    filter_status: 'clean',
  },
  robot_vacuum: {
    status: 'docked',
    battery_pct: 100,
    zone: null,
    suction_power: 'standard',
    cleaning_mode: 'auto',
    cleaned_area_m2: 0,
    position: { x: 0, y: 0 },
    do_not_disturb: false,
    error: null,
  },
  oven: {
    power: 'off',
    mode: 'bake',
    target_temp: 180,
    current_temp: 25,
    timer_remaining: 0,
    fan_speed: 'off',
    steam: 'off',
    probe_temp: 25,
    light: 'off',
    door: 'closed',
  },
  washing_machine: {
    power: 'off',
    mode: 'standard',
    status: 'stopped',
    remaining_time: 0,
    spin_speed: 'medium',
    door: 'closed',
    water_temperature: 30,
    reservation_time: null,
    error: null,
  },
  light: {
    power: 'off',
    brightness: 70,
    color: 'white',
    color_temperature: 4000,
    scene_name: 'relax',
  },
}

let deviceWs: WebSocket | null = null
let dialogueWs: WebSocket | null = null

function mapDialogueLogToChatMessage(msg: DialogueLogMessage): ChatMessage {
  return {
    id: `server-${msg.id}`,
    role: msg.role,
    source: msg.source,
    text: msg.text,
    isClarification: msg.clarification_needed === true,
    sessionId: msg.session_id,
    clientId: msg.client_id,
    deviceId: msg.device_id,
    status: msg.status,
    mode: msg.mode,
    timestamp: msg.timestamp,
  }
}

function updatePendingStateFromMessages(messages: DialogueLogMessage[]) {
  const assistants = messages.filter((m) => m.role === 'assistant')

  const lastAssistant = assistants[assistants.length - 1]

  if (!lastAssistant) {
    return {
      pendingContextTrigger: null,
      sessionId: null,
    }
  }

  if (lastAssistant.clarification_needed === true) {
    return {
      pendingContextTrigger: 'pending',
      sessionId: lastAssistant.session_id,
    }
  }

  return {
    pendingContextTrigger: null,
    sessionId: lastAssistant.session_id,
  }
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: DEFAULT_DEVICES,
  messages: [],
  sessionId: null,
  pendingContextTrigger: null,
  isLoading: false,
  dialogueWsConnected: false,

  setDevices: (devices) => set({ devices }),

  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...msg,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      ],
    })),

  addServerDialogueMessage: (serverMsg) =>
    set((state) => {
      const id = `server-${serverMsg.id}`

      if (state.messages.some((m) => m.id === id)) {
        return state
      }

      // 로컬에서 먼저 추가한 user 메시지(frontend-local)가 서버에서 echo로 돌아오면
      // 새 항목을 추가하지 않고 기존 로컬 항목을 서버 버전으로 교체한다.
      if (serverMsg.role === 'user' && serverMsg.source === 'frontend') {
        const localIdx = state.messages.findLastIndex(
          (m) => m.source === 'frontend-local' && m.text === serverMsg.text,
        )
        if (localIdx !== -1) {
          const nextMessages = [...state.messages]
          nextMessages[localIdx] = mapDialogueLogToChatMessage(serverMsg)
          const serverMessages = nextMessages
            .filter((m) => m.id.startsWith('server-'))
            .map((m) => ({
              id: Number(String(m.id).replace('server-', '')),
              session_id: m.sessionId ?? null,
              client_id: m.clientId ?? null,
              device_id: m.deviceId ?? null,
              role: m.role,
              source: m.source ?? null,
              text: m.text,
              status: m.status ?? null,
              mode: m.mode ?? null,
              clarification_needed: m.isClarification ?? false,
              timestamp: String(m.timestamp),
            })) as DialogueLogMessage[]
          const pendingState = updatePendingStateFromMessages(serverMessages)
          return {
            messages: nextMessages,
            pendingContextTrigger: pendingState.pendingContextTrigger,
            sessionId: pendingState.sessionId ?? state.sessionId,
          }
        }
      }

      const nextMessages = [
        ...state.messages,
        mapDialogueLogToChatMessage(serverMsg),
      ]

      const serverMessages = nextMessages
        .filter((m) => m.id.startsWith('server-'))
        .map((m) => ({
          id: Number(String(m.id).replace('server-', '')),
          session_id: m.sessionId ?? null,
          client_id: m.clientId ?? null,
          device_id: m.deviceId ?? null,
          role: m.role,
          source: m.source ?? null,
          text: m.text,
          status: m.status ?? null,
          mode: m.mode ?? null,
          clarification_needed: m.isClarification ?? false,
          timestamp: String(m.timestamp),
        })) as DialogueLogMessage[]

      const pendingState = updatePendingStateFromMessages(serverMessages)

      return {
        messages: nextMessages,
        pendingContextTrigger: pendingState.pendingContextTrigger,
        sessionId: pendingState.sessionId ?? state.sessionId,
      }
    }),

  setServerDialogueMessages: (serverMessages) => {
    const pendingState = updatePendingStateFromMessages(serverMessages)

    set((state) => ({
      messages: serverMessages.map(mapDialogueLogToChatMessage),
      pendingContextTrigger: pendingState.pendingContextTrigger,
      sessionId: pendingState.sessionId ?? state.sessionId,
    }))
  },

  setSessionId: (id) => set({ sessionId: id }),

  setPendingContextTrigger: (trigger) => set({ pendingContextTrigger: trigger }),

  setLoading: (loading) => set({ isLoading: loading }),

  setDialogueWsConnected: (connected) => set({ dialogueWsConnected: connected }),

  loadRecentDialogues: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/dialogues/recent?limit=100`)

      if (!res.ok) {
        throw new Error(`recent dialogues failed: ${res.status}`)
      }

      const data = (await res.json()) as DialogueRecentResponse
      get().setServerDialogueMessages(data.messages)
    } catch {
      // 초기 로그 로딩 실패는 치명적이지 않으므로 무시한다.
    }
  },

  sendCommand: async (text: string) => {
    const {
      sessionId,
      addMessage,
      setLoading,
      setSessionId,
      setPendingContextTrigger,
    } = get()

    addMessage({
      role: 'user',
      source: 'frontend-local',
      text,
    })

    setLoading(true)

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/commands/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: 'frontend-test',
          raw_text: text,
          session_id: sessionId ?? undefined,
          client_id: 'web-client-01',
          source: 'frontend',
        }),
      })

      if (!res.ok) {
        throw new Error(`서버 오류 (${res.status})`)
      }

      const data = await res.json()

      if (data.session_id) {
        setSessionId(data.session_id)
      }

      if (data.clarification_needed) {
        setPendingContextTrigger('pending')
      } else {
        setPendingContextTrigger(null)
      }

      /*
        응답 메시지는 여기서 직접 addMessage 하지 않는다.
        Backend가 WebSocket으로 assistant 로그를 push하므로 중복 표시를 막기 위함.
      */
    } catch (e) {
      const msg = e instanceof Error ? e.message : '알 수 없는 오류'

      addMessage({
        role: 'assistant',
        source: 'frontend',
        text: `오류가 발생했습니다: ${msg}`,
      })
    } finally {
      setLoading(false)
    }
  },

  connectWebSocket: () => {
    if (deviceWs && deviceWs.readyState === WebSocket.OPEN) {
      return
    }

    deviceWs = new WebSocket(`${WS_BASE_URL}/ws`)

    deviceWs.onopen = () => {}

    deviceWs.onclose = () => {
      setTimeout(() => get().connectWebSocket(), 3000)
    }

    deviceWs.onerror = () => {
      deviceWs?.close()
    }

    deviceWs.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as DeviceStates
        get().setDevices(data)
      } catch {
        // ignore malformed device state payload
      }
    }
  },

  connectDialogueWebSocket: () => {
    if (dialogueWs && dialogueWs.readyState === WebSocket.OPEN) {
      return
    }

    dialogueWs = new WebSocket(`${WS_BASE_URL}/api/v1/dialogues/ws`)

    dialogueWs.onopen = () => {
      get().setDialogueWsConnected(true)
    }

    dialogueWs.onclose = () => {
      get().setDialogueWsConnected(false)
      setTimeout(() => get().connectDialogueWebSocket(), 3000)
    }

    dialogueWs.onerror = () => {
      dialogueWs?.close()
    }

    dialogueWs.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as DialogueWebSocketPayload

        if (payload.type === 'dialogue_snapshot') {
          get().setServerDialogueMessages(payload.messages)
          return
        }

        if (payload.type === 'dialogue_message') {
          get().addServerDialogueMessage(payload.message)
        }
      } catch {
        // ignore malformed dialogue payload
      }
    }
  },
}))