import type { AirPurifierState } from '../../types'

interface Props {
  state: AirPurifierState
  x?: number
  y?: number
}

const MODE_COLORS: Record<string, string> = {
  auto: '#22c55e',
  quiet: '#86efac',
  standard: '#4ade80',
  strong: '#16a34a',
  turbo: '#15803d',
}

export function AirPurifier({ state, x = 0, y = 0 }: Props) {
  const isOn = state.power === 'on'
  const bodyColor = isOn ? (MODE_COLORS[state.mode] || '#22c55e') : '#9ca3af'

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* 파동 원 (켜진 경우) */}
      {isOn && [1, 2, 3].map((i) => (
        <ellipse key={i} cx={25} cy={45} rx={25 + i * 12} ry={20 + i * 10} fill="none" stroke={bodyColor} strokeWidth={1.5}>
          <animate attributeName="opacity" values={`${0.6 / i};0;${0.6 / i}`} dur={`${1.5 + i * 0.5}s`} repeatCount="indefinite" />
          <animate attributeName="rx" values={`${20 + i * 8};${28 + i * 10};${20 + i * 8}`} dur={`${1.5 + i * 0.5}s`} repeatCount="indefinite" />
          <animate attributeName="ry" values={`${15 + i * 6};${22 + i * 8};${15 + i * 6}`} dur={`${1.5 + i * 0.5}s`} repeatCount="indefinite" />
        </ellipse>
      ))}

      {/* 본체 (캡슐) */}
      <rect x={5} y={0} width={40} height={90} rx={20} fill={bodyColor} stroke={isOn ? '#16a34a' : '#6b7280'} strokeWidth={2} />

      {/* 상단 그릴 */}
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={11} y={12 + i * 5} width={28} height={2} rx={1} fill={isOn ? '#ffffff55' : '#ffffff33'} />
      ))}

      {/* 중앙 팬 표시 */}
      <circle cx={25} cy={50} r={12} fill={isOn ? '#ffffff33' : '#ffffff11'} />
      {isOn && (
        <g transform={`translate(25, 50)`}>
          <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="2s" repeatCount="indefinite" additive="sum" />
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <line key={angle} x1={0} y1={0} x2={0} y2={-9}
              stroke="white" strokeWidth={2} strokeLinecap="round"
              transform={`rotate(${angle})`}
            />
          ))}
        </g>
      )}

      {/* 하단 그릴 */}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={11} y={68 + i * 5} width={28} height={2} rx={1} fill={isOn ? '#ffffff55' : '#ffffff33'} />
      ))}

      {/* 전원 LED */}
      <circle cx={25} cy={84} r={3} fill={isOn ? '#4ade80' : '#374151'} />

      {/* 모드 텍스트 */}
      {isOn && (
        <text x={25} y={100} fontSize={8} fill="#15803d" textAnchor="middle" fontWeight="bold">
          {state.mode}
        </text>
      )}

      {/* 라벨 */}
      <text x={25} y={isOn ? 110 : 102} fontSize={9} fill="#374151" textAnchor="middle" fontWeight="bold">
        공기청정기
      </text>
    </g>
  )
}
