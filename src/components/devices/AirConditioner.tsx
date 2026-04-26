import type { AirConditionerState } from '../../types'

interface Props {
  state: AirConditionerState
  x?: number
  y?: number
}

export function AirConditioner({ state, x = 0, y = 0 }: Props) {
  const isOn = state.power === 'on'
  const isCool = isOn && state.mode === 'cool'
  const isHeat = isOn && state.mode === 'heat'
  const isDry = isOn && state.mode === 'dry'

  const bodyColor = !isOn ? '#9ca3af' : isCool ? '#3b82f6' : isHeat ? '#f97316' : '#6b7280'
  const glowColor = !isOn ? 'none' : isCool ? '#93c5fd' : isHeat ? '#fed7aa' : '#d1d5db'

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* 메인 본체 */}
      <rect
        x={0} y={0} width={110} height={38} rx={6}
        fill={bodyColor}
        stroke={isOn ? glowColor : '#6b7280'}
        strokeWidth={2}
        filter={isOn ? 'url(#acGlow)' : undefined}
      />
      {/* 전면 패널 */}
      <rect x={6} y={6} width={98} height={26} rx={4} fill={isOn ? '#fff2' : '#fff1'} />

      {/* ON 상태 루버 슬릿 */}
      {isOn && [0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={12} y={10 + i * 4} width={60} height={2} rx={1} fill="#ffffff55" />
      ))}

      {/* 냉방 파동 (아래로) */}
      {isCool && (
        <g>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M${18 + i * 12},38 Q${24 + i * 12},46 ${30 + i * 12},38`}
              fill="none"
              stroke="#93c5fd"
              strokeWidth={2}
              opacity={0.8}
            >
              <animate attributeName="opacity" values="0.8;0.2;0.8" dur={`${1.2 + i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="d"
                values={`M${18+i*12},38 Q${24+i*12},46 ${30+i*12},38;M${18+i*12},42 Q${24+i*12},50 ${30+i*12},42;M${18+i*12},38 Q${24+i*12},46 ${30+i*12},38`}
                dur={`${1.2 + i * 0.3}s`}
                repeatCount="indefinite"
              />
            </path>
          ))}
        </g>
      )}

      {/* 난방 파동 (위로) */}
      {isHeat && (
        <g>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              d={`M${18 + i * 12},0 Q${24 + i * 12},-8 ${30 + i * 12},0`}
              fill="none"
              stroke="#fb923c"
              strokeWidth={2}
              opacity={0.8}
            >
              <animate attributeName="opacity" values="0.8;0.2;0.8" dur={`${1.2 + i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="d"
                values={`M${18+i*12},0 Q${24+i*12},-8 ${30+i*12},0;M${18+i*12},-4 Q${24+i*12},-12 ${30+i*12},-4;M${18+i*12},0 Q${24+i*12},-8 ${30+i*12},0`}
                dur={`${1.2 + i * 0.3}s`}
                repeatCount="indefinite"
              />
            </path>
          ))}
        </g>
      )}

      {/* 제습 물방울 */}
      {isDry && (
        <g>
          {[0, 1, 2].map((i) => (
            <ellipse key={i} cx={22 + i * 16} cy={50} rx={4} ry={6} fill="#93c5fd" opacity={0.7}>
              <animate attributeName="cy" values="38;54;38" dur={`${1 + i * 0.4}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.7;0" dur={`${1 + i * 0.4}s`} repeatCount="indefinite" />
            </ellipse>
          ))}
        </g>
      )}

      {/* 전원 표시 LED */}
      <circle cx={97} cy={10} r={4} fill={isOn ? '#4ade80' : '#374151'} />

      {/* 텍스트 */}
      {isOn && (
        <>
          <text x={70} y={20} fontSize={9} fill="white" textAnchor="middle" fontWeight="bold">
            {state.temperature}°C
          </text>
          <text x={70} y={30} fontSize={7} fill="#ffffffcc" textAnchor="middle">
            {state.fan_speed}
          </text>
        </>
      )}
      {!isOn && (
        <text x={55} y={23} fontSize={9} fill="#d1d5db" textAnchor="middle">에어컨 OFF</text>
      )}

      {/* 라벨 */}
      <text x={55} y={54} fontSize={9} fill="#374151" textAnchor="middle" fontWeight="bold">에어컨</text>

      {/* 글로우 필터 */}
      <defs>
        <filter id="acGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
    </g>
  )
}
