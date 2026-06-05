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
