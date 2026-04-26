export interface AirConditionerState {
  power: 'on' | 'off'
  temperature: number
  mode: 'cool' | 'heat' | 'dry' | 'fan'
  fan_speed: 'auto' | 'low' | 'medium' | 'high'
  louver_angle: 'up' | 'mid' | 'down' | 'swing'
}

export interface TVState {
  power: 'on' | 'off'
  channel: string | null
  content_name: string | null
}

export interface AirPurifierState {
  power: 'on' | 'off'
  mode: 'auto' | 'quiet' | 'standard' | 'strong' | 'turbo'
}

export interface RobotVacuumState {
  action: 'idle' | 'cleaning' | 'paused' | 'returning' | 'docked'
  zone: string | string[] | null
  suction_power: 'quiet' | 'standard' | 'strong' | 'max'
  cleaning_mode: 'auto' | 'zigzag' | 'spot' | 'edge'
}

export interface DeviceStates {
  air_conditioner: AirConditionerState
  tv: TVState
  air_purifier: AirPurifierState
  robot_vacuum: RobotVacuumState
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  isClarification?: boolean
  contextTrigger?: string
  sessionId?: string
  timestamp: number
}

export interface NLUResult {
  intent: string
  target_devices: Array<{
    device: string
    action: string
    parameters: Record<string, unknown>
  }>
  clarification_needed: boolean
  clarification_question: string | null
  clarification_turn: number
  context_trigger: string | null
  inferred_intent: string | null
  response_text: string
}
