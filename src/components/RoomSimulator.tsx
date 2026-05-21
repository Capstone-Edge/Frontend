import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html, Bounds } from '@react-three/drei'
import * as THREE from 'three'
import { useDeviceStore } from '../store/deviceStore'
import type { RobotVacuumState, TVState } from '../types'

/* ─── 타입 ────────────────────────────────────────────── */

type RoomId =
  | 'living_room' | 'hallway' | 'family_room'
  | 'bedroom1' | 'bedroom3' | 'bedroom4'
  | 'bathroom' | 'bathroom2' | 'dressing_room'

interface Pt { x: number; y: number }
interface RoomDef { doors: Partial<Record<RoomId, Pt>> }

/* ─── 방 정의 ─────────────────────────────────────────── */

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
  bathroom:      { doors: { bedroom1:    { x: 64,  y: 75  } } },
  dressing_room: { doors: { bedroom1:    { x: 158, y: 75  } } },
  bedroom3:      { doors: { hallway:     { x: 212, y: 207 } } },
  bedroom4:      { doors: { hallway:     { x: 328, y: 207 } } },
  bathroom2:     { doors: { hallway:     { x: 444, y: 185 } } },
  family_room: {
    doors: {
      hallway:     { x: 510, y: 207 },
      living_room: { x: 538, y: 270 },
    },
  },
}

const SPIRAL_BOUNDS: Partial<Record<RoomId, { x: number; y: number; w: number; h: number }>> = {
  living_room:   { x: 564, y:  45, w: 312, h: 319 },
  hallway:       { x: 189, y: 101, w: 345, h:  80 },
  bedroom1:      { x:  45, y: 101, w: 114, h: 224 },
  bedroom3:      { x: 189, y: 211, w:  90, h: 114 },
  bedroom4:      { x: 309, y: 211, w:  98, h: 114 },
  bathroom:      { x:  45, y:  45, w:  78, h:  26 },
  dressing_room: { x: 153, y:  45, w:  45, h:  26 },
  family_room:   { x: 484, y: 211, w:  50, h: 114 },
  bathroom2:     { x: 437, y: 211, w:  17, h:  32 },
}

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

const CLEAN_ORDER: RoomId[] = [
  'living_room', 'hallway',
  'bedroom1', 'bedroom3', 'bedroom4',
  'bathroom', 'dressing_room', 'family_room', 'bathroom2',
]

const DOCK: Pt = { x: 480, y: 314 }

/* ─── 유틸 ────────────────────────────────────────────── */

function clampToHouse(pt: Pt): Pt {
  const { x, y } = pt
  if (x >= 549) return { x: Math.max(551, Math.min(889, x)), y: Math.max(32, Math.min(377, y)) }
  return { x: Math.max(32, Math.min(547, x)), y: Math.max(32, Math.min(406, y)) }
}

function getRoomIds(zone: string | string[] | null): RoomId[] {
  if (!zone || zone === 'all') return ZONE_ROOMS.all
  if (Array.isArray(zone)) return [...new Set(zone.flatMap(z => ZONE_ROOMS[z] ?? [z as RoomId]))]
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
      if (!visited.has(nb)) { visited.add(nb); queue.push([...path, nb]) }
    }
  }
  return [from, to]
}

function buildPath(fromRoom: RoomId | null, toRoom: RoomId, target: Pt): Pt[] {
  if (!fromRoom || fromRoom === toRoom) return [target]
  const roomPath = findRoomPath(fromRoom, toRoom)
  const pts: Pt[] = []
  for (let i = 0; i < roomPath.length - 1; i++) {
    const exitPt  = ROOMS[roomPath[i]]?.doors[roomPath[i + 1]]
    const entryPt = ROOMS[roomPath[i + 1]]?.doors[roomPath[i]]
    if (exitPt)  pts.push(clampToHouse(exitPt))
    if (entryPt) pts.push(clampToHouse(entryPt))
  }
  pts.push(clampToHouse(target))
  return pts
}

function generateSpiralPath(x: number, y: number, w: number, h: number, step = 20): Pt[] {
  const pts: Pt[] = []
  let cx = x, cy = y, cw = w, ch = h
  while (cw >= step && ch >= step) {
    pts.push({ x: cx,      y: cy      })
    pts.push({ x: cx,      y: cy + ch })
    pts.push({ x: cx + cw, y: cy + ch })
    pts.push({ x: cx + cw, y: cy      })
    cx += step; cy += step; cw -= 2 * step; ch -= 2 * step
  }
  if (cw > 0 && ch > 0) pts.push({ x: Math.round(cx + cw / 2), y: Math.round(cy + ch / 2) })
  return pts
}

function getCleaningOrder(zone: string | string[] | null): RoomId[] {
  return CLEAN_ORDER.filter(r => getRoomIds(zone).includes(r))
}

function buildSpiralCleaningPath(rooms: RoomId[], startRoom: RoomId | null): Pt[] {
  const allPts: Pt[] = []
  let prevRoom = startRoom
  for (const roomId of rooms) {
    const b = SPIRAL_BOUNDS[roomId]
    if (!b) continue
    if (b.w < 20 || b.h < 20) {
      const center: Pt = { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) }
      allPts.push(...buildPath(prevRoom, roomId, center))
      prevRoom = roomId
      continue
    }
    const spiralPts = generateSpiralPath(b.x, b.y, b.w, b.h)
    if (spiralPts.length === 0) continue
    allPts.push(...buildPath(prevRoom, roomId, spiralPts[0]))
    allPts.push(...spiralPts.slice(1))
    prevRoom = roomId
  }
  return allPts
}

/* ─── SVG 2D → 3D 좌표 변환 ──────────────────────────────
 *
 * GLB 실측 앵커:
 *   RobotVacuum003 world pos : (459.92,  0.00, -15.08)
 *   Robot cleaner..003 local : ( 0.00,   0.00, +0.267)  → world (459.92, 0, -14.81)
 *
 *   SVG DOCK (480, 314) ↔ 3D robot body (459.92, 0, -14.81)
 *
 * 스케일:
 *   3D 방 X 범위 ≈ 456~466  (10 unit) / SVG 하우스 X 30~891 (861 px)
 *   3D 방 Z 범위 ≈ -8~-17   (9 unit)  / SVG 하우스 Y 30~379 (349 px)
 *   SVG Y 증가 → 3D Z 감소 (더 깊숙이)
 */
const SVG_DOCK: Pt    = { x: 480, y: 314 }
const D3_DOCK_X       = 459.92
const D3_DOCK_Z       = -14.81
const SCALE_X         = 10 / 861
const SCALE_Z         = -9 / 349

function svgTo3D(pt: Pt): THREE.Vector3 {
  return new THREE.Vector3(
    D3_DOCK_X + (pt.x - SVG_DOCK.x) * SCALE_X,
    0.02,
    D3_DOCK_Z + (pt.y - SVG_DOCK.y) * SCALE_Z,
  )
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
    rv.action === 'cleaning'  ? '청소 중'  :
    rv.action === 'docked'    ? '충전 중'  :
    rv.action === 'returning' ? '복귀 중'  :
    rv.action === 'paused'    ? '일시정지' : '대기'

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

  const raw = (tv.content_name || tv.channel || '').trim()
  if (!raw) {
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)
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

    scene.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        (child.material as THREE.Material).name === 'TV_Screen'
      ) {
        child.material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
      }
    })

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

function ACParticles() {
  const ac = useDeviceStore(s => s.devices.air_conditioner)

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
    if (ac.power === 'off') return
    const attr = geometry.attributes.position
    const pos  = attr.array as Float32Array
    const isHeat = ac.mode === 'heat'
    const vy = isHeat ? 0.005 : -0.008

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i*3]   += (Math.random() - 0.5) * 0.003
      pos[i*3+1] += vy + (Math.random() - 0.5) * 0.001
      // AC가 Z=-14.42, 실내는 Z=-8 방향 → 양의 Z로 확산
      pos[i*3+2] += 0.005 + (Math.random() - 0.5) * 0.002

      const outOfBounds =
        pos[i*3+1] < 0.05 ||           // 바닥 도달
        pos[i*3+1] > AC_PY + 1.2 ||    // 너무 높음
        pos[i*3+2] > AC_PZ + 1.5 ||    // 너무 앞
        Math.abs(pos[i*3] - AC_PX) > 0.6

      if (outOfBounds) {
        pos[i*3]   = AC_PX + (Math.random() - 0.5) * 0.35
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
      <pointsMaterial size={0.025} color={color} transparent opacity={0.65} sizeAttenuation />
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

/* ─── 디바이스 상태 라벨 ──────────────────────────────────
 *
 * GLB 실측 좌표 사용 (JSON 청크에서 추출):
 *   AirConditioner : (456.75, 1.05, -14.70)
 *   TV             : (461.78, 0.72, -14.70)
 *   Air Purfiers   : (460.85, 0.00, -15.05)
 */
function DeviceLabels() {
  const { air_conditioner: ac, tv, air_purifier: ap } = useDeviceStore((s) => s.devices)

  const items = [
    {
      id: 'ac',
      label: '에어컨',
      pos: [456.75, 1.7, -14.70] as [number, number, number],
      active: ac.power === 'on',
      info: ac.power === 'on' ? `${ac.temperature}°C · ${ac.mode}` : 'OFF',
    },
    {
      id: 'tv',
      label: 'TV',
      pos: [461.78, 1.4, -14.70] as [number, number, number],
      active: tv.power === 'on',
      info: tv.power === 'on' ? (tv.content_name || tv.channel || 'ON') : 'OFF',
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

/* ─── 섹터 디버그 시각화 ─────────────────────────────────── */

const SECTORS = [
  { name: '주방',  x1: 455,   x2: 460.5, z1: -18,   z2: -13.5, color: '#facc15' },
  { name: '거실',  x1: 460.5, x2: 467,   z1: -17.5, z2: -12,   color: '#60a5fa' },
  { name: '침실1', x1: 455,   x2: 460.5, z1: -13.5, z2: -9,    color: '#4ade80' },
  { name: '침실2', x1: 460.5, x2: 464,   z1: -10.5, z2: -7.5,  color: '#f87171' },
  { name: '침실3', x1: 464,   x2: 467,   z1: -10.5, z2: -7.5,  color: '#c084fc' },
]

function SectorDebug() {
  return (
    <>
      {SECTORS.map(({ name, x1, x2, z1, z2, color }) => {
        const cx = (x1 + x2) / 2
        const cz = (z1 + z2) / 2
        const w  = x2 - x1
        const d  = Math.abs(z2 - z1)
        return (
          <group key={name}>
            <mesh position={[cx, 0.05, cz]}>
              <boxGeometry args={[w, 0.1, d]} />
              <meshBasicMaterial color={color} transparent opacity={0.2} />
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
      })}
    </>
  )
}

/* ─── 메인 컴포넌트 ──────────────────────────────────────── */

export function RoomSimulator() {
  const rv = useDeviceStore((s) => s.devices.robot_vacuum)

  const [rvPos, setRvPos] = useState<Pt>(DOCK)
  const currentRoomRef   = useRef<RoomId | null>('family_room')
  const pathRef          = useRef<Pt[]>([])
  const timerRef         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rvRef            = useRef(rv)
  useEffect(() => { rvRef.current = rv })

  const handleBox = useCallback((_b: THREE.Box3) => {}, [])  // Bounds 컴포넌트 필요

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    const triggerReturnToDock = () => {
      fetch('/api/v1/command/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: 'robot_vacuum', parameters: { action: 'return_to_dock' } }),
      }).catch(() => {})
    }

    const cleanStep = () => {
      if (rvRef.current.action !== 'cleaning') return
      if (pathRef.current.length > 0) {
        const next = clampToHouse(pathRef.current.shift()!)
        setRvPos(next)
        currentRoomRef.current = detectRoom(next.x, next.y) ?? currentRoomRef.current
        timerRef.current = setTimeout(cleanStep, 800)
      } else {
        triggerReturnToDock()
      }
    }

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
      pathRef.current = buildSpiralCleaningPath(getCleaningOrder(rv.zone), startRoom)
      timerRef.current = setTimeout(cleanStep, 300)
    } else if (rv.action === 'returning' || rv.action === 'docked') {
      returnToDock()
    }

    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rv.action, rv.zone])

  return (
    <div style={{ flex: 1, height: '100%', minHeight: 450 }}>
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
          <DeviceLabels />
          <SectorDebug />
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
