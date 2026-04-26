import { useState, useEffect, useRef } from 'react'
import type { RobotVacuumState } from '../../types'

export interface Obstacle {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  state: RobotVacuumState
  x?: number
  y?: number
  obstacles?: Obstacle[]
}

// 거실 테두리 순환 경로 (1000×1045 좌표계, 거실 추정 영역 x=520~920 y=340~900, 벽에서 20px 여유)
const WAYPOINTS = [
  { x: 540, y: 365 }, // 거실 상단-좌
  { x: 890, y: 365 }, // 거실 상단-우
  { x: 890, y: 870 }, // 거실 하단-우
  { x: 540, y: 870 }, // 거실 하단-좌
]

// 원-사각형 충돌 검사 (robot center = pos + (28,28), r=24)
function isBlocked(wp: { x: number; y: number }, obstacles: Obstacle[]): boolean {
  const cx = wp.x + 28
  const cy = wp.y + 28
  const r = 24
  return obstacles.some((o) => {
    const nearX = Math.max(o.x, Math.min(cx, o.x + o.w))
    const nearY = Math.max(o.y, Math.min(cy, o.y + o.h))
    return Math.hypot(cx - nearX, cy - nearY) < r
  })
}

function getZoneLabel(zone: RobotVacuumState['zone']): string {
  if (!zone) return ''
  if (Array.isArray(zone)) return zone.join(', ')
  if (zone === 'all') return '전체'
  const map: Record<string, string> = {
    living_room: '거실', kitchen: '주방', bedroom: '침실', bathroom: '화장실'
  }
  return map[zone] || zone
}

export function RobotVacuum({ state, x = 0, y = 0, obstacles = [] }: Props) {
  const [pos, setPos] = useState({ x, y })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wpIndexRef = useRef(0)

  const isCleaning = state.action === 'cleaning'
  const isDocked = state.action === 'docked'
  const isReturning = state.action === 'returning'

  useEffect(() => {
    const clearPending = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    if (state.action === 'cleaning') {
      // 첫 번째 비충돌 waypoint로 즉시 이동
      wpIndexRef.current = 0
      setPos(WAYPOINTS[0])

      // setTimeout 체이닝: 각 이동(2s) 후 다음 waypoint 예약
      const scheduleNext = (currentIndex: number) => {
        timeoutRef.current = setTimeout(() => {
          let nextIndex = (currentIndex + 1) % WAYPOINTS.length
          let attempts = 0

          // 충돌하는 waypoint 스킵
          while (isBlocked(WAYPOINTS[nextIndex], obstacles) && attempts < WAYPOINTS.length) {
            nextIndex = (nextIndex + 1) % WAYPOINTS.length
            attempts++
          }

          // 모든 waypoint가 막혀 있으면 정지
          if (attempts >= WAYPOINTS.length) return

          wpIndexRef.current = nextIndex
          setPos(WAYPOINTS[nextIndex])
          scheduleNext(nextIndex)
        }, 2000)
      }
      scheduleNext(0)

      return clearPending
    }

    if (state.action === 'paused') {
      // 현재 위치 고정, 예약 취소
      clearPending()
      return
    }

    if (state.action === 'idle' || state.action === 'docked') {
      clearPending()
      wpIndexRef.current = 0
      setPos({ x, y })
    }
  }, [state.action, x, y]) // obstacles는 정적이므로 dep 제외

  const bodyColor = isCleaning ? '#3b82f6' : isDocked ? '#22c55e' : '#9ca3af'
  const strokeColor = isCleaning ? '#93c5fd' : isDocked ? '#4ade80' : '#6b7280'

  const gStyle: React.CSSProperties = {
    transform: `translate(${pos.x}px, ${pos.y}px)`,
    transition: isCleaning
      ? 'transform 2s linear'
      : 'transform 0.8s ease-out',
  }

  return (
    <g style={gStyle}>
      {/* 테두리 회전 (청소 중) */}
      {isCleaning && (
        <circle cx={28} cy={28} r={27} fill="none" stroke="#93c5fd" strokeWidth={3}
          strokeDasharray="20 10">
          <animateTransform attributeName="transform" type="rotate"
            from="0 28 28" to="360 28 28" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* 본체 원 */}
      <circle cx={28} cy={28} r={24} fill={bodyColor} stroke={strokeColor} strokeWidth={2} />

      {/* 상단 범퍼 */}
      <path d="M10,14 Q28,4 46,14" fill="none"
        stroke={isReturning ? '#fbbf24' : '#ffffff55'} strokeWidth={4} strokeLinecap="round" />

      {/* 중앙 센서 */}
      <circle cx={28} cy={28} r={6} fill="#ffffff33" />
      <circle cx={28} cy={28} r={3} fill={bodyColor === '#9ca3af' ? '#6b7280' : 'white'} />

      {/* 충전 번개 (독 상태) */}
      {isDocked && (
        <text x={28} y={34} fontSize={16} textAnchor="middle" fill="white">⚡</text>
      )}

      {/* 복귀 중 화살표 */}
      {isReturning && (
        <text x={28} y={34} fontSize={14} textAnchor="middle" fill="white">↩</text>
      )}

      {/* 청소 중 스핀 점 */}
      {isCleaning && [0, 72, 144, 216, 288].map((angle, i) => {
        const rad = (angle - 90) * Math.PI / 180
        const cx = 28 + 16 * Math.cos(rad)
        const cy = 28 + 16 * Math.sin(rad)
        return (
          <circle key={i} cx={cx} cy={cy} r={2.5} fill="white" opacity={0.6}>
            <animate attributeName="opacity"
              values={`${0.2 + i * 0.15};0.9;${0.2 + i * 0.15}`}
              dur="1.5s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
          </circle>
        )
      })}

      {/* 구역 텍스트 */}
      {isCleaning && state.zone && (
        <text x={28} y={64} fontSize={8} fill="#1d4ed8" textAnchor="middle" fontWeight="bold">
          {getZoneLabel(state.zone)}
        </text>
      )}

      {/* 라벨 */}
      <text x={28} y={isCleaning && state.zone ? 74 : 64}
        fontSize={9} fill="#374151" textAnchor="middle" fontWeight="bold">
        로봇청소기
      </text>

      {/* 상태 텍스트 */}
      <text x={28} y={isCleaning && state.zone ? 84 : 74}
        fontSize={8} fill="#6b7280" textAnchor="middle">
        {isCleaning ? '청소 중' : isDocked ? '충전 중' : isReturning ? '복귀 중'
          : state.action === 'paused' ? '일시정지' : '대기'}
      </text>
    </g>
  )
}
