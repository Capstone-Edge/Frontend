import type { TVState } from '../../types'

interface Props {
  state: TVState
  x?: number
  y?: number
}

function getScreenStyle(state: TVState): { bg: string; text: string; label: string } {
  if (state.power === 'off') return { bg: '#111827', text: '#374151', label: 'OFF' }
  const name = (state.content_name || state.channel || '').toLowerCase()
  if (name.includes('netflix')) return { bg: '#e50914', text: 'white', label: 'Netflix' }
  if (name.includes('kbs')) return { bg: '#1d4ed8', text: 'white', label: 'KBS' }
  if (name.includes('mbc')) return { bg: '#15803d', text: 'white', label: 'MBC' }
  if (name.includes('sbs')) return { bg: '#7c3aed', text: 'white', label: 'SBS' }
  return { bg: '#f8fafc', text: '#1e293b', label: state.content_name || state.channel || 'TV' }
}

export function TV({ state, x = 0, y = 0 }: Props) {
  const isOn = state.power === 'on'
  const screen = getScreenStyle(state)

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* TV 외곽 베젤 */}
      <rect x={0} y={0} width={120} height={72} rx={4} fill="#1f2937" stroke="#374151" strokeWidth={2} />

      {/* 화면 */}
      <rect x={5} y={5} width={110} height={58} rx={2} fill={screen.bg}>
        {isOn && (
          <animate attributeName="opacity" values="1;0.95;1" dur="3s" repeatCount="indefinite" />
        )}
      </rect>

      {/* 화면 내용 */}
      {isOn ? (
        <>
          <text x={60} y={32} fontSize={14} fill={screen.text} textAnchor="middle" fontWeight="bold">
            {screen.label}
          </text>
          {state.content_name && state.content_name !== screen.label && (
            <text x={60} y={48} fontSize={8} fill={screen.text} textAnchor="middle" opacity={0.8}>
              {state.content_name}
            </text>
          )}
        </>
      ) : (
        <text x={60} y={38} fontSize={11} fill={screen.text} textAnchor="middle">■</text>
      )}

      {/* 받침대 */}
      <rect x={50} y={72} width={20} height={8} rx={2} fill="#374151" />
      <rect x={38} y={80} width={44} height={4} rx={2} fill="#4b5563" />

      {/* 전원 LED */}
      <circle cx={60} cy={68} r={3} fill={isOn ? '#60a5fa' : '#374151'}>
        {isOn && (
          <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
        )}
      </circle>

      {/* 라벨 */}
      <text x={60} y={96} fontSize={9} fill="#374151" textAnchor="middle" fontWeight="bold">TV</text>
    </g>
  )
}
