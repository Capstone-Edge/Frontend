export interface AirConditionerState {
  power: 'on' | 'off'
  temperature: number
  mode: 'cool' | 'heat' | 'dry' | 'fan'
  fan_speed: 'auto' | 'low' | 'medium' | 'high'
  louver_angle: 'up' | 'mid' | 'down' | 'swing'
}

export interface TVState {
  power: 'on' | 'off'
  volume: number
  channel: string | null
  content_name: string | null
}

export interface AirPurifierState {
  power: 'on' | 'off'
  mode: 'auto' | 'manual' | 'sleep'
  fan_speed: 'low' | 'medium' | 'high'
  air_quality: 'good' | 'moderate' | 'poor'
  pm25: number
  filter_status: 'clean' | 'replace'
}

export interface Position {
  x: number
  y: number
}

export interface RobotVacuumState {
  status: 'idle' | 'cleaning' | 'paused' | 'returning' | 'docked' | 'error'
  battery_pct: number
  zone: string | string[] | null
  suction_power: 'quiet' | 'standard' | 'strong' | 'max'
  cleaning_mode: 'auto' | 'zigzag' | 'spot' | 'edge'
  cleaned_area_m2: number
  position: Position
  do_not_disturb: boolean
  error: string | null
}

export interface OvenState {
  power: 'on' | 'off'
  mode: 'bake' | 'grill' | 'convection' | 'steam' | 'microwave'
  target_temp: number
  current_temp: number
  timer_remaining: number
  fan_speed: 'off' | 'low' | 'medium' | 'high'
  steam: 'on' | 'off'
  probe_temp: number
  light: 'on' | 'off'
  door: 'open' | 'closed'
}

export interface LightState {
  power: 'on' | 'off'
  brightness: number
  color: 'white' | 'yellow' | 'blue' | 'red' | 'green'
  color_temperature: number
  scene_name: string | null
}

export interface WashingMachineState {
  power: 'on' | 'off'
  mode: 'standard' | 'delicate' | 'heavy' | 'quick' | 'wool' | 'rinse_spin'
  status: 'stopped' | 'washing' | 'rinsing' | 'spinning' | 'done'
  remaining_time: number
  spin_speed: 'low' | 'medium' | 'high'
  door: 'open' | 'closed'
  water_temperature: number
  reservation_time: string | null
  error: string | null
}

export interface DeviceStates {
  air_conditioner: AirConditionerState
  tv: TVState
  air_purifier: AirPurifierState
  robot_vacuum: RobotVacuumState
  oven: OvenState
  washing_machine: WashingMachineState
  light: LightState
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  source?: string | null
  text: string
  isClarification?: boolean
  contextTrigger?: string
  sessionId?: string | null
  clientId?: string | null
  deviceId?: string | null
  status?: string | null
  mode?: string | null
  timestamp: number | string
}

export interface DialogueLogMessage {
  id: number
  session_id: string | null
  client_id: string | null
  device_id: string | null
  role: 'user' | 'assistant' | 'system'
  source: string | null
  text: string
  status: string | null
  mode: string | null
  clarification_needed: boolean | null
  timestamp: string
}

export interface DialogueRecentResponse {
  messages: DialogueLogMessage[]
}

export interface DialogueWebSocketSnapshot {
  type: 'dialogue_snapshot'
  messages: DialogueLogMessage[]
}

export interface DialogueWebSocketMessage {
  type: 'dialogue_message'
  message: DialogueLogMessage
}

export type DialogueWebSocketPayload =
  | DialogueWebSocketSnapshot
  | DialogueWebSocketMessage