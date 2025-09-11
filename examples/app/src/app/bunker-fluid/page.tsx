'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'

// Reuse visuals from bunker page by importing the same file if desired.
// For simplicity, we inline minimal versions compatible with the existing scene.

type Vec3 = [number, number, number]

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

const BUILDINGS = {
  STORAGE: {
    center: [-10, 0, 8] as Vec3,
    size: [6, 3.5, 4.5] as [number, number, number],
    doorFace: 'east' as const,
    doorOffset: 1.5,
    doorSize: [1.2, 1.6] as [number, number],
  },
  BUNKER: {
    center: [15, 0, 0] as Vec3,
    size: [7, 5, 7] as [number, number, number],
    doorFace: 'west' as const,
    doorOffset: 1.5,
    doorSize: [1.8, 2.4] as [number, number],
  },
}

function getBuildingInteriorPosition(building: (typeof BUILDINGS)[keyof typeof BUILDINGS], offset: Vec3 = [0, 0, 0]): Vec3 {
  const [cx, cy, cz] = building.center
  const [ox, oy, oz] = offset
  return [cx + ox, cy + oy, cz + oz]
}
function getBuildingDoorPosition(building: (typeof BUILDINGS)[keyof typeof BUILDINGS]): Vec3 {
  const [cx, cy, cz] = building.center
  const [w, _h, d] = building.size
  const off = building.doorOffset || 0
  switch (building.doorFace) {
    case 'east': return [cx + w / 2 + off, cy, cz]
    case 'west': return [cx - w / 2 - off, cy, cz]
    default: return [cx, cy, cz - d / 2 - off]
  }
}

const NODE_POS: Record<NodeId, Vec3> = {
  [N.COURTYARD]: [0, 0, 0],
  [N.TABLE]: [-10, 0, 0],
  [N.SAFE]: (() => { const p = getBuildingDoorPosition(BUILDINGS.BUNKER); return [p[0] - 5, p[1], p[2]] })(),
  [N.STORAGE_DOOR]: getBuildingDoorPosition(BUILDINGS.STORAGE),
  [N.STORAGE_INT]: getBuildingInteriorPosition(BUILDINGS.STORAGE),
  [N.C4_TABLE]: getBuildingInteriorPosition(BUILDINGS.STORAGE, [-1, 0, 0]),
  [N.BUNKER_DOOR]: getBuildingDoorPosition(BUILDINGS.BUNKER),
  [N.BUNKER_INT]: getBuildingInteriorPosition(BUILDINGS.BUNKER),
  [N.STAR]: getBuildingInteriorPosition(BUILDINGS.BUNKER, [2, 0, 0]),
}

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
        <boxGeometry args={[2, 0.4, 2]} />
        <meshStandardMaterial color={color} />
      </mesh>
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

export default function BunkerFluidPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD])
  const agentPosRef = useRef<Vec3>(agentPos)
  const [status, setStatus] = useState<string>('Idle')
  const [lastMs, setLastMs] = useState<number | null>(null)

  const getAgentPos = () => agentPos

  useEffect(() => {
    agentPosRef.current = agentPos
  }, [agentPos])

  async function runFluidPlan() {
    setStatus('Planning...')
    const t0 = performance.now()
    const worker = new Worker('/workers/fluid-htn.worker.js', { type: 'module' })

    const steps: string[] = await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const { type, steps, elapsedMs, message } = ev.data || {}
        if (type === 'result') {
          console.log('[bunker-fluid] plan result', { elapsedMs, steps })
          setLastMs(elapsedMs)
          resolve(steps)
        } else if (type === 'error') {
          console.error('[bunker-fluid] plan error', message)
          reject(new Error(message))
        }
        worker.terminate()
      }
      // Send goalKey and optional debug; default to full mission (hasStar)
      worker.postMessage({ type: 'plan', goalKey: 'hasStar', enableDebug: false })
    })

    const t1 = performance.now()
    // Execute simple animation for movement steps
    setStatus(`Executing plan (${Math.round(t1 - t0)} ms to plan)`)
    console.log('[bunker-fluid] executing steps', steps)

    for (const s of steps) {
      const [op, arg] = s.split(' ')
      if (op === 'MOVE' && arg) {
        await animateMove(arg as NodeId)
      }
      // Non-movement ops: just briefly wait to show progression
      if (op !== 'MOVE') await new Promise((r) => setTimeout(r, 200))
    }
    setStatus('Done')
  }

  function animateMove(target: NodeId) {
    const start = agentPosRef.current
    const end = NODE_POS[target]
    const startVec = new THREE.Vector3(...start)
    const endVec = new THREE.Vector3(...end)
    const durationMs = 600
    const startTime = performance.now()
    return new Promise<void>((resolve) => {
      function tick() {
        const t = Math.min(1, (performance.now() - startTime) / durationMs)
        const cur = startVec.clone().lerp(endVec, t)
        const v: Vec3 = [cur.x, cur.y, cur.z]
        agentPosRef.current = v
        setAgentPos(v)
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Bunker (Fluid HTN + WASM)</h1>
        <p className="text-gray-300 mb-4">Status: {status} {lastMs != null ? `(planner ${lastMs} ms)` : ''}</p>
        <button onClick={runFluidPlan} className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg mb-3">Run Fluid Plan</button>

        <div className="w-full h-[70vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
            <CameraControls makeDefault />
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />

            <Ground />
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Reference markers */}
            <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
            <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />
            <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color="#a16207" label="Storage Door" />
            <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />
            <BoxMarker position={NODE_POS[N.BUNKER_DOOR]} color="#7c2d12" label="Bunker Door" />
            <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
            <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Blast Safe Zone" />

            <group>
              <AgentMesh getPos={() => agentPos} />
            </group>
          </Canvas>
        </div>
      </div>
    </div>
  )
}


