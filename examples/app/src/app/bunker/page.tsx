'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Agent, Task } from 'mahler'
import { CameraControls } from '@react-three/drei'

type Vec3 = [number, number, number]

// Scenario nodes
const N = Object.freeze({
  COURTYARD: 'courtyard',
  TABLE: 'table_area',
  STORAGE_DOOR: 'storage_door',
  STORAGE_INT: 'storage_interior',
  C4_TABLE: 'c4_table',
  BUNKER_DOOR: 'bunker_door',
  BUNKER_INT: 'bunker_interior',
  STAR: 'star_pos',
  SAFE: 'safe_spot',
} as const)

type NodeId = (typeof N)[keyof typeof N]

// Building configuration
type BuildingConfig = {
  center: Vec3
  size: [number, number, number] // [width, height, depth]
  doorFace: 'north' | 'south' | 'east' | 'west'
  doorOffset?: number // distance from building edge for door positioning
}

const BUILDINGS: Record<string, BuildingConfig> = {
  STORAGE: {
    center: [-10, 0, 8],
    size: [5, 3.5, 3.5],
    doorFace: 'east',
    doorOffset: 2 // meters from building edge
  },
  BUNKER: {
    center: [15, 0, 0],
    size: [5.5, 4, 4],
    doorFace: 'west',
    doorOffset: 3 // meters from building edge
  }
}

// Helper functions for building geometry calculations
function getBuildingInteriorPosition(building: BuildingConfig, offsetFromCenter: Vec3 = [0, 0, 0]): Vec3 {
  const [centerX, centerY, centerZ] = building.center
  const [offsetX, offsetY, offsetZ] = offsetFromCenter
  return [centerX + offsetX, centerY + offsetY, centerZ + offsetZ]
}

function getBuildingDoorPosition(building: BuildingConfig): Vec3 {
  const [centerX, centerY, centerZ] = building.center
  const [width, height, depth] = building.size
  const offset = building.doorOffset || 0

  switch (building.doorFace) {
    case 'east':
      return [centerX + width / 2 + offset, centerY, centerZ]
    case 'west':
      return [centerX - width / 2 - offset, centerY, centerZ]
    case 'south':
      return [centerX, centerY, centerZ + depth / 2 + offset]
    case 'north':
      return [centerX, centerY, centerZ - depth / 2 - offset]
  }
}

// Additional helper to get building bounds for validation
function getBuildingBounds(building: BuildingConfig): { min: Vec3; max: Vec3 } {
  const [centerX, centerY, centerZ] = building.center
  const [width, height, depth] = building.size
  return {
    min: [centerX - width / 2, centerY - height / 2, centerZ - depth / 2],
    max: [centerX + width / 2, centerY + height / 2, centerZ + depth / 2]
  }
}

// Helper to check if a position is inside a building
function isPositionInsideBuilding(position: Vec3, building: BuildingConfig): boolean {
  const bounds = getBuildingBounds(building)
  const [x, y, z] = position
  return (
    x >= bounds.min[0] && x <= bounds.max[0] &&
    y >= bounds.min[1] && y <= bounds.max[1] &&
    z >= bounds.min[2] && z <= bounds.max[2]
  )
}

// Calculated positions for each node
const NODE_POS: Record<NodeId, Vec3> = {
  // Fixed outdoor positions
  [N.COURTYARD]: [0, 0, 0],
  [N.TABLE]: [-10, 0, 0],
  [N.SAFE]: [0, 0, -10],

  // Storage building positions (mathematically calculated)
  // Storage building spans: [-12.5 to -7.5, 0, 6.25 to 9.75]
  [N.STORAGE_DOOR]: getBuildingDoorPosition(BUILDINGS.STORAGE), // [-5.5, 0, 8] (east side + 2m offset)
  [N.STORAGE_INT]: getBuildingInteriorPosition(BUILDINGS.STORAGE), // [-10, 0, 8] (center)
  [N.C4_TABLE]: getBuildingInteriorPosition(BUILDINGS.STORAGE, [-2, 0, 0]), // [-12, 0, 8] (inside, left of center)

  // Bunker building positions (mathematically calculated)
  // Bunker building spans: [12.25 to 17.75, 0, -2 to 2]
  [N.BUNKER_DOOR]: getBuildingDoorPosition(BUILDINGS.BUNKER), // [9.25, 0, 0] (west side - 3m offset)
  [N.BUNKER_INT]: getBuildingInteriorPosition(BUILDINGS.BUNKER), // [15, 0, 0] (center)
  [N.STAR]: getBuildingInteriorPosition(BUILDINGS.BUNKER, [2, 0, 0]), // [17, 0, 0] (inside, right of center)
}

// Adjacency and gates
type WorldState = {
  agentAt: NodeId
  keyOnTable: boolean
  c4Available: boolean
  starPresent: boolean
  hasKey: boolean
  hasC4: boolean
  hasStar: boolean
  storageUnlocked: boolean
  c4Placed: boolean
  bunkerBreached: boolean
}

const initial: WorldState = {
  agentAt: N.COURTYARD,
  keyOnTable: true,
  c4Available: true,
  starPresent: true,
  hasKey: false,
  hasC4: false,
  hasStar: false,
  storageUnlocked: false,
  c4Placed: false,
  bunkerBreached: false,
}

type Edge = [NodeId, NodeId, (s: WorldState) => boolean]
const RAW_EDGES: Edge[] = [
  [N.COURTYARD, N.TABLE, () => true],
  [N.COURTYARD, N.STORAGE_DOOR, () => true],
  [N.COURTYARD, N.BUNKER_DOOR, () => true],
  [N.COURTYARD, N.SAFE, () => true],
  [N.TABLE, N.STORAGE_DOOR, () => true],
  [N.STORAGE_DOOR, N.STORAGE_INT, (s) => s.storageUnlocked === true],
  [N.STORAGE_INT, N.C4_TABLE, () => true],
  [N.BUNKER_DOOR, N.BUNKER_INT, (s) => s.bunkerBreached === true],
  [N.BUNKER_DOOR, N.SAFE, () => true],
  [N.BUNKER_INT, N.STAR, () => true],
]

function makeAdjacency(raw: Edge[]) {
  const map: Record<string, Array<{ to: NodeId; when: (s: WorldState) => boolean }>> = {}
  for (const [a, b, when] of raw) {
    ;(map[a] ||= []).push({ to: b, when })
    ;(map[b] ||= []).push({ to: a, when })
  }
  return map
}
const ADJ = makeAdjacency(RAW_EDGES)

function neighbors(state: WorldState, from: NodeId) {
  return (ADJ[from] || [])
    .filter((e) => e.when(state))
    .map((e) => e.to)
}

function isImmediatellyReachable(state: WorldState, from: NodeId, to: NodeId) {
  return neighbors(state, from).includes(to)
}

function findPath(state: WorldState, from: NodeId, to: NodeId): NodeId[] | null {
  if (from === to) return [from]
  const seen = new Set<NodeId>([from])
  const q: NodeId[] = [from]
  const prev = new Map<NodeId, NodeId>()
  while (q.length) {
    const cur = q.shift()!
    for (const n of neighbors(state, cur)) {
      if (seen.has(n)) continue
      seen.add(n)
      prev.set(n, cur)
      if (n === to) {
        const path = [to]
        let p = prev.get(to)
        while (p !== undefined) {
          path.push(p)
          p = prev.get(p)
        }
        path.reverse()
        return path
      }
      q.push(n)
    }
  }
  return null
}

// Simple ground plane - expanded for larger space
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial color="#1f2937" />
    </mesh>
  )
}

function BoxMarker({ position, color = '#34495e', label }: { position: Vec3; color?: string; label: string }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.4, 1.2]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[1.2, 0.02, 1.2]} />
        <meshStandardMaterial color="#95a5a6" />
      </mesh>
      <LabelSprite position={[0, 0.9, 0]} text={label} />
    </group>
  )
}

function SmallSphere({ position, color = 'gold', visible = true, size = 0.18 }: { position: Vec3; color?: string; visible?: boolean; size?: number }) {
  if (!visible) return null
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[size, 16, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
    </mesh>
  )
}

function EnhancedObject({ position, color, type, visible = true, size = 0.25 }: {
  position: Vec3;
  color: string;
  type: 'key' | 'c4' | 'star';
  visible?: boolean;
  size?: number;
}) {
  if (!visible) return null

  return (
    <group position={position}>
      {/* Main sphere */}
      <mesh castShadow>
        <sphereGeometry args={[size, 20, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          metalness={type === 'key' ? 0.8 : 0.2}
          roughness={type === 'key' ? 0.2 : 0.4}
        />
      </mesh>

      {/* Glowing aura */}
      <mesh>
        <sphereGeometry args={[size * 1.3, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.1}
          transparent
          opacity={0.3}
        />
      </mesh>

      {/* Floating animation */}
      <AnimatedFloat yOffset={0.1} speed={2}>
        <mesh position={[0, 0.05, 0]}>
          <sphereGeometry args={[size * 0.7, 8, 8]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            transparent
            opacity={0.6}
          />
        </mesh>
      </AnimatedFloat>
    </group>
  )
}

function AnimatedFloat({ children, yOffset = 0.1, speed = 1 }: { children: React.ReactNode; yOffset?: number; speed?: number }) {
  const ref = useRef<THREE.Group>(null!)

  useFrame((state) => {
    if (ref.current) {
      ref.current.position.y = Math.sin(state.clock.elapsedTime * speed) * yOffset
      ref.current.rotation.y = state.clock.elapsedTime * 0.5
    }
  })

  return <group ref={ref}>{children}</group>
}

function InventoryItem({
  agentPos,
  type,
  color,
  index,
  size = 0.15
}: {
  agentPos: Vec3;
  type: 'key' | 'c4' | 'star';
  color: string;
  index: number;
  size?: number;
}) {
  const ref = useRef<THREE.Group>(null!)

  useFrame((state) => {
    if (ref.current) {
      // Position items in a circle above the agent
      const angle = (index * Math.PI * 2) / 3 + state.clock.elapsedTime * 0.5 // Rotate slowly
      const radius = 0.8
      const height = 1.8 + Math.sin(state.clock.elapsedTime * 2 + index) * 0.1 // Bobbing motion

      ref.current.position.set(
        agentPos[0] + Math.cos(angle) * radius,
        agentPos[1] + height,
        agentPos[2] + Math.sin(angle) * radius
      )
    }
  })

  return (
    <group ref={ref}>
      <mesh castShadow>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          metalness={type === 'key' ? 0.8 : 0.2}
          roughness={type === 'key' ? 0.2 : 0.4}
        />
      </mesh>

      {/* Glowing trail effect */}
      <mesh>
        <sphereGeometry args={[size * 1.2, 8, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.2}
          transparent
          opacity={0.4}
        />
      </mesh>
    </group>
  )
}

function PickupAnimation({
  animation,
  onComplete
}: {
  animation: {
    active: boolean
    startPos: Vec3
    endPos: Vec3
    startTime: number
    duration: number
    type: 'key' | 'c4' | 'star'
    color: string
  };
  onComplete: () => void;
}) {
  const ref = useRef<THREE.Group>(null!)

  useFrame(() => {
    if (!animation.active || !ref.current) return

    const now = performance.now()
    const elapsed = now - animation.startTime
    const progress = Math.min(elapsed / animation.duration, 1)

    // Smooth easing
    const eased = 1 - Math.pow(1 - progress, 3)

    // Interpolate position with arc
    const start = new THREE.Vector3(...animation.startPos)
    const end = new THREE.Vector3(...animation.endPos)
    const mid = start.clone().lerp(end, 0.5)
    mid.y += 1.5 // Arc height

    let currentPos: THREE.Vector3
    if (eased < 0.5) {
      currentPos = start.clone().lerp(mid, eased * 2)
    } else {
      currentPos = mid.clone().lerp(end, (eased - 0.5) * 2)
    }

    ref.current.position.copy(currentPos)
    ref.current.scale.setScalar(1 - eased * 0.3) // Shrink as it approaches agent

    if (progress >= 1) {
      onComplete()
    }
  })

  if (!animation.active) return null

  return (
    <group ref={ref}>
      <mesh castShadow>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial
          color={animation.color}
          emissive={animation.color}
          emissiveIntensity={0.6}
        />
      </mesh>
    </group>
  )
}

function LabelSprite({ position, text, color = '#ffffff', bg = 'rgba(0,0,0,0.55)' }: { position: Vec3; text: string; color?: string; bg?: string }) {
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  if (textureRef.current == null) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    canvasRef.current = canvas
    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    textureRef.current = tex
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // background
    ctx.fillStyle = bg
    const padX = 24
    const padY = 16
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // text
    ctx.fillStyle = color
    ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 6)
    textureRef.current!.needsUpdate = true
  }, [text, color, bg])

  useEffect(() => () => textureRef.current?.dispose(), [])

  return (
    <sprite position={position} scale={[2.4, 0.6, 1]}>
      <spriteMaterial map={textureRef.current!} transparent depthWrite={false} />
    </sprite>
  )
}

type Face = 'north' | 'south' | 'east' | 'west'

function Building({
  center,
  size,
  color = '#4b5563',
  label,
  doorFace,
  doorSize = [1, 1.6] as [number, number],
  doorColor = '#a78bfa',
  showDoor = true,
  opacity = 1,
}: {
  center: Vec3
  size: [number, number, number]
  color?: string
  label: string
  doorFace: Face
  doorSize?: [number, number]
  doorColor?: string
  showDoor?: boolean
  opacity?: number
}) {
  const [dx, dy, dz] = size
  const eps = 0.02

  function doorTransform(face: Face): { pos: Vec3; rotY: number } {
    // Local to building center; y is placed so door rests on ground
    const y = -dy / 2 + doorSize[1] / 2
    switch (face) {
      case 'east':
        return { pos: [dx / 2 + eps, y, 0], rotY: Math.PI / 2 }
      case 'west':
        return { pos: [-dx / 2 - eps, y, 0], rotY: Math.PI / 2 }
      case 'south':
        return { pos: [0, y, dz / 2 + eps], rotY: 0 }
      case 'north':
      default:
        return { pos: [0, y, -dz / 2 - eps], rotY: 0 }
    }
  }

  const { pos: doorPosLocal, rotY } = doorTransform(doorFace)

  return (
    <group position={[center[0], dy / 2, center[2]]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[dx, dy, dz]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} />
      </mesh>

      {showDoor && (
        <mesh position={doorPosLocal} rotation={[0, rotY, 0]} castShadow>
          <boxGeometry args={[doorSize[0], doorSize[1], 0.08]} />
          <meshStandardMaterial color={doorColor} />
        </mesh>
      )}

      <LabelSprite position={[0, dy / 2 + 0.6, 0]} text={label} />
    </group>
  )
}

function AgentMesh({ getPos }: { getPos: () => Vec3 }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const [x, y, z] = getPos()
    ref.current.position.set(x, y, z)
  })
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshStandardMaterial color="#4ade80" />
    </mesh>
  )
}

export default function BunkerPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD])
  const agentPosRef = useRef<Vec3>(agentPos)
  const motionRef = useRef<{
    active: boolean
    start: THREE.Vector3
    end: THREE.Vector3
    startTime: number
    durationMs: number
    resolve?: () => void
  }>({ active: false, start: new THREE.Vector3(), end: new THREE.Vector3(), startTime: 0, durationMs: 800 })

  const [world, setWorld] = useState<WorldState>(initial)
  const [status, setStatus] = useState<string>('')
  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({})

  // Pickup animations state
  const [pickupAnimations, setPickupAnimations] = useState<{
    [key: string]: {
      active: boolean
      startPos: Vec3
      endPos: Vec3
      startTime: number
      duration: number
      type: 'key' | 'c4' | 'star'
      color: string
    }
  }>({})

  // Imperative motion via useFrame
  function AnimateController() {
    useFrame(() => {
      const m = motionRef.current
      if (!m.active) return
      const now = performance.now()
      const t = Math.min(1, (now - m.startTime) / m.durationMs)
      const cur = new THREE.Vector3().copy(m.start).lerp(m.end, t)
      const v: Vec3 = [cur.x, cur.y, cur.z]
      agentPosRef.current = v
      setAgentPos(v)
      if (t >= 1) {
        m.active = false
        m.resolve?.()
        m.resolve = undefined
      }
    })
    return null
  }

  const apiRef = useRef<{
    moveTo: (n: NodeId) => Promise<void>;
    explodeAt: (n: NodeId) => Promise<void>;
    startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>;
  } | null>(null)

  if (apiRef.current == null) {
    apiRef.current = {
      moveTo: (n: NodeId) => {
        const target = NODE_POS[n]
        const cur = agentPosRef.current
        return new Promise<void>((resolve) => {
          motionRef.current.active = true
          motionRef.current.start.set(cur[0], cur[1], cur[2])
          motionRef.current.end.set(target[0], target[1], target[2])
          motionRef.current.startTime = performance.now()
          motionRef.current.durationMs = 800
          motionRef.current.resolve = resolve
        })
      },
      explodeAt: async (n: NodeId) => {
        const at = NODE_POS[n]
        setBoom({ at, t: performance.now() })
        await new Promise((r) => setTimeout(r, 500))
        setBoom({})
      },
      startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_${performance.now()}`
        const agentPos = agentPosRef.current
        const endPos: Vec3 = [agentPos[0], agentPos[1] + 1.5, agentPos[2]]

        return new Promise<void>((resolve) => {
          setPickupAnimations(prev => ({
            ...prev,
            [animId]: {
              active: true,
              startPos: fromPos,
              endPos,
              startTime: performance.now(),
              duration: 800,
              type,
              color
            }
          }))

          // Clean up animation after completion
          setTimeout(() => {
            setPickupAnimations(prev => {
              const newAnims = { ...prev }
              delete newAnims[animId]
              return newAnims
            })
            resolve()
          }, 800)
        })
      },
    }
  }

  // Build tasks once, actions capture apiRef via closure
  const tasks = useMemo(() => {
    const Move = Task.of<WorldState>().from({
      lens: '/agentAt',
      condition: (agentAt, { target, system }) => agentAt !== target && isImmediatellyReachable(system, agentAt, target as NodeId),
      effect: (agentAt, { target }) => {
        agentAt._ = target as NodeId
      },
      action: async (agentAt, { target }) => {
        await apiRef.current!.moveTo(target as NodeId)
        agentAt._ = target as NodeId
      },
      description: ({ target }) => `Move to ${String(target)}`,
    })

    const PickUpKey = Task.from<WorldState>({
      condition: (state) => !state.hasKey && state.agentAt === N.TABLE,
      effect: (state) => {
        state._.hasKey = true
        state._.keyOnTable = false
      },
      action: async (state) => {
        await apiRef.current!.startPickupAnimation(NODE_POS[N.TABLE], 'key', '#fbbf24')
        state._.hasKey = true
        state._.keyOnTable = false
      },
      description: 'Pick up key',
    })

    const UnlockStorage = Task.from<WorldState>({
      condition: (state) => state.hasKey && !state.storageUnlocked && state.agentAt === N.STORAGE_DOOR,
      effect: (state) => {
        state._.storageUnlocked = true
      },
      action: async (state) => {
        await new Promise((r) => setTimeout(r, 200))
        state._.storageUnlocked = true
      },
      description: 'Unlock storage door with key',
    })

    const PickUpC4 = Task.from<WorldState>({
      condition: (state) => !state.hasC4 && state.agentAt === N.C4_TABLE,
      effect: (state) => {
        state._.hasC4 = true
        state._.c4Available = false
      },
      action: async (state) => {
        await apiRef.current!.startPickupAnimation(NODE_POS[N.C4_TABLE], 'c4', '#ef4444')
        state._.hasC4 = true
        state._.c4Available = false
      },
      description: 'Pick up C4',
    })

    const PlaceC4 = Task.from<WorldState>({
      condition: (state) => state.hasC4 && !state.c4Placed && state.agentAt === N.BUNKER_DOOR,
      effect: (state) => {
        state._.hasC4 = false
        state._.c4Placed = true
      },
      action: async (state) => {
        await new Promise((r) => setTimeout(r, 200))
        state._.hasC4 = false
        state._.c4Placed = true
      },
      description: 'Place C4 on bunker',
    })

    const Detonate = Task.from<WorldState>({
      condition: (state) => state.c4Placed && !state.bunkerBreached && state.agentAt === N.SAFE,
      effect: (state) => {
        state._.bunkerBreached = true
        state._.c4Placed = false
      },
      action: async (state) => {
        await apiRef.current!.explodeAt(N.BUNKER_DOOR)
        state._.bunkerBreached = true
        state._.c4Placed = false
      },
      description: 'Detonate C4 (boom)',
    })

    const PickUpStar = Task.from<WorldState>({
      condition: (state) => !state.hasStar && state.starPresent && state.agentAt === N.STAR,
      effect: (state) => {
        state._.hasStar = true
        state._.starPresent = false
      },
      action: async (state) => {
        await apiRef.current!.startPickupAnimation(NODE_POS[N.STAR], 'star', '#fde68a')
        state._.hasStar = true
        state._.starPresent = false
      },
      description: 'Pick up star',
    })

    const GoTo = Task.of<WorldState>().from({
      lens: '/agentAt',
      condition: (agentAt, { target }) => agentAt !== target,
      expansion: 'sequential',
      method: (agentAt, { system, target }) => {
        const path = findPath(system, agentAt as NodeId, target as NodeId)
        if (!path || path.length < 2) return []
        return path.slice(1).map((step) => Move({ target: step }))
      },
      description: ({ target }) => `Go to ${String(target)}`,
    })

    const AcquireKey = Task.from<WorldState>({
      condition: (state) => !state.hasKey,
      expansion: 'sequential',
      method: (_state, ctx) => [GoTo({ target: N.TABLE }), PickUpKey({ target: ctx.target })],
      description: 'Acquire key',
    })

    const AcquireC4 = Task.from<WorldState>({
      condition: (state) => !state.hasC4,
      expansion: 'sequential',
      method: (state, ctx) => {
        const steps: any[] = [GoTo({ target: N.STORAGE_DOOR })]
        if (!state.storageUnlocked) steps.push(UnlockStorage({ target: ctx.target }))
        steps.push(GoTo({ target: N.C4_TABLE }), PickUpC4({ target: ctx.target }))
        return steps
      },
      description: 'Acquire C4',
    })

    const BreachBunker = Task.from<WorldState>({
      condition: (state) => !state.bunkerBreached,
      expansion: 'sequential',
      method: (state, ctx) => {
        const steps: any[] = []
        if (!state.c4Placed) steps.push(GoTo({ target: N.BUNKER_DOOR }), PlaceC4({ target: ctx.target }))
        steps.push(GoTo({ target: N.SAFE }), Detonate({ target: ctx.target }))
        return steps
      },
      description: 'Breach bunker',
    })

    const GetStar = Task.from<WorldState>({
      condition: (state) => !state.hasStar && state.starPresent === true,
      expansion: 'sequential',
      method: (_state, ctx) => [GoTo({ target: N.STAR }), PickUpStar({ target: ctx.target })],
      description: 'Collect star',
    })

    return [
      // Methods
      GoTo,
      AcquireKey,
      AcquireC4,
      BreachBunker,
      GetStar,
      // Actions
      Move,
      PickUpKey,
      UnlockStorage,
      PickUpC4,
      PlaceC4,
      Detonate,
      PickUpStar,
    ]
  }, [])

  // Setup & run agent once
  useEffect(() => {
    let stopped = false
    const agent = Agent.from<WorldState>({ initial, tasks })
    const sub = agent.subscribe((s) => {
      if (!stopped) setWorld(s)
    })
    ;(async () => {
      setStatus('Planning...')
      agent.seek({ hasStar: true })
      const res = await agent.wait()
      if (!stopped) setStatus(res.success ? 'Mission complete' : 'Mission failed')
    })()
    return () => {
      stopped = true
      sub.unsubscribe()
      agent.stop()
    }
  }, [tasks])

  const getAgentPos = () => agentPos

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Bunker Mission (HTN + Three.js)</h1>
        <p className="text-gray-300 mb-4">Status: {status || 'Running...'}</p>

        <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
		  	<CameraControls makeDefault />
			<ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />
            <AnimateController />

            <Ground />
            {/* Grid helper - expanded for larger space */}
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Buildings and markers */}
            <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
            <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />

            {/* Storage building - using calculated positions */}
            <Building
              center={BUILDINGS.STORAGE.center}
              size={BUILDINGS.STORAGE.size}
              color="#3f6212"
              label="Storage"
              doorFace={BUILDINGS.STORAGE.doorFace}
              doorColor={world.storageUnlocked ? '#16a34a' : '#a16207'}
              showDoor={!world.storageUnlocked}
              opacity={world.agentAt === N.STORAGE_INT || world.agentAt === N.C4_TABLE || world.agentAt === N.STORAGE_DOOR ? 0.3 : 1}
            />
            {/* Reference markers for pathfinding nodes */}
            <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color={world.storageUnlocked ? '#16a34a' : '#a16207'} label="Storage Door" />
            <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />

            {/* Bunker building - using calculated positions */}
            <Building
              center={BUILDINGS.BUNKER.center}
              size={BUILDINGS.BUNKER.size}
              color="#374151"
              label="Bunker"
              doorFace={BUILDINGS.BUNKER.doorFace}
              doorColor={world.bunkerBreached ? '#16a34a' : '#7c2d12'}
              showDoor={!world.bunkerBreached}
              opacity={world.agentAt === N.BUNKER_INT || world.agentAt === N.STAR || world.agentAt === N.BUNKER_DOOR ? 0.3 : 1}
            />
            <BoxMarker position={NODE_POS[N.BUNKER_DOOR]} color={world.bunkerBreached ? '#16a34a' : '#7c2d12'} label="Bunker Door" />

            <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
            <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Safe Spot" />

            {/* Objects in world */}
            <EnhancedObject
              position={NODE_POS[N.TABLE]}
              color="#fbbf24"
              type="key"
              visible={world.keyOnTable}
            />
            <EnhancedObject
              position={NODE_POS[N.C4_TABLE]}
              color="#ef4444"
              type="c4"
              visible={world.c4Available}
            />
            <SmallSphere
              position={NODE_POS[N.BUNKER_DOOR]}
              color="#ef4444"
              visible={world.c4Placed}
              size={0.2}
            />
            <EnhancedObject
              position={NODE_POS[N.STAR]}
              color="#fde68a"
              type="star"
              visible={world.starPresent}
            />

            {/* Agent */}
            <group>
              <AgentMesh getPos={getAgentPos} />
              {/* Agent label rendered in world space to avoid double transforms */}
              <LabelSprite position={[agentPos[0], 1.2, agentPos[2]]} text="Agent" />
            </group>

            {/* Inventory items hovering around agent */}
            {world.hasKey && (
              <InventoryItem
                agentPos={agentPos}
                type="key"
                color="#fbbf24"
                index={0}
              />
            )}
            {world.hasC4 && (
              <InventoryItem
                agentPos={agentPos}
                type="c4"
                color="#ef4444"
                index={1}
              />
            )}
            {world.hasStar && (
              <InventoryItem
                agentPos={agentPos}
                type="star"
                color="#fde68a"
                index={2}
              />
            )}

            {/* Pickup animations */}
            {Object.entries(pickupAnimations).map(([id, animation]) => (
              <PickupAnimation
                key={id}
                animation={animation}
                onComplete={() => {
                  setPickupAnimations(prev => {
                    const newAnims = { ...prev }
                    delete newAnims[id]
                    return newAnims
                  })
                }}
              />
            ))}

            {/* Explosion VFX */}
            {boom.at && (
              <mesh position={boom.at}>
                <sphereGeometry args={[0.4, 16, 16]} />
                <meshStandardMaterial color="#f97316" emissive="#dc2626" emissiveIntensity={1.2} transparent opacity={0.7} />
              </mesh>
            )}
          </Canvas>
        </div>

        <div className="mt-4 text-gray-300">
          <div>
            Inventory:{" "}
            <span>Key: {world.hasKey ? "true" : "false"}</span>
            {" | "}
            <span>C4: {world.hasC4 ? "true" : "false"}</span>
            {" | "}
            <span>Star: {world.hasStar ? "true" : "false"}</span>
          </div>
          <a href="/" className="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
    </div>
  )
}


