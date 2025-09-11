'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { N, NodeId, NODE_POS, BUILDINGS, Vec3 } from '../../lib/bunker-world'
import { Ground, BoxMarker, AgentMesh, Building, LabelSprite, EnhancedObject, SmallSphere, InventoryItem, PickupAnimation } from '../../lib/bunker-scene'

export default function BunkerFluidPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD])
  const agentPosRef = useRef<Vec3>(agentPos)
  const [status, setStatus] = useState<string>('Idle')
  const [lastMs, setLastMs] = useState<number | null>(null)

  const [world, setWorld] = useState({
    agentAt: N.COURTYARD as NodeId,
    keyOnTable: true,
    c4Available: true,
    starPresent: true,
    hasKey: false,
    hasC4: false,
    hasStar: false,
    storageUnlocked: false,
    c4Placed: false,
    bunkerBreached: false,
  })

  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({})
  const [pickupAnimations, setPickupAnimations] = useState<{ [key: string]: { active: boolean; startPos: Vec3; endPos: Vec3; startTime: number; duration: number; type: 'key' | 'c4' | 'star'; color: string } }>({})

  const getAgentPos = () => agentPos

  useEffect(() => {
    agentPosRef.current = agentPos
  }, [agentPos])

  const apiRef = useRef<{
    moveTo: (n: NodeId) => Promise<void>
    explodeAt: (n: NodeId) => Promise<void>
    startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>
    startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>
  } | null>(null)

  if (apiRef.current == null) {
    apiRef.current = {
      moveTo: (n: NodeId) => animateMove(n),
      explodeAt: async (n: NodeId) => {
        const at = NODE_POS[n]
        setBoom({ at, t: performance.now() })
        await new Promise((r) => setTimeout(r, 500))
        setBoom({})
      },
      startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_${performance.now()}`
        const agent = agentPosRef.current
        const endPos: Vec3 = [agent[0], agent[1] + 1.5, agent[2]]
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: { active: true, startPos: fromPos, endPos, startTime: performance.now(), duration: 800, type, color },
          }))
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev }
              delete next[animId]
              return next
            })
            resolve()
          }, 800)
        })
      },
      startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_placement_${performance.now()}`
        const agent = agentPosRef.current
        const startPos: Vec3 = [agent[0], agent[1] + 1.2, agent[2]]
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: { active: true, startPos, endPos: toPos, startTime: performance.now(), duration: 600, type, color },
          }))
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev }
              delete next[animId]
              return next
            })
            resolve()
          }, 600)
        })
      },
    }
  }

  async function runFluidPlan() {
    setStatus('Planning...')
    const t0 = performance.now()
    const worker = new Worker('/workers/fluid-htn.worker.js', { type: 'module' })

    const steps: string[] = await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const { type, steps, elapsedMs, message } = ev.data || {}
        if (type === 'result') {
          setLastMs(elapsedMs)
          resolve(steps)
        } else if (type === 'error') {
          reject(new Error(message))
        }
        worker.terminate()
      }
      worker.postMessage({ type: 'plan', goalKey: 'hasStar', enableDebug: false })
    })

    const t1 = performance.now()
    setStatus(`Executing plan (${Math.round(t1 - t0)} ms to plan)`)

    for (const s of steps) {
      const [op, arg] = s.split(' ')
      if (op === 'MOVE' && arg) {
        await apiRef.current!.moveTo(arg as NodeId)
        setWorld((w) => ({ ...w, agentAt: arg as NodeId }))
        continue
      }
      if (op === 'PICKUP_KEY') {
        setWorld((w) => ({ ...w, keyOnTable: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]], 'key', '#fbbf24')
        setWorld((w) => ({ ...w, hasKey: true }))
        continue
      }
      if (op === 'UNLOCK_STORAGE') {
        await new Promise((r) => setTimeout(r, 200))
        setWorld((w) => ({ ...w, storageUnlocked: true }))
        continue
      }
      if (op === 'PICKUP_C4') {
        setWorld((w) => ({ ...w, c4Available: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]], 'c4', '#ef4444')
        setWorld((w) => ({ ...w, hasC4: true }))
        continue
      }
      if (op === 'PLACE_C4') {
        setWorld((w) => ({ ...w, hasC4: false }))
        const doorPos: Vec3 = [NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]
        await apiRef.current!.startPlacementAnimation(doorPos, 'c4', '#ef4444')
        setWorld((w) => ({ ...w, c4Placed: true }))
        continue
      }
      if (op === 'DETONATE') {
        await apiRef.current!.explodeAt(N.BUNKER_DOOR)
        setWorld((w) => ({ ...w, bunkerBreached: true, c4Placed: false }))
        continue
      }
      if (op === 'PICKUP_STAR') {
        setWorld((w) => ({ ...w, starPresent: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]], 'star', '#fde68a')
        setWorld((w) => ({ ...w, hasStar: true }))
        continue
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    setStatus('Done')
  }

  function animateMove(target: NodeId) {
    const start = agentPosRef.current
    const end = NODE_POS[target]
    const startVec = new THREE.Vector3(...start)
    const endVec = new THREE.Vector3(...end)
    const durationMs = 800
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

        <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
            <CameraControls makeDefault />
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />

            <Ground />
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Reference markers and buildings */}
            <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
            <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />

            {/* Storage building */}
            <Building
              center={BUILDINGS.STORAGE.center}
              size={BUILDINGS.STORAGE.size}
              color="#3f6212"
              label="Storage"
              doorFace={BUILDINGS.STORAGE.doorFace}
              doorSize={BUILDINGS.STORAGE.doorSize}
              doorColor={world.storageUnlocked ? '#16a34a' : '#a16207'}
              showDoor={!world.storageUnlocked}
              opacity={world.agentAt === N.STORAGE_INT || world.agentAt === N.C4_TABLE || world.agentAt === N.STORAGE_DOOR ? 0.5 : 1}
              debug={false}
            />
            <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color={world.storageUnlocked ? '#16a34a' : '#a16207'} label="Storage Door" />
            <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />

            {/* Bunker building */}
            <Building
              center={BUILDINGS.BUNKER.center}
              size={BUILDINGS.BUNKER.size}
              color="#374151"
              label="Bunker"
              doorFace={BUILDINGS.BUNKER.doorFace}
              doorSize={BUILDINGS.BUNKER.doorSize}
              doorColor={world.bunkerBreached ? '#16a34a' : '#7c2d12'}
              showDoor={!world.bunkerBreached}
              opacity={world.agentAt === N.BUNKER_INT || world.agentAt === N.STAR || world.agentAt === N.BUNKER_DOOR ? 0.5 : 1}
              debug={false}
            />
            <BoxMarker position={NODE_POS[N.BUNKER_DOOR]} color={world.bunkerBreached ? '#16a34a' : '#7c2d12'} label="Bunker Door" />

            <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
            <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Blast Safe Zone" />

            {/* Objects in world */}
            <EnhancedObject
              position={[NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]]}
              color="#fbbf24"
              type="key"
              visible={world.keyOnTable}
            />
            <EnhancedObject
              position={[NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]]}
              color="#ef4444"
              type="c4"
              visible={world.c4Available}
            />
            <SmallSphere
              position={[NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]}
              color="#ef4444"
              visible={world.c4Placed}
              size={0.3}
            />
            <EnhancedObject
              position={[NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]]}
              color="#fde68a"
              type="star"
              visible={world.starPresent}
            />

            {/* Agent */}
            <group>
              <AgentMesh getPos={() => agentPos} />
              <LabelSprite position={[agentPos[0], 1.2, agentPos[2]]} text="Agent" />
            </group>

            {/* Inventory items */}
            {world.hasKey && (
              <InventoryItem agentPos={agentPos} type="key" color="#fbbf24" index={0} />
            )}
            {world.hasC4 && (
              <InventoryItem agentPos={agentPos} type="c4" color="#ef4444" index={1} />
            )}
            {world.hasStar && (
              <InventoryItem agentPos={agentPos} type="star" color="#fde68a" index={2} />
            )}

            {/* Pickup animations */}
            {Object.entries(pickupAnimations).map(([id, animation]) => (
              <PickupAnimation key={id} animation={animation} onComplete={() => {
                setPickupAnimations((prev) => {
                  const next = { ...prev }
                  delete next[id]
                  return next
                })
              }} />
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
            Inventory:{' '}
            <span>Key: {world.hasKey ? 'true' : 'false'}</span>
            {' | '}
            <span>C4: {world.hasC4 ? 'true' : 'false'}</span>
            {' | '}
            <span>Star: {world.hasStar ? 'true' : 'false'}</span>
          </div>
          <a href="/" className="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
    </div>
  )
}


