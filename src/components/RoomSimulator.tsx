import { useEffect, useRef, useState } from 'react'
import { useDeviceStore } from '../store/deviceStore'
import { TV } from './devices/TV'
import { AirConditioner } from './devices/AirConditioner'
import { AirPurifier } from './devices/AirPurifier'

/* ─── 타입 ────────────────────────────────────────────── */

type RoomId =
  | 'living_room' | 'hallway' | 'family_room'
  | 'bedroom1' | 'bedroom3' | 'bedroom4'
  | 'bathroom' | 'bathroom2' | 'dressing_room'

interface Pt { x: number; y: number }
interface RoomDef {
  doors: Partial<Record<RoomId, Pt>>
}

/* ─── 실제 SVG 벽/문 기준 방 정의 ───────────────────────
 *
 * floorplan.svg 실제 레이아웃 (viewBox 920x470):
 *   욕실:      x=30~138,  y=30~86
 *   드레스룸:  x=138~213, y=30~86
 *   침실1:     x=30~174,  y=86~340
 *   복도:      x=174~549, y=86~196
 *   침실3:     x=174~294, y=196~340
 *   침실4:     x=294~469, y=196~340
 *   욕실2:     x=422~469, y=196~258
 *   가족실:    x=469~549, y=196~340
 *   거실:      x=549~891, y=30~379
 *
 * 실제 문 위치:
 *   y=86,  x=52~76   → 욕실 ↔ 침실1  (center x=64)
 *   y=86,  x=148~168 → 드레스룸 ↔ 침실1 (center x=158)
 *   x=174, y=148~172 → 침실1 ↔ 복도 (center y=160)
 *   y=196, x=200~224 → 복도 ↔ 침실3 (center x=212)
 *   y=196, x=316~340 → 복도 ↔ 침실4 (center x=328)
 *   y=196, x=432~456 → 복도 ↔ 욕실2 (center x=444)
 */

const ROOMS: Record<RoomId, RoomDef> = {
  living_room: {
    doors: {
      hallway:     { x: 560, y: 130 },
      family_room: { x: 560, y: 270 },
    },
  },
  hallway: {
    doors: {
      bedroom1:    { x: 185, y: 160 },
      bedroom3:    { x: 212, y: 185 },
      bedroom4:    { x: 328, y: 185 },
      bathroom2:   { x: 444, y: 185 },
      family_room: { x: 510, y: 185 },
      living_room: { x: 538, y: 130 },
    },
  },
  bedroom1: {
    doors: {
      bathroom:      { x: 64,  y: 97  },
      dressing_room: { x: 158, y: 97  },
      hallway:       { x: 163, y: 160 },
    },
  },
  bathroom: {
    doors: { bedroom1: { x: 64, y: 75 } },
  },
  dressing_room: {
    doors: { bedroom1: { x: 158, y: 75 } },
  },
  bedroom3: {
    doors: { hallway: { x: 212, y: 207 } },
  },
  bedroom4: {
    doors: { hallway: { x: 328, y: 207 } },
  },
  bathroom2: {
    doors: { hallway: { x: 444, y: 185 } },
  },
  family_room: {
    doors: {
      hallway:     { x: 510, y: 207 },
      living_room: { x: 538, y: 270 },
    },
  },
}

/* ─── 나선형 청소 영역 (벽에서 15px 여유) ─────────────────
 *
 * 각 방의 청소 가능 직사각형 영역 (벽면 15px 마진 적용):
 *   living_room:   x=564~876, y=45~364  (w=312, h=319)
 *   hallway:       x=189~534, y=101~181 (w=345, h=80)
 *   bedroom1:      x=45~159,  y=101~325 (w=114, h=224)
 *   bedroom3:      x=189~279, y=211~325 (w=90,  h=114)
 *   bedroom4:      x=309~407, y=211~325 (w=98,  h=114)  ← 욕실2(x=422~) 제외
 *   bathroom:      x=45~123,  y=45~71   (w=78,  h=26)
 *   dressing_room: x=153~198, y=45~71   (w=45,  h=26)
 *   family_room:   x=484~534, y=211~325 (w=50,  h=114) ← 도킹 위치
 *   bathroom2:     x=437~454, y=211~243 (w=17,  h=32)  ← step 미만, 중심점만
 */

const SPIRAL_BOUNDS: Partial<Record<RoomId, { x: number; y: number; w: number; h: number }>> = {
  living_room:   { x: 564, y:  45, w: 312, h: 319 },
  hallway:       { x: 189, y: 101, w: 345, h:  80 },
  bedroom1:      { x:  45, y: 101, w: 114, h: 224 },
  bedroom3:      { x: 189, y: 211, w:  90, h: 114 },
  bedroom4:      { x: 309, y: 211, w:  98, h: 114 },  // 오른쪽 경계 x=407 (욕실2 x=422에서 15px 여유)
  bathroom:      { x:  45, y:  45, w:  78, h:  26 },
  dressing_room: { x: 153, y:  45, w:  45, h:  26 },
  family_room:   { x: 484, y: 211, w:  50, h: 114 },
  bathroom2:     { x: 437, y: 211, w:  17, h:  32 },
}

/* ─── zone → 방 매핑 ──────────────────────────────────── */

const ZONE_ROOMS: Record<string, RoomId[]> = {
  living_room:   ['living_room'],
  kitchen:       ['living_room'],
  bedroom:       ['bedroom1', 'bedroom3', 'bedroom4'],
  bathroom:      ['bathroom', 'bathroom2'],
  dressing_room: ['dressing_room'],
  hallway:       ['hallway'],
  family_room:   ['family_room'],
  all: [
    'living_room', 'hallway', 'family_room',
    'bedroom1', 'bedroom3', 'bedroom4',
    'bathroom', 'bathroom2', 'dressing_room',
  ],
}

/** 청소 순서 (거실→복도→침실→욕실 순) */
const CLEAN_ORDER: RoomId[] = [
  'living_room', 'hallway',
  'bedroom1', 'bedroom3', 'bedroom4',
  'bathroom', 'dressing_room', 'family_room', 'bathroom2',
]

const DOCK: Pt = { x: 480, y: 314 }

/* ─── 유틸 함수 ────────────────────────────────────────── */

function clampToHouse(pt: Pt): Pt {
  const { x, y } = pt
  if (x >= 549) {
    return { x: Math.max(551, Math.min(889, x)), y: Math.max(32, Math.min(377, y)) }
  }
  return { x: Math.max(32, Math.min(547, x)), y: Math.max(32, Math.min(406, y)) }
}

function getRoomIds(zone: string | string[] | null): RoomId[] {
  if (!zone || zone === 'all') return ZONE_ROOMS.all
  if (Array.isArray(zone)) {
    return [...new Set(zone.flatMap(z => ZONE_ROOMS[z] ?? [z as RoomId]))]
  }
  return ZONE_ROOMS[zone] ?? [zone as RoomId]
}

function detectRoom(x: number, y: number): RoomId | null {
  if (x >= 30  && x <= 138 && y >= 30  && y <= 86 ) return 'bathroom'
  if (x >= 138 && x <= 213 && y >= 30  && y <= 86 ) return 'dressing_room'
  if (x >= 422 && x <= 469 && y >= 196 && y <= 258) return 'bathroom2'
  if (x >= 469 && x <= 549 && y >= 196 && y <= 340) return 'family_room'
  if (x >= 174 && x <= 294 && y >= 196 && y <= 340) return 'bedroom3'
  if (x >= 294 && x <= 469 && y >= 196 && y <= 340) return 'bedroom4'
  if (x >= 30  && x <= 174 && y >= 86  && y <= 340) return 'bedroom1'
  if (x >= 174 && x <= 549 && y >= 86  && y <= 196) return 'hallway'
  if (x >= 549 && x <= 891 && y >= 30  && y <= 379) return 'living_room'
  return null
}

function findRoomPath(from: RoomId, to: RoomId): RoomId[] {
  if (from === to) return [from]
  const visited = new Set<RoomId>([from])
  const queue: RoomId[][] = [[from]]
  while (queue.length > 0) {
    const path = queue.shift()!
    const cur = path[path.length - 1]
    for (const nb of Object.keys(ROOMS[cur]?.doors ?? {}) as RoomId[]) {
      if (nb === to) return [...path, nb]
      if (!visited.has(nb)) {
        visited.add(nb)
        queue.push([...path, nb])
      }
    }
  }
  return [from, to]
}

function buildPath(fromRoom: RoomId | null, toRoom: RoomId, target: Pt): Pt[] {
  if (!fromRoom || fromRoom === toRoom) return [target]
  const roomPath = findRoomPath(fromRoom, toRoom)
  const pts: Pt[] = []
  for (let i = 0; i < roomPath.length - 1; i++) {
    const cur  = roomPath[i]
    const next = roomPath[i + 1]
    const exitPt  = ROOMS[cur]?.doors[next]
    const entryPt = ROOMS[next]?.doors[cur]
    if (exitPt)  pts.push(clampToHouse(exitPt))
    if (entryPt) pts.push(clampToHouse(entryPt))
  }
  pts.push(clampToHouse(target))
  return pts
}

/**
 * 나선형 경로 생성 (반시계방향 인워드 스파이럴)
 *   좌상 → 좌하 → 우하 → 우상 → 한 칸 안쪽 → 반복
 *   width 또는 height < step 이면 종료
 */
function generateSpiralPath(x: number, y: number, w: number, h: number, step = 20): Pt[] {
  const pts: Pt[] = []
  let cx = x, cy = y, cw = w, ch = h

  while (cw >= step && ch >= step) {
    pts.push({ x: cx,       y: cy      })  // 좌상
    pts.push({ x: cx,       y: cy + ch })  // 좌하
    pts.push({ x: cx + cw,  y: cy + ch })  // 우하
    pts.push({ x: cx + cw,  y: cy      })  // 우상

    cx += step
    cy += step
    cw -= 2 * step
    ch -= 2 * step
  }

  // 남은 공간이 있으면 중심점 추가
  if (cw > 0 && ch > 0) {
    pts.push({ x: Math.round(cx + cw / 2), y: Math.round(cy + ch / 2) })
  }

  return pts
}

/**
 * zone에 해당하는 방들을 CLEAN_ORDER 순으로 정렬하여 반환
 */
function getCleaningOrder(zone: string | string[] | null): RoomId[] {
  const roomIds = getRoomIds(zone)
  return CLEAN_ORDER.filter(r => roomIds.includes(r))
}

/**
 * 청소 대상 방들의 전체 나선형 경로 생성
 *   방 간 이동은 문(door) 경유 경로, 각 방 내부는 나선형 sweep
 */
function buildSpiralCleaningPath(rooms: RoomId[], startRoom: RoomId | null): Pt[] {
  const allPts: Pt[] = []
  let prevRoom = startRoom

  for (const roomId of rooms) {
    const b = SPIRAL_BOUNDS[roomId]
    if (!b) continue

    if (b.w < 20 || b.h < 20) {
      // 너무 작은 방: 중심점만 방문
      const center: Pt = { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) }
      allPts.push(...buildPath(prevRoom, roomId, center))
      prevRoom = roomId
      continue
    }

    const spiralPts = generateSpiralPath(b.x, b.y, b.w, b.h)
    if (spiralPts.length === 0) continue

    // 첫 나선 waypoint까지 이동 (문 경유)
    allPts.push(...buildPath(prevRoom, roomId, spiralPts[0]))
    // 나선 나머지 waypoint 추가
    allPts.push(...spiralPts.slice(1))

    prevRoom = roomId
  }

  return allPts
}

/* ─── 컴포넌트 ────────────────────────────────────────── */

export function RoomSimulator() {
  const { air_conditioner: ac, tv, air_purifier: ap, robot_vacuum: rv } =
    useDeviceStore((s) => s.devices)

  const rvBg =
    rv.action === 'cleaning'  ? '#3b82f6' :
    rv.action === 'docked'    ? '#22c55e' :
    rv.action === 'returning' ? '#fbbf24' : '#94a3b8'

  const [rvPos, setRvPos]    = useState<Pt>(DOCK)
  const currentRoomRef       = useRef<RoomId | null>('family_room')
  const pathRef              = useRef<Pt[]>([])
  const timerRef             = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rvRef                = useRef(rv)
  useEffect(() => { rvRef.current = rv })

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    /** 나선 청소 완료 → 백엔드에 복귀 명령 전송 */
    const triggerReturnToDock = () => {
      fetch('/api/v1/command/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: 'robot_vacuum', parameters: { action: 'return_to_dock' } }),
      }).catch(() => {})
    }

    /** 나선 waypoint 순서대로 이동, 완료 시 자동 복귀 */
    const cleanStep = () => {
      if (rvRef.current.action !== 'cleaning') return

      if (pathRef.current.length > 0) {
        const next = clampToHouse(pathRef.current.shift()!)
        setRvPos(next)
        currentRoomRef.current = detectRoom(next.x, next.y) ?? currentRoomRef.current
        timerRef.current = setTimeout(cleanStep, 800)
      } else {
        // 모든 waypoint 완료 → 도킹스테이션으로 자동 복귀
        triggerReturnToDock()
      }
    }

    /** 도킹스테이션으로 복귀 */
    const returnToDock = () => {
      const dockRoom = detectRoom(DOCK.x, DOCK.y) ?? 'family_room'
      pathRef.current = buildPath(currentRoomRef.current, dockRoom, DOCK)
      const dockStep = () => {
        if (pathRef.current.length > 0) {
          const next = clampToHouse(pathRef.current.shift()!)
          setRvPos(next)
          currentRoomRef.current = detectRoom(next.x, next.y) ?? currentRoomRef.current
          timerRef.current = setTimeout(dockStep, 800)
        } else {
          setRvPos(DOCK)
          currentRoomRef.current = 'family_room'
        }
      }
      dockStep()
    }

    clear()
    pathRef.current = []

    if (rv.action === 'cleaning') {
      const startRoom = detectRoom(rvPos.x, rvPos.y) ?? 'family_room'
      currentRoomRef.current = startRoom
      const rooms = getCleaningOrder(rv.zone)
      pathRef.current = buildSpiralCleaningPath(rooms, startRoom)
      timerRef.current = setTimeout(cleanStep, 300)
    } else if (rv.action === 'returning' || rv.action === 'docked') {
      returnToDock()
    }

    return clear
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rv.action, rv.zone])

  /* ── SVG 렌더 ─────────────────────────────────────────── */
  return (
    <svg viewBox="0 0 920 470" width="100%" style={{ display: 'block' }}>
      <image href="/floorplan.svg" width="920" height="470" />

      {/* ── 에어컨 ── */}
      <g transform="translate(625, 43) scale(0.56)">
        <AirConditioner state={ac} />
      </g>

      {/* ── TV ── */}
      <g transform="translate(690, 43) scale(0.57)">
        <TV state={tv} />
      </g>

      {/* ── 소파(메인) ── */}
      <g style={{ cursor: 'default' }}>
        <title>소파</title>
        <rect x="630" y="220" width="110" height="38" rx="4"
          fill="#c8b8a0" stroke="#a09080" strokeWidth="1.5" />
        <text x="685" y="268" fontSize="8" fill="#555" textAnchor="middle">소파</text>
      </g>

      {/* ── 소파2(사이드) ── */}
      <g style={{ cursor: 'default' }}>
        <title>소파</title>
        <rect x="750" y="180" width="38" height="90" rx="4"
          fill="#c8b8a0" stroke="#a09080" strokeWidth="1.5" />
        <text x="769" y="282" fontSize="8" fill="#555" textAnchor="middle">소파2</text>
      </g>

      {/* ── 커피테이블 ── */}
      <g style={{ cursor: 'default' }}>
        <title>커피테이블</title>
        <rect x="660" y="155" width="60" height="40" rx="2"
          fill="#d4c4a0" stroke="#a09070" strokeWidth="1" />
        <text x="690" y="205" fontSize="8" fill="#555" textAnchor="middle">커피테이블</text>
      </g>

      {/* ── 공기청정기 ── */}
      <g transform="translate(850, 162) scale(0.42)">
        <AirPurifier state={ap} />
      </g>

      {/* ── 세탁기 (실외기실) ── */}
      <g style={{ cursor: 'default' }}>
        <title>세탁기</title>
        <rect x="45" y="358" width="24" height="22" rx="3"
          fill="#ddd" stroke="#aaa" strokeWidth="1" />
        <circle cx="57" cy="369" r="7" fill="#f0f0f0" stroke="#999" strokeWidth="1.5" />
        <text x="57" y="390" fontSize="7" fill="#555" textAnchor="middle">세탁기</text>
      </g>

      {/* ── 도킹스테이션 ── */}
      <g style={{ cursor: 'default' }}>
        <title>도킹스테이션</title>
        <rect x="470" y="310" width="20" height="8" rx="2" fill="#4a90d9" />
        <text x="480" y="328" fontSize="8" fill="#555" textAnchor="middle">도킹</text>
      </g>

      {/* ── 거실 레이블 ── */}
      <text
        x="720" y="165"
        fontSize="20" fontWeight="500" fill="#7d6608"
        textAnchor="middle" style={{ pointerEvents: 'none' }}
      >거  실</text>

      {/* ── 로봇청소기 ── */}
      <g
        transform={`translate(${rvPos.x}, ${rvPos.y})`}
        style={{ transition: 'transform 0.8s linear', cursor: 'default' }}
      >
        <title>{`로봇청소기 ${
          rv.action === 'cleaning'  ? '청소 중'  :
          rv.action === 'docked'    ? '충전 중'  :
          rv.action === 'returning' ? '복귀 중'  :
          rv.action === 'paused'    ? '일시정지' : '대기'
        }${rv.action === 'cleaning' && rv.zone
          ? ` (${Array.isArray(rv.zone) ? rv.zone.join(', ') : rv.zone})` : ''
        }`}</title>

        {rv.action === 'cleaning' && (
          <circle r="11" fill="none" stroke="#93c5fd" strokeWidth="2" strokeDasharray="8 4">
            <animateTransform attributeName="transform" type="rotate"
              from="0 0 0" to="360 0 0" dur="2s" repeatCount="indefinite" />
          </circle>
        )}

        <circle r="8" fill={rvBg} stroke="#2563eb" strokeWidth="1.5"
          style={{ transition: 'fill 0.4s' }} />

        {rv.action === 'docked' && (
          <text y="3" fontSize="7" fill="white" textAnchor="middle">⚡</text>
        )}
        {rv.action === 'returning' && (
          <text y="3" fontSize="7" fill="white" textAnchor="middle">↩</text>
        )}

        <text y="20" fontSize="7" fill="#334155" textAnchor="middle">로봇</text>
      </g>
    </svg>
  )
}
