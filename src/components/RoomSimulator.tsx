import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html, Bounds } from '@react-three/drei'
import * as THREE from 'three'
import { useDeviceStore } from '../store/deviceStore'
import type { RobotVacuumState, TVState } from '../types'

/* ─── 타입 ────────────────────────────────────────────── */

// Pt: {x, y} — x = world X, y = world Z (3D 세계 좌표 직접 사용)
interface Pt { x: number; y: number }

interface HoveredInfo {
  name: string
  parentName: string
  position: THREE.Vector3
  size: THREE.Vector3
}

/* ─── 구역 기반 경로 계획 (3D 세계 좌표) ──────────────────── */

// 도킹 스테이션 3D 위치 (GLB 실측)
const DOCK: Pt = { x: 459.92, y: -14.81 }

// 구역 폴리곤: [worldX, worldZ][] — 확정 좌표 그대로 사용
const SECTOR_POLYS: Record<string, [number, number][]> = {
  주방:  [[456.3,-16.5],[459.6,-16.5],[459.6,-14.80],[458.45,-14.80],[458.45,-15.5],[456.3,-15.5]],
  세탁실: [[459.75,-17.2],[460.9,-17.2],[460.9,-15.3],[459.75,-15.3]],
  침실3: [[462.8,-17],[465.4,-17],[465.4,-16.4],[464,-16.4],[464,-15],[465.4,-15],[465.4,-14.1],[463.5,-14.1],[463.5,-13.5],[462.8,-13.5]],
  거실:  [[456.3,-14.7],[462.5,-14.7],[462.5,-13.5],[466,-13.5],[466,-11.4],[462.6,-11.4],[462.6,-10.2],[459.4,-10.2],[459.4,-11.4],[456.3,-11.4]],
  침실1: [[462.7,-11.1],[466,-11.1],[466,-10],[465.3,-10],[465.3,-8.1],[462.7,-8.1]],
  침실2: [[456.3,-11.1],[459.3,-11.1],[459.3,-8.1],[458.7,-8.1],[458.7,-9.8],[457.2,-9.8],[457.2,-8.1],[456.3,-8.1]],
}

// 문 중심점 (구역 간 이동 경유)
const DOORS: Record<string, Pt> = {
  '주방-거실':   { x: 459.1,   y: -14.80 },
  '주방-세탁실': { x: 459.675, y: -16.2  },
  '침실2-거실':  { x: 459.35,  y: -10.75 },
  '침실1-거실':  { x: 462.65,  y: -10.75 },
  '침실3-거실':  { x: 463.15,  y: -13.5  },
}

// 구역 인접 그래프
const SECTOR_GRAPH: Record<string, string[]> = {
  주방:  ['거실', '세탁실'],
  거실:  ['주방', '침실1', '침실2', '침실3'],
  세탁실: ['주방'],
  침실1: ['거실'],
  침실2: ['거실'],
  침실3: ['거실'],
}

// NLU zone 문자열 → 실제 구역명
const ZONE_SECTORS: Record<string, string[]> = {
  living_room: ['거실'],
  kitchen:     ['주방'],
  laundry:     ['세탁실'],
  bedroom:     ['침실1', '침실2', '침실3'],
  bedroom1:    ['침실1'],
  bedroom2:    ['침실2'],
  bedroom3:    ['침실3'],
  all:         ['거실', '침실1', '침실2', '침실3', '주방', '세탁실'],
}

const CLEAN_ORDER_SECTORS = ['거실', '침실1', '침실2', '침실3', '주방', '세탁실']

// 가구 장애물 — bounding box 실측 기반, r = max(size.x, size.z)/2 + 여유
// DE_001_007* 는 문 패널(얇음) 또는 섹터 밖이므로 제외
const OBSTACLES: { x: number; z: number; r: number }[] = [
  { x: 456.66, z: -16.23, r: 0.35 }, // Plane016_3    size 0.61×0.61
  // Plane011 제외: y=0.89(높이 82cm) 카운터 상판 → 로봇이 하부 통과 가능
  { x: 460.60, z: -16.87, r: 0.40 }, // WashingMachine size 0.64×0.69
  { x: 465.62, z: -16.77, r: 0.30 }, // Rectangle010005 size 0.37×0.55
  { x: 465.45, z: -16.03, r: 1.10 }, // Rectangle010004 size 2.03×1.52 (장롱)
  { x: 465.62, z: -14.61, r: 0.30 }, // Rectangle010001 size 0.37×0.55
  { x: 459.88, z: -13.39, r: 0.97 }, // Cristalo004   size 1.88×1.90
  { x: 460.99, z: -13.19, r: 0.50 }, // table_3_object size 0.91×0.54
  { x: 461.17, z: -12.14, r: 1.30 }, // Cristalo001   size 2.57×2.52
  { x: 464.39, z: -11.62, r: 1.38 }, // Component#262 size 2.70×2.66
  { x: 457.94, z:  -8.80, r: 1.10 }, // default002002 size 1.73×2.12
  { x: 456.81, z:  -7.93, r: 0.35 }, // Side_Table001 size 0.59×0.48
  { x: 459.03, z:  -7.93, r: 0.35 }, // Side_Table005 size 0.59×0.48
  { x: 464.03, z:  -8.58, r: 0.28 }, // Bed_nightstand001 size 0.47×0.39
  { x: 463.87, z:  -8.58, r: 0.28 }, // Bed_nightstand002 size 0.47×0.39
  { x: 463.92, z:  -8.74, r: 1.00 }, // Bed_nightstand size 1.82×1.98 (침대 본체)
]

// 직사각형 장애물 — 얇은 벽처럼 x/z 범위 직접 지정
const RECT_OBSTACLES: { x0: number; x1: number; z0: number; z1: number }[] = [
  { x0: 463.63, x1: 463.73, z0: -13.5, z1: -13.1 }, // 커스텀 벽 (x=463.68, z=-13.5~-13.1)
]

function isNearObstacle(x: number, z: number): boolean {
  if (OBSTACLES.some(o => {
    const dx = x - o.x, dz = z - o.z
    return dx * dx + dz * dz < o.r * o.r
  })) return true
  return RECT_OBSTACLES.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)
}

// 문 위치 반경 — 섹터 경계 틈새를 메워서 BFS가 문을 통과할 수 있게 함
const DOOR_RADIUS = 0.4

function isNearAnyDoor(x: number, z: number): boolean {
  return Object.values(DOORS).some(d => {
    const dx = x - d.x, dz = z - d.y
    return dx * dx + dz * dz < DOOR_RADIUS * DOOR_RADIUS
  })
}

// 어떤 구역 폴리곤 안에 있거나 문 근처면 이동 가능 (벽 통과 방지)
function isInAnyRoom(x: number, z: number): boolean {
  return Object.values(SECTOR_POLYS).some(poly => pointInPolygon(x, z, poly))
    || isNearAnyDoor(x, z)
}

/* ─── 유틸 ────────────────────────────────────────────── */

// Ray-casting 방식 폴리곤 포함 판단
function pointInPolygon(px: number, pz: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi)
      inside = !inside
  }
  return inside
}

// 현재 3D 좌표가 속한 구역명 반환
function detectSector(x: number, z: number): string | null {
  for (const [name, poly] of Object.entries(SECTOR_POLYS)) {
    if (pointInPolygon(x, z, poly)) return name
  }
  return null
}

// zone 문자열 → 구역명 배열
function getSectorNames(zone: string | string[] | null): string[] {
  if (!zone || zone === 'all') return CLEAN_ORDER_SECTORS
  if (Array.isArray(zone)) return [...new Set(zone.flatMap(z => ZONE_SECTORS[z] ?? [z]))]
  return ZONE_SECTORS[zone] ?? [zone]
}

// 청소 순서에 맞게 필터링
function getCleaningOrder(zone: string | string[] | null): string[] {
  const names = getSectorNames(zone)
  return CLEAN_ORDER_SECTORS.filter(s => names.includes(s))
}

// 두 점 사이를 step 간격으로 보간
function interpolatePath(from: Pt, to: Pt, step = 0.25): Pt[] {
  const dx = to.x - from.x, dz = to.y - from.y
  const dist = Math.sqrt(dx * dx + dz * dz)
  if (dist <= step) return [to]
  const n = Math.ceil(dist / step)
  const pts: Pt[] = []
  for (let i = 1; i <= n; i++) pts.push({ x: from.x + dx * i / n, y: from.y + dz * i / n })
  return pts
}

// 장애물 우회 경로 — BFS 격자 탐색
// 직선 경로가 장애물을 통과하면 옆으로 돌아가는 경로를 반환
const _PSTEP = 0.10                                     // 격자 0.10m → 좁은 통로 탐색 가능
const _GX0 = 455.0
const _GZ0 = -18.0
const _GX_MAX = Math.ceil((467 - _GX0) / _PSTEP) + 2  // ~122
const _GZ_MAX = Math.ceil((-7  - _GZ0) / _PSTEP) + 2  // ~112
const _DIRS8: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]

function _wToG(x: number, z: number): [number, number] {
  return [Math.round((x - _GX0) / _PSTEP), Math.round((z - _GZ0) / _PSTEP)]
}
function _gToW(gx: number, gz: number): Pt {
  return { x: _GX0 + gx * _PSTEP, y: _GZ0 + gz * _PSTEP }
}
function _inBounds(gx: number, gz: number): boolean {
  return gx >= -2 && gx <= _GX_MAX && gz >= -2 && gz <= _GZ_MAX
}

// poly를 넘기면 해당 구역 폴리곤 안에서만 우회.
// poly가 있을 때는 어떤 경우에도 섹터 밖 경로를 반환하지 않음 (최우선).
function findPath(from: Pt, to: Pt, poly?: [number, number][]): Pt[] {
  const straight = interpolatePath(from, to, _PSTEP)

  // 직선 경로가 장애물 없고 섹터/방 안에 있으면 그대로 사용
  const straightOk = straight.every(p =>
    !isNearObstacle(p.x, p.y) &&
    (poly ? pointInPolygon(p.x, p.y, poly) : isInAnyRoom(p.x, p.y))
  )
  if (straightOk) return straight

  const [sx, sz] = _wToG(from.x, from.y)
  const [ex, ez] = _wToG(to.x, to.y)
  if (sx === ex && sz === ez) return [to]

  // 목표 셀이 장애물 내부 → 섹터 제약 있으면 스킵, 없으면 방 안 점만 추려서 반환
  if (isNearObstacle(_gToW(ex, ez).x, _gToW(ex, ez).y)) {
    if (poly) return []
    const f = straight.filter(p => isInAnyRoom(p.x, p.y))
    return f.length > 0 ? f : [to]
  }

  const parent = new Map<string, string | null>()
  const queue: [number, number][] = [[sx, sz]]
  const key = (gx: number, gz: number) => `${gx},${gz}`
  parent.set(key(sx, sz), null)
  let found = false

  outer: while (queue.length > 0) {
    const [cx, cz] = queue.shift()!
    for (const [dx, dz] of _DIRS8) {
      const nx = cx + dx, nz = cz + dz
      if (!_inBounds(nx, nz)) continue
      const nk = key(nx, nz)
      if (parent.has(nk)) continue
      const wp = _gToW(nx, nz)
      if (isNearObstacle(wp.x, wp.y)) continue
      const isTarget = nx === ex && nz === ez
      // 목표 셀은 경계 위에 있을 수 있으므로 room/sector 체크 면제
      if (!isTarget) {
        if (poly ? !pointInPolygon(wp.x, wp.y, poly) : !isInAnyRoom(wp.x, wp.y)) continue
      }
      parent.set(nk, key(cx, cz))
      if (isTarget) { found = true; break outer }
      queue.push([nx, nz])
    }
  }

  // 경로 못 찾음 → 섹터 제약 있으면 스킵(이탈 금지), 없으면 방 안 점만 추려서 반환
  if (!found) {
    if (poly) return []
    const f = straight.filter(p => isInAnyRoom(p.x, p.y))
    return f.length > 0 ? f : [to]
  }

  const path: Pt[] = []
  let cur: string | null = key(ex, ez)
  const startK = key(sx, sz)
  while (cur && cur !== startK) {
    const [gx, gz] = cur.split(',').map(Number)
    path.unshift(_gToW(gx, gz))
    cur = parent.get(cur) ?? null
  }
  return path.length > 0 ? path : (poly ? [] : straight)
}

// 구역 내 지그재그 청소 경로 (폴리곤 안쪽만, L자형도 자동 처리)
function generateZigzagInSector(poly: [number, number][], rowStep = 0.30): Pt[] {
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const z0 = Math.min(...zs), z1 = Math.max(...zs)
  const pts: Pt[] = []
  let rowIdx = 0
  for (let z = z0 + rowStep / 2; z <= z1; z += rowStep) {
    const row: Pt[] = []
    for (let x = x0 + rowStep / 2; x <= x1; x += rowStep) {
      if (pointInPolygon(x, z, poly) && !isNearObstacle(x, z)) row.push({ x, y: z })
    }
    if (row.length > 0) {
      pts.push(...(rowIdx % 2 === 0 ? row : [...row].reverse()))
      rowIdx++
    }
  }
  return pts
}

// BFS로 구역 간 최단 경로 탐색
function findSectorPath(from: string, to: string): string[] {
  if (from === to) return [from]
  const visited = new Set<string>([from])
  const queue: string[][] = [[from]]
  while (queue.length > 0) {
    const path = queue.shift()!
    const cur = path[path.length - 1]
    for (const nb of SECTOR_GRAPH[cur] ?? []) {
      if (nb === to) return [...path, nb]
      if (!visited.has(nb)) { visited.add(nb); queue.push([...path, nb]) }
    }
  }
  return [from, to]
}

// 구역 간 문 경유점 반환 (보간 없이 waypoint만)
function getNavDoors(fromSector: string | null, toSector: string): Pt[] {
  if (!fromSector || fromSector === toSector) return []
  const route = findSectorPath(fromSector, toSector)
  const pts: Pt[] = []
  for (let i = 0; i < route.length - 1; i++) {
    const door = DOORS[`${route[i]}-${route[i+1]}`] ?? DOORS[`${route[i+1]}-${route[i]}`]
    if (door) pts.push(door)
  }
  return pts
}

// 전체 청소 경로: 현재위치→문(보간)→구역(지그재그, 행간 보간)
function buildFullCleaningPath(sectors: string[], currentSector: string | null, startPos: Pt): Pt[] {
  const allPts: Pt[] = []
  let prevPos = startPos
  let prev = currentSector

  for (const name of sectors) {
    const poly = SECTOR_POLYS[name]
    if (!poly) continue

    // 현재 위치 → 목적 구역 문까지 우회 이동
    for (const door of getNavDoors(prev, name)) {
      allPts.push(...findPath(prevPos, door))
      prevPos = door
    }

    // 문 → 청소 지점 이동 (행 전환 시 해당 구역 안에서만 우회)
    const cleanPts = generateZigzagInSector(poly)
    for (const pt of cleanPts) {
      const dx = Math.abs(pt.x - prevPos.x), dz = Math.abs(pt.y - prevPos.y)
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist > 0.5) {
        const seg = findPath(prevPos, pt, poly)
        allPts.push(...seg)
        if (seg.length > 0) prevPos = pt  // 경로 없으면 prevPos 유지 (순간이동 방지)
      } else {
        allPts.push(pt)
        prevPos = pt
      }
    }

    prev = name
  }
  return allPts
}

// 복귀 경로: 현재위치→문(보간)→도킹(보간)
function buildReturnPath(currentSector: string | null, startPos: Pt): Pt[] {
  const dockSector = detectSector(DOCK.x, DOCK.y) ?? '거실'
  const waypoints = [...getNavDoors(currentSector, dockSector), DOCK]
  const allPts: Pt[] = []
  let prevPos = startPos
  for (const wp of waypoints) {
    allPts.push(...findPath(prevPos, wp))
    prevPos = wp
  }
  return allPts
}

/* ─── 3D 좌표 변환 ────────────────────────────────────────
 * rvPos가 이제 3D 세계 좌표이므로 직접 THREE.Vector3로 변환
 */
function svgTo3D(pt: Pt): THREE.Vector3 {
  return new THREE.Vector3(pt.x, 0.02, pt.y)
}

/* ─── Three.js 컴포넌트 ─────────────────────────────────── */

const MODEL_URL = '/models/capstonedesign_room.glb'
useGLTF.preload(MODEL_URL)

function RoomMesh({ onBox }: { onBox: (b: THREE.Box3) => void }) {
  const { scene } = useGLTF(MODEL_URL)

  useEffect(() => {
    // 씬 전체 오브젝트 이름 콘솔 출력
    const names: string[] = []
    scene.traverse((child) => { names.push(`${child.type} | ${child.name}`) })
    console.log('[GLB objects]\n' + names.join('\n'))

    // 주요 가구 + 벽/바닥 world position & size 출력
    const furnitureTargets = [
      'table_3_object', 'Range', 'Kitchen_021_014', 'Kitchen_021_053',
      'sink', 'sink001', 'sink002',
      'toilet_bowl', 'toilet_bowl001', 'toilet_bowl002',
      'Bed_nightstand', 'Bed_nightstand001', 'Bed_nightstand002',
      'Side_Table001', 'Side_Table005',
      'Rectangle010001', 'Rectangle010004', 'Rectangle010005',
      'couch4', 'Cristalo001',
    ]
    scene.traverse((o) => {
      const name = o.name
      const isTarget = furnitureTargets.includes(name) ||
        name.includes('Wall') || name.includes('wall') ||
        name.includes('Floor') || name.includes('floor') ||
        name.startsWith('Plane') || name.startsWith('Cube') ||
        name.startsWith('DoorFrame') || name === '57'
      if (isTarget) {
        const pos = new THREE.Vector3()
        o.getWorldPosition(pos)
        const box = new THREE.Box3().setFromObject(o)
        const size = box.getSize(new THREE.Vector3())
        console.log(
          `${o.name} | ` +
          `pos: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)} | ` +
          `size: ${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}`
        )
      }
    })

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    // 원점에 있는 여분 로봇청소기 인스턴스 숨기기
    ;[
      'RobotVacuum', 'RobotVacuum001', 'RobotVacuum002',
      'Robot_cleaner', 'Robot_cleaner001', 'Robot_cleaner002',
    ].forEach((name) => {
      const obj = scene.getObjectByName(name)
      if (obj) obj.visible = false
    })

    // Oven1 world position 로그
    const oven1 = scene.getObjectByName('Oven1')
    if (oven1) {
      const wp = new THREE.Vector3()
      oven1.getWorldPosition(wp)
      const box = new THREE.Box3().setFromObject(oven1)
      const size = box.getSize(new THREE.Vector3())
      console.log(`[Oven1] pos: ${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}, ${wp.z.toFixed(2)} | size: ${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}`)
    }

    onBox(new THREE.Box3().setFromObject(scene))
  }, [scene, onBox])

  return <primitive object={scene} />
}

/* ─── 로봇 본체 이동 ─────────────────────────────────────
 *
 * Robot cleaner..003 를 RobotVacuum003 에서 분리하여 scene root 로 이동.
 * 도킹스테이션(Charging Base.003 등)은 RobotVacuum003 에 그대로 고정.
 */
function RobotMover({ rvPos, rv }: { rvPos: Pt; rv: RobotVacuumState }) {
  const { scene: gltfScene } = useGLTF(MODEL_URL)
  const { scene } = useThree()
  const robotRef = useRef<THREE.Object3D | null>(null)

  // 마운트 시: GLB 씬에서 로봇 본체 탐색 → scene root로 분리
  useEffect(() => {
    let robot: THREE.Object3D | null = null
    gltfScene.traverse(o => { if (o.name === 'Robot_cleaner003') robot = o })

    if (!robot) { console.error('[RobotMover] Robot_cleaner003 을 찾지 못했습니다'); return }

    const r = robot as THREE.Object3D
    if (!(r.parent instanceof THREE.Scene)) {
      r.updateWorldMatrix(true, false)
      const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3()
      r.matrixWorld.decompose(wp, wq, ws)
      r.removeFromParent()
      scene.add(r)
      r.position.copy(wp)
      r.quaternion.copy(wq)
      r.scale.copy(ws)
    }
    robotRef.current = r
  }, [gltfScene, scene])

  // rvPos 변경 시 로봇 본체 위치 업데이트
  useEffect(() => {
    if (!robotRef.current) return
    robotRef.current.position.copy(svgTo3D(rvPos))
  }, [rvPos])

  const label =
    rv.status === 'cleaning'  ? '청소 중'  :
    rv.status === 'docked'    ? '충전 중'  :
    rv.status === 'returning' ? '복귀 중'  :
    rv.status === 'paused'    ? '일시정지' : '대기'

  const pos3D = svgTo3D(rvPos)

  return (
    <Html center position={[pos3D.x, pos3D.y + 0.35, pos3D.z]}>
      <div style={{
        background: 'rgba(15,23,42,0.78)',
        color: '#e2e8f0',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'sans-serif',
        whiteSpace: 'nowrap',
        border: '1px solid rgba(148,163,184,0.35)',
        pointerEvents: 'none',
      }}>
        🤖 {label}
      </div>
    </Html>
  )
}

/* ─── TV 화면 ────────────────────────────────────────────
 *
 * GLB 재질 "TV_Screen" (material[104]) 을 찾아
 * CanvasTexture 로 교체하고, TV 상태에 따라 갱신.
 */

type ChannelStyle = { bg: string; fg: string; text: string; fontSize?: number }

// 키는 모두 대문자로 통일
const CHANNEL_STYLES: Record<string, ChannelStyle> = {
  NETFLIX: { bg: '#E50914', fg: '#FFFFFF', text: 'N',     fontSize: 160 },
  KBS:     { bg: '#003C96', fg: '#FFFFFF', text: 'KBS' },
  MBC:     { bg: '#FFFFFF', fg: '#7B2B8C', text: 'MBC' },
  SBS:     { bg: '#0075BE', fg: '#FFFFFF', text: 'SBS' },
  YTN:     { bg: '#003C8F', fg: '#FFFFFF', text: 'YTN' },
  MBN:     { bg: '#FFFFFF', fg: '#1A1A1A', text: 'MBN' },
  SPOTV:   { bg: '#111111', fg: '#FF6B00', text: 'SPOTV', fontSize: 80 },
}

// KBS1/KBS2, SBS드라마 등 접두어만 있어도 매칭
function normalizeChannel(raw: string): string {
  const up = raw.toUpperCase().trim()
  if (up.startsWith('NETFLIX')) return 'NETFLIX'
  if (up.startsWith('KBS'))     return 'KBS'
  if (up.startsWith('MBC'))     return 'MBC'
  if (up.startsWith('SBS'))     return 'SBS'
  if (up.startsWith('YTN'))     return 'YTN'
  if (up.startsWith('MBN'))     return 'MBN'
  if (up.startsWith('SPOTV'))   return 'SPOTV'
  return up
}

function drawTVContent(canvas: HTMLCanvasElement, tv: TVState) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height

  if (tv.power === 'off') {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    return
  }

  const raw = String(tv.content_name || tv.channel || '').trim()
  if (!raw) {
    // 대기 화면 (전원 ON, 콘텐츠 미선택)
    ctx.fillStyle = '#0a1628'
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(0, H)
    ctx.scale(1, -1)
    ctx.font = 'bold 96px Arial, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('TV', W / 2, H / 2)
    ctx.restore()
    return
  }

  const key   = normalizeChannel(raw)
  const style: ChannelStyle = CHANNEL_STYLES[key] ?? { bg: '#F5F5F5', fg: '#222222', text: raw }

  // 배경
  ctx.fillStyle = style.bg
  ctx.fillRect(0, 0, W, H)

  // TV 메시 UV가 상하 반전 → canvas를 상하 반전해서 보정
  ctx.save()
  ctx.translate(0, H)
  ctx.scale(1, -1)

  const size = style.fontSize ?? (style.text.length > 4 ? 72 : 100)
  ctx.font = `bold ${size}px Arial, sans-serif`
  ctx.fillStyle = style.fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(style.text, W / 2, H / 2)

  ctx.restore()
}

function TVScreen() {
  const { scene } = useThree()
  const tv = useDeviceStore((s) => s.devices.tv)
  const canvasRef  = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<THREE.CanvasTexture | null>(null)

  // 마운트 시: TV_Screen 재질 메시 찾아 CanvasTexture로 교체
  // Plane.082 는 Group이고 그 서브메시 중 material.name === 'TV_Screen' 인 것이 화면
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 288
    canvasRef.current = canvas

    const texture = new THREE.CanvasTexture(canvas)
    textureRef.current = texture

    let found = false
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((mat, idx) => {
        if ((mat as THREE.Material).name === 'TV_Screen') {
          const newMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
          if (Array.isArray(child.material)) {
            ;(child.material as THREE.Material[])[idx] = newMat
          } else {
            child.material = newMat
          }
          found = true
        }
      })
    })
    if (!found) console.warn('[TVScreen] TV_Screen 재질을 찾지 못했습니다')

    drawTVContent(canvas, tv)
    texture.needsUpdate = true

    return () => { texture.dispose() }
  // tv는 의도적으로 제외 — 변경은 아래 effect가 담당
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // TV 상태 변경 시 화면 갱신
  useEffect(() => {
    const canvas  = canvasRef.current
    const texture = textureRef.current
    if (!canvas || !texture) return
    drawTVContent(canvas, tv)
    texture.needsUpdate = true
  }, [tv.power, tv.channel, tv.content_name]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

/* ─── 에어컨 파티클 ─────────────────────────────────────── */

// AirConditioner 앞면(FaceCover) world 좌표
// node translation(456.75, 1.05, -14.70) + 90°X 회전 후 FaceCover 오프셋(0, 0.276, 0.019)
// → world (456.75, 1.05-0.02, -14.70+0.28) ≈ (456.75, 1.03, -14.42)
const AC_PX = 456.75, AC_PY = 1.03, AC_PZ = -14.42
const PARTICLE_COUNT = 80

// fan_speed별 파티클 시각 파라미터
const AC_FAN_CONFIG: Record<string, {
  vz: number; vy: number; xSpread: number
  size: number; opacity: number; activeCount: number; zReach: number
}> = {
  low:    { vz: 0.003, vy: 0.004, xSpread: 0.20, size: 0.016, opacity: 0.40, activeCount: 28, zReach: 0.8 },
  auto:   { vz: 0.006, vy: 0.006, xSpread: 0.35, size: 0.022, opacity: 0.60, activeCount: 52, zReach: 1.2 },
  medium: { vz: 0.009, vy: 0.008, xSpread: 0.48, size: 0.027, opacity: 0.70, activeCount: 65, zReach: 1.6 },
  high:   { vz: 0.015, vy: 0.010, xSpread: 0.65, size: 0.034, opacity: 0.82, activeCount: 80, zReach: 2.4 },
}

function ACParticles() {
  const ac = useDeviceStore(s => s.devices.air_conditioner)
  const acRef = useRef(ac)
  useEffect(() => { acRef.current = ac }, [ac])

  const matRef = useRef<THREE.PointsMaterial>(null)

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i*3]   = AC_PX + (Math.random() - 0.5) * 0.35
      pos[i*3+1] = AC_PY
      pos[i*3+2] = AC_PZ + (Math.random() - 0.5) * 0.05
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return geo
  }, [])

  useFrame(() => {
    const cur = acRef.current
    if (cur.power === 'off') return
    const cfg = AC_FAN_CONFIG[cur.fan_speed] ?? AC_FAN_CONFIG.auto
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    const isHeat = cur.mode === 'heat'
    const vy = isHeat ? cfg.vy : -cfg.vy

    // 재질 파라미터 실시간 반영
    if (matRef.current) {
      matRef.current.size    = cfg.size
      matRef.current.opacity = cfg.opacity
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // activeCount 초과 파티클 → 뒤쪽으로 숨김
      if (i >= cfg.activeCount) {
        pos[i*3+2] = AC_PZ - 10
        continue
      }
      // 숨겨진 파티클이 다시 활성화될 때 스폰 위치로 리셋
      if (pos[i*3+2] < AC_PZ - 5) {
        pos[i*3]   = AC_PX + (Math.random() - 0.5) * cfg.xSpread * 0.8
        pos[i*3+1] = AC_PY
        pos[i*3+2] = AC_PZ + (Math.random() - 0.5) * 0.05
        continue
      }

      pos[i*3]   += (Math.random() - 0.5) * 0.003
      pos[i*3+1] += vy + (Math.random() - 0.5) * 0.001
      // AC가 Z=-14.42, 실내는 Z=-8 방향 → 양의 Z로 확산
      pos[i*3+2] += cfg.vz + (Math.random() - 0.5) * 0.002

      const outOfBounds =
        pos[i*3+1] < 0.05 ||
        pos[i*3+1] > AC_PY + 1.2 ||
        pos[i*3+2] > AC_PZ + cfg.zReach ||
        Math.abs(pos[i*3] - AC_PX) > cfg.xSpread

      if (outOfBounds) {
        pos[i*3]   = AC_PX + (Math.random() - 0.5) * cfg.xSpread * 0.8
        pos[i*3+1] = AC_PY
        pos[i*3+2] = AC_PZ + (Math.random() - 0.5) * 0.05
      }
    }
    attr.needsUpdate = true
  })

  const color =
    ac.mode === 'cool' ? '#60a5fa' :
    ac.mode === 'heat' ? '#fb923c' :
    ac.mode === 'dry'  ? '#94a3b8' : '#e0f2fe'

  return (
    <points geometry={geometry} visible={ac.power === 'on'}>
      <pointsMaterial ref={matRef} size={0.025} color={color} transparent opacity={0.65} sizeAttenuation />
    </points>
  )
}

/* ─── 공기청정기 파동 ─────────────────────────────────────── */

const AP_PX = 460.85, AP_PY = 0.02, AP_PZ = -15.05

function AirPurifierWaves() {
  const ap = useDeviceStore(s => s.devices.air_purifier)
  const ringsRef = useRef<(THREE.Mesh | null)[]>([null, null, null])

  useFrame(({ clock }) => {
    if (ap.power === 'off') return
    const t = clock.getElapsedTime()
    ringsRef.current.forEach((mesh, i) => {
      if (!mesh) return
      const phase = (t * 0.4 + i / 3) % 1
      const s = 0.1 + phase * 1.3
      mesh.scale.set(s, 1, s)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - phase)
    })
  })

  return (
    <group position={[AP_PX, AP_PY, AP_PZ]} visible={ap.power === 'on'}>
      {[0, 1, 2].map(i => (
        <mesh
          key={i}
          ref={el => { ringsRef.current[i] = el as THREE.Mesh | null }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.12, 0.17, 48]} />
          <meshBasicMaterial color="#7dd3fc" transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/* ─── 오븐 효과 ──────────────────────────────────────────── */

const OVEN_HEAT_COUNT = 40
const OVEN_STEAM_COUNT = 60

function OvenHeatParticles({ px, py, pz, intensity }: { px: number; py: number; pz: number; intensity: number }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(OVEN_HEAT_COUNT * 3)
    for (let i = 0; i < OVEN_HEAT_COUNT; i++) {
      pos[i * 3]     = px + (Math.random() - 0.5) * 0.25
      pos[i * 3 + 1] = py
      pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.15
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return geo
  }, [px, py, pz])

  useFrame(() => {
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    const spd  = 0.003 + intensity * 0.006
    for (let i = 0; i < OVEN_HEAT_COUNT; i++) {
      pos[i * 3]     += (Math.random() - 0.5) * 0.004
      pos[i * 3 + 1] += spd
      pos[i * 3 + 2] += (Math.random() - 0.5) * 0.003
      if (pos[i * 3 + 1] > py + 0.55) {
        pos[i * 3]     = px + (Math.random() - 0.5) * 0.25
        pos[i * 3 + 1] = py
        pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.15
      }
    }
    attr.needsUpdate = true
  })

  const color = intensity > 0.7 ? '#ef4444' : intensity > 0.4 ? '#f97316' : '#fbbf24'

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.018} color={color} transparent opacity={0.65} sizeAttenuation />
    </points>
  )
}

function OvenSteamParticles({ px, py, pz }: { px: number; py: number; pz: number }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(OVEN_STEAM_COUNT * 3)
    for (let i = 0; i < OVEN_STEAM_COUNT; i++) {
      pos[i * 3]     = px + (Math.random() - 0.5) * 0.2
      pos[i * 3 + 1] = py
      pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.1
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return geo
  }, [px, py, pz])

  useFrame(() => {
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    for (let i = 0; i < OVEN_STEAM_COUNT; i++) {
      pos[i * 3]     += (Math.random() - 0.5) * 0.003
      pos[i * 3 + 1] += 0.006 + Math.random() * 0.003
      pos[i * 3 + 2] += (Math.random() - 0.5) * 0.002
      if (pos[i * 3 + 1] > py + 0.9 || Math.abs(pos[i * 3] - px) > 0.3) {
        pos[i * 3]     = px + (Math.random() - 0.5) * 0.2
        pos[i * 3 + 1] = py
        pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.1
      }
    }
    attr.needsUpdate = true
  })

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.022} color="#e0f2fe" transparent opacity={0.5} sizeAttenuation />
    </points>
  )
}

const OVEN_MODE_LABEL: Record<string, string> = {
  bake:        '베이킹',
  grill:       '그릴',
  convection:  '컨벡션',
  steam:       '스팀',
  microwave:   '전자레인지',
}

function OvenEffects() {
  const oven = useDeviceStore(s => s.devices.oven)
  const { scene } = useThree()
  const [ovenPos, setOvenPos] = useState<{ x: number; y: number; z: number } | null>(null)

  useEffect(() => {
    const oven1 = scene.getObjectByName('Oven1')
    if (oven1) {
      const wp = new THREE.Vector3()
      oven1.getWorldPosition(wp)
      setOvenPos({ x: wp.x, y: wp.y, z: wp.z })
    }
  }, [scene])

  if (!ovenPos) return null

  const { x, y, z } = ovenPos
  const effectY = y + 0.3
  const labelY  = y + 1.0
  const intensity = Math.min((oven.target_temp - 30) / 220, 1)

  return (
    <>
      {oven.power === 'on' && (
        <>
          <OvenHeatParticles px={x} py={effectY} pz={z} intensity={intensity} />
          <pointLight
            position={[x, y + 0.1, z]}
            intensity={0.3 + intensity * 0.5}
            color={intensity > 0.6 ? '#ef4444' : '#fb923c'}
            distance={1.5}
            decay={2}
          />
        </>
      )}
      {oven.power === 'on' && oven.steam === 'on' && (
        <OvenSteamParticles px={x} py={effectY} pz={z} />
      )}
      <Html center position={[x, labelY, z]}>
        <div style={{
          background: oven.power === 'on' ? 'rgba(194,65,12,0.85)' : 'rgba(71,85,105,0.75)',
          color: '#f1f5f9',
          padding: '3px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'sans-serif',
          whiteSpace: 'nowrap',
          border: `1px solid ${oven.power === 'on' ? 'rgba(251,146,60,0.6)' : 'rgba(100,116,139,0.4)'}`,
          pointerEvents: 'none',
        }}>
          {oven.power === 'on'
            ? `🔥 오븐: ${OVEN_MODE_LABEL[oven.mode] ?? oven.mode} · ${oven.target_temp}°C${oven.steam === 'on' ? ' · 💨스팀' : ''}`
            : '오븐: OFF'}
        </div>
      </Html>
    </>
  )
}

/* ─── 세탁기 효과 ──────────────────────────────────────────── */

const WM_BUBBLE_COUNT = 50

function WMBubbles({ px, py, pz, color }: { px: number; py: number; pz: number; color: string }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(WM_BUBBLE_COUNT * 3)
    for (let i = 0; i < WM_BUBBLE_COUNT; i++) {
      pos[i * 3]     = px + (Math.random() - 0.5) * 0.5
      pos[i * 3 + 1] = py + Math.random() * 0.3
      pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.4
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return geo
  }, [px, py, pz])

  useFrame(() => {
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    for (let i = 0; i < WM_BUBBLE_COUNT; i++) {
      pos[i * 3]     += (Math.random() - 0.5) * 0.005
      pos[i * 3 + 1] += 0.003 + Math.random() * 0.003
      pos[i * 3 + 2] += (Math.random() - 0.5) * 0.004
      if (pos[i * 3 + 1] > py + 0.7) {
        pos[i * 3]     = px + (Math.random() - 0.5) * 0.5
        pos[i * 3 + 1] = py
        pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.4
      }
    }
    attr.needsUpdate = true
  })

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.025} color={color} transparent opacity={0.6} sizeAttenuation />
    </points>
  )
}

function WMSpinRings({ px, py, pz }: { px: number; py: number; pz: number }) {
  const ringsRef = useRef<(THREE.Mesh | null)[]>([null, null, null])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    ringsRef.current.forEach((mesh, i) => {
      if (!mesh) return
      const phase = (t * 1.2 + i / 3) % 1
      const s = 0.05 + phase * 0.6
      mesh.scale.set(s, 1, s)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - phase)
    })
  })

  return (
    <group position={[px, py, pz]}>
      {[0, 1, 2].map(i => (
        <mesh
          key={i}
          ref={el => { ringsRef.current[i] = el as THREE.Mesh | null }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.1, 0.14, 48]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

function WMFrontParticles({ px, py, pz }: { px: number; py: number; pz: number }) {
  const COUNT = 30
  const frontZ = pz + 0.35  // 앞면 방향

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = px + (Math.random() - 0.5) * 0.3
      pos[i * 3 + 1] = py + Math.random() * 0.4
      pos[i * 3 + 2] = frontZ + Math.random() * 0.08
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return geo
  }, [px, py, frontZ])

  useFrame(() => {
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     += (Math.random() - 0.5) * 0.003
      pos[i * 3 + 1] += 0.002 + Math.random() * 0.002
      pos[i * 3 + 2] += 0.004
      if (pos[i * 3 + 1] > py + 0.8 || pos[i * 3 + 2] > frontZ + 0.4) {
        pos[i * 3]     = px + (Math.random() - 0.5) * 0.3
        pos[i * 3 + 1] = py + Math.random() * 0.4
        pos[i * 3 + 2] = frontZ + Math.random() * 0.08
      }
    }
    attr.needsUpdate = true
  })

  return (
    <points geometry={geometry}>
      <pointsMaterial size={0.020} color="#3b82f6" transparent opacity={0.5} sizeAttenuation />
    </points>
  )
}

const WM_MODE_LABEL: Record<string, string> = {
  standard:   '표준',
  delicate:   '섬세',
  heavy:      '강력',
  quick:      '급속',
  wool:       '울',
  rinse_spin: '헹굼·탈수',
}

const WM_STATUS_LABEL: Record<string, string> = {
  stopped: '정지',
  washing: '세탁 중',
  rinsing: '헹굼 중',
  spinning: '탈수 중',
  done:    '완료',
}

function WashingMachineEffects() {
  const wm = useDeviceStore(s => s.devices.washing_machine)
  const { scene } = useThree()
  const [wmPos, setWmPos] = useState<{ x: number; y: number; z: number } | null>(null)

  useEffect(() => {
    let found: THREE.Object3D | null = null
    scene.traverse(o => { if (!found && o.name === 'WashingMachine') found = o })
    if (found) {
      const wp = new THREE.Vector3()
      ;(found as THREE.Object3D).getWorldPosition(wp)
      setWmPos({ x: wp.x, y: wp.y, z: wp.z })
    } else {
      // GLB 실측 fallback
      setWmPos({ x: 460.60, y: 0.0, z: -16.87 })
    }
  }, [scene])

  if (!wmPos) return null

  const { x, y, z } = wmPos
  const effectY    = y + 0.4
  const labelY     = y + 1.1
  const isWashing  = wm.power === 'on' && (wm.status === 'washing' || wm.status === 'rinsing')
  const isSpinning = wm.power === 'on' && wm.status === 'spinning'
  const isDone     = wm.power === 'on' && wm.status === 'done'
  const bubbleColor = wm.status === 'rinsing' ? '#93c5fd' : '#bfdbfe'

  return (
    <>
      {isWashing  && <WMBubbles      px={x} py={effectY} pz={z} color={bubbleColor} />}
      {isWashing  && <WMFrontParticles px={x} py={effectY} pz={z} />}
      {isSpinning && <WMSpinRings px={x} py={effectY} pz={z} />}
      <Html center position={[x, labelY, z]}>
        <div style={{
          background: isDone
            ? 'rgba(22,163,74,0.85)'
            : wm.power === 'on'
              ? 'rgba(37,99,235,0.85)'
              : 'rgba(71,85,105,0.75)',
          color: '#f1f5f9',
          padding: '3px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'sans-serif',
          whiteSpace: 'nowrap',
          border: `1px solid ${
            isDone        ? 'rgba(134,239,172,0.5)' :
            wm.power === 'on' ? 'rgba(147,197,253,0.5)' :
            'rgba(100,116,139,0.4)'
          }`,
          pointerEvents: 'none',
        }}>
          {wm.power === 'off'
            ? '세탁기: OFF'
            : isDone
              ? '✅ 세탁 완료'
              : `🫧 세탁기: ${WM_STATUS_LABEL[wm.status] ?? wm.status} · ${WM_MODE_LABEL[wm.mode] ?? wm.mode} · ${wm.water_temperature}°C`
          }
        </div>
      </Html>
    </>
  )
}

/* ─── 디바이스 상태 라벨 ──────────────────────────────────
 *
 * GLB 실측 좌표 사용 (JSON 청크에서 추출):
 *   AirConditioner : (456.75, 1.05, -14.70)
 *   TV             : (461.78, 0.72, -14.70)
 *   Air Purfiers   : (460.85, 0.00, -15.05)
 */
const AC_FAN_LABEL: Record<string, string> = {
  auto: '자동', low: '약풍', medium: '중풍', high: '강풍',
}

function DeviceLabels() {
  const { air_conditioner: ac, tv, air_purifier: ap } = useDeviceStore((s) => s.devices)

  const items = [
    {
      id: 'ac',
      label: '에어컨',
      pos: [456.75, 1.7, -14.70] as [number, number, number],
      active: ac.power === 'on',
      info: ac.power === 'on'
        ? `${ac.temperature}°C · ${ac.mode} · ${AC_FAN_LABEL[ac.fan_speed] ?? ac.fan_speed}`
        : 'OFF',
    },
    {
      id: 'tv',
      label: 'TV',
      pos: [461.78, 1.4, -14.70] as [number, number, number],
      active: tv.power === 'on',
      info: tv.power === 'on'
        ? `${tv.content_name || tv.channel || 'ON'} 🔊${tv.volume}`
        : 'OFF',
    },
    {
      id: 'ap',
      label: '공기청정기',
      pos: [460.85, 1.5, -15.05] as [number, number, number],
      active: ap.power === 'on',
      info: ap.power === 'on' ? ap.mode : 'OFF',
    },
  ]

  return (
    <>
      {items.map(({ id, label, pos, active, info }) => (
        <Html key={id} center position={pos}>
          <div style={{
            background: active ? 'rgba(37,99,235,0.85)' : 'rgba(71,85,105,0.75)',
            color: '#f1f5f9',
            padding: '3px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontFamily: 'sans-serif',
            whiteSpace: 'nowrap',
            border: `1px solid ${active ? 'rgba(147,197,253,0.5)' : 'rgba(100,116,139,0.4)'}`,
            pointerEvents: 'none',
          }}>
            {label}: {info}
          </div>
        </Html>
      ))}
    </>
  )
}

/* ─── 거실 조명 효과 ─────────────────────────────────────── */

// 색온도(K) → hex 변환 (2700K 따뜻 ~ 6500K 차가움)
function colorTempToHex(k: number): string {
  const t = Math.max(0, Math.min(1, (k - 2700) / (6500 - 2700)))
  const r = Math.round(255 - t * 55)
  const g = Math.round(210 + t * 35)
  const b = Math.round(130 + t * 125)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const LIGHT_COLOR_MAP: Record<string, string> = {
  white:  '',        // color_temperature 사용
  yellow: '#fef08a',
  blue:   '#93c5fd',
  red:    '#fca5a5',
  green:  '#86efac',
}

const LIGHT_SCENE_LABEL: Record<string, string> = {
  sleep:  '수면',
  focus:  '집중',
  movie:  '영화',
  relax:  '휴식',
}

// 거실 중심 (폴리곤 기반)
const LIVING_ROOM_CX = 461.0
const LIVING_ROOM_CZ = -12.5

function LivingRoomLight() {
  const light = useDeviceStore(s => s.devices.light)

  const hexColor = light.color !== 'white' && LIGHT_COLOR_MAP[light.color]
    ? LIGHT_COLOR_MAP[light.color]
    : colorTempToHex(light.color_temperature)

  const opacity = light.power === 'on' ? (light.brightness / 100) * 0.45 : 0

  const sceneLabel = light.scene_name ? LIGHT_SCENE_LABEL[light.scene_name] ?? light.scene_name : null
  const infoText = light.power === 'on'
    ? `💡 조명: ${light.brightness}%${sceneLabel ? ` · ${sceneLabel}` : ''}`
    : '조명: OFF'

  return (
    <>
      {/* 바닥 빛 웅덩이 */}
      <mesh
        position={[LIVING_ROOM_CX, 0.02, LIVING_ROOM_CZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={light.power === 'on'}
      >
        <circleGeometry args={[2.8, 64]} />
        <meshBasicMaterial
          color={hexColor}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* 라벨 */}
      <Html center position={[LIVING_ROOM_CX, 0.5, LIVING_ROOM_CZ - 1.5]}>
        <div style={{
          background: light.power === 'on' ? 'rgba(161,120,10,0.85)' : 'rgba(71,85,105,0.75)',
          color: '#f1f5f9',
          padding: '3px 8px',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'sans-serif',
          whiteSpace: 'nowrap',
          border: `1px solid ${light.power === 'on' ? 'rgba(253,224,71,0.5)' : 'rgba(100,116,139,0.4)'}`,
          pointerEvents: 'none',
        }}>
          {infoText}
        </div>
      </Html>
    </>
  )
}

/* ─── 섹터 디버그 시각화 ─────────────────────────────────── */

// 섹터 색상 — SECTOR_POLYS가 단일 좌표 원본이므로 색상만 별도 관리
const SECTOR_COLORS: Record<string, string> = {
  주방:  '#ec4899',
  세탁실: '#14b8a6',
  침실3: '#eab308',
  거실:  '#3b82f6',
  침실1: '#a855f7',
  침실2: '#eab308',
}

// 문 시각화는 고정 좌표 (경로 계획에 미사용)
const DOOR_SECTORS = [
  { name: '문(주방↔거실)',   points: [[458.7,-14.85],[459.6,-14.85],[459.6,-14.75],[458.7,-14.75]] as [number,number][] },
  { name: '문(주방↔세탁실)', points: [[459.6,-16.6],[459.75,-16.6],[459.75,-15.8],[459.6,-15.8]] as [number,number][] },
  { name: '문(침실2↔거실)',  points: [[459.3,-11.1],[459.4,-11.1],[459.4,-10.3],[459.3,-10.3]] as [number,number][] },
  { name: '문(침실1↔거실)',  points: [[462.6,-11.1],[462.7,-11.1],[462.7,-10.3],[462.6,-10.3]] as [number,number][] },
  { name: '문(침실3↔거실)',  points: [[462.7,-13.55],[463.6,-13.55],[463.6,-13.45],[462.7,-13.45]] as [number,number][] },
]

interface SectorDef { name: string; points: [number, number][]; color: string }

function SectorMesh({ name, points, color }: SectorDef) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1])
    s.closePath()
    return s
  }, [points])

  const cx = points.reduce((s, p) => s + p[0], 0) / points.length
  const cz = points.reduce((s, p) => s + p[1], 0) / points.length

  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
      <Html center position={[cx, 0.25, cz]}>
        <div style={{
          color,
          fontSize: 11,
          fontWeight: 'bold',
          fontFamily: 'sans-serif',
          whiteSpace: 'nowrap',
          textShadow: '0 0 4px #000',
          pointerEvents: 'none',
        }}>
          {name}
        </div>
      </Html>
    </group>
  )
}

function SectorDebug() {
  return (
    <>
      {Object.entries(SECTOR_POLYS).map(([name, points]) => (
        <SectorMesh key={name} name={name} points={points} color={SECTOR_COLORS[name] ?? '#888888'} />
      ))}
      {DOOR_SECTORS.map((d) => (
        <SectorMesh key={d.name} name={d.name} points={d.points} color="#84cc16" />
      ))}
    </>
  )
}

/* ─── 씬 호버 컨트롤러 ───────────────────────────────────────
 * gl.domElement의 pointermove/pointerleave로 raycasting을 수행하고,
 * 히트된 Mesh의 material을 클론 후 노란색으로 하이라이트.
 * 마우스를 떼면 원래 color로 복원.
 */
function SceneHover({ onHover }: { onHover: (info: HoveredInfo | null) => void }) {
  const { scene, gl, camera } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const origColorMap = useRef(new Map<THREE.Mesh, THREE.Color>())
  const hoveredRef = useRef<THREE.Mesh | null>(null)
  const onHoverRef = useRef(onHover)
  useEffect(() => { onHoverRef.current = onHover })

  useEffect(() => {
    const el = gl.domElement

    const restoreMesh = (mesh: THREE.Mesh) => {
      const orig = origColorMap.current.get(mesh)
      const mat = mesh.material
      if (orig && !Array.isArray(mat) && 'color' in mat) {
        (mat as THREE.MeshStandardMaterial).color.copy(orig)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      const intersects = raycaster.intersectObjects(scene.children, true)
      const hit = intersects.length > 0 ? (intersects[0].object as THREE.Mesh) : null

      if (hit === hoveredRef.current) return

      if (hoveredRef.current) restoreMesh(hoveredRef.current)
      hoveredRef.current = hit

      if (hit) {
        const mat = hit.material
        if (!Array.isArray(mat) && 'color' in mat) {
          if (!origColorMap.current.has(hit)) {
            // 공유 material 변경 방지를 위해 클론
            const cloned = (mat as THREE.MeshStandardMaterial).clone()
            hit.material = cloned
            origColorMap.current.set(hit, (cloned as THREE.MeshStandardMaterial).color.clone())
          }
          ;(hit.material as THREE.MeshStandardMaterial).color.set('#ffff00')
        }
        const wp = new THREE.Vector3()
        hit.getWorldPosition(wp)
        const box = new THREE.Box3().setFromObject(hit)
        const size = box.getSize(new THREE.Vector3())
        onHoverRef.current({
          name: hit.name || '(unnamed)',
          parentName: hit.parent?.name ?? '',
          position: wp,
          size,
        })
      } else {
        onHoverRef.current(null)
      }
    }

    const onPointerLeave = () => {
      if (hoveredRef.current) { restoreMesh(hoveredRef.current); hoveredRef.current = null }
      onHoverRef.current(null)
    }

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)
    return () => {
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [gl, camera, raycaster, scene])

  return null
}

/* ─── 메인 컴포넌트 ──────────────────────────────────────── */

export function RoomSimulator() {
  const rv = useDeviceStore((s) => s.devices.robot_vacuum)

  const [rvPos, setRvPos] = useState<Pt>(DOCK)
  const currentSectorRef = useRef<string | null>('거실')
  const pathRef          = useRef<Pt[]>([])
  const timerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rvRef            = useRef(rv)
  const rvPosRef         = useRef<Pt>(DOCK)   // 최신 위치 항상 추적
  useEffect(() => { rvRef.current = rv })
  useEffect(() => { rvPosRef.current = rvPos }, [rvPos])

  const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null)
  const handleHover = useCallback((info: HoveredInfo | null) => setHoveredInfo(info), [])

  const handleBox = useCallback((_b: THREE.Box3) => {}, [])

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    const setStatus = (status: string) => {
      fetch('/api/v1/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'rv-internal',
          raw_user_input: null,
          intent: 'device_control',
          commands: [{
            step_order: 1,
            device_name: 'living_room_robot_vacuum',
            device_type: 'robot_vacuum',
            tool_name: 'robot_vacuum.set_action',
            parameters: { action: status },
          }],
          response_text: '',
        }),
      }).catch(() => {})
    }

    const STEP_MS = 100

    const cleanStep = () => {
      if (rvRef.current.status !== 'cleaning') return
      if (pathRef.current.length > 0) {
        const next = pathRef.current.shift()!
        setRvPos(next)
        currentSectorRef.current = detectSector(next.x, next.y) ?? currentSectorRef.current
        timerRef.current = setTimeout(cleanStep, STEP_MS)
      } else {
        // 청소 완료 → 복귀 시작
        setStatus('returning')
      }
    }

    const returnToDock = () => {
      // rvPosRef로 현재 위치를 정확히 읽음 (클로저 스테일 방지)
      pathRef.current = buildReturnPath(currentSectorRef.current, rvPosRef.current)
      const dockStep = () => {
        if (pathRef.current.length > 0) {
          const next = pathRef.current.shift()!
          setRvPos(next)
          currentSectorRef.current = detectSector(next.x, next.y) ?? currentSectorRef.current
          timerRef.current = setTimeout(dockStep, STEP_MS)
        } else {
          setRvPos(DOCK)
          currentSectorRef.current = detectSector(DOCK.x, DOCK.y) ?? '거실'
          // 도킹 완료 → 백엔드 상태 갱신
          setStatus('docked')
        }
      }
      dockStep()
    }

    clear()
    pathRef.current = []

    if (rv.status === 'cleaning') {
      const startSector = detectSector(rvPosRef.current.x, rvPosRef.current.y) ?? '거실'
      currentSectorRef.current = startSector
      pathRef.current = buildFullCleaningPath(getCleaningOrder(rv.zone), startSector, rvPosRef.current)
      timerRef.current = setTimeout(cleanStep, 300)
    } else if (rv.status === 'returning') {
      returnToDock()
    } else if (rv.status === 'docked') {
      setRvPos(DOCK)
    }

    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rv.status, rv.zone])

  return (
    <div style={{ position: 'relative', flex: 1, height: '100%', minHeight: 450 }}>
      {hoveredInfo && (
        <div style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 10,
          background: 'rgba(15,23,42,0.88)',
          color: '#e2e8f0',
          padding: '8px 12px',
          borderRadius: 6,
          fontSize: 12,
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          border: '1px solid rgba(148,163,184,0.3)',
          pointerEvents: 'none',
          lineHeight: 1.7,
        }}>
          <div style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: 2 }}>
            {hoveredInfo.parentName
              ? `${hoveredInfo.parentName} > ${hoveredInfo.name}`
              : hoveredInfo.name}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>
            pos &nbsp;x: {hoveredInfo.position.x.toFixed(2)}&ensp;
            y: {hoveredInfo.position.y.toFixed(2)}&ensp;
            z: {hoveredInfo.position.z.toFixed(2)}
          </div>
          <div style={{ color: '#34d399', fontSize: 11 }}>
            size x: {hoveredInfo.size.x.toFixed(2)}&ensp;
            y: {hoveredInfo.size.y.toFixed(2)}&ensp;
            z: {hoveredInfo.size.z.toFixed(2)}
          </div>
          {hoveredInfo.parentName && (
            <div style={{ color: '#64748b', fontSize: 10, marginTop: 1 }}>
              parent: {hoveredInfo.parentName}
            </div>
          )}
        </div>
      )}
      <Canvas
        shadows
        camera={{ position: [461, 15, -3], fov: 50 }}
        style={{ background: '#1e293b' }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 15, 5]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <pointLight position={[-4, 3, -4]} intensity={0.3} color="#ffe8cc" />

          <Bounds clip margin={1.3}>
            <RoomMesh onBox={handleBox} />
          </Bounds>

          <RobotMover rvPos={rvPos} rv={rv} />
          <TVScreen />
          <ACParticles />
          <AirPurifierWaves />
          <OvenEffects />
          <WashingMachineEffects />
          <LivingRoomLight />
          <DeviceLabels />
          <SectorDebug />
          <mesh position={[463.68, 0.5, -13.3]}>
            <boxGeometry args={[0.1, 1.0, 0.4]} />
            <meshBasicMaterial color="black" />
          </mesh>

          <SceneHover onHover={handleHover} />
        </Suspense>

        <OrbitControls
          makeDefault
          target={[461, 0, -13] as unknown as THREE.Vector3}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  )
}
