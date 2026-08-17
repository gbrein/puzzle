import test from 'node:test'
import assert from 'node:assert/strict'
import type { HeightMap } from '../color/types.ts'
import { findOpenEdges, triangleCount, type Mesh } from './mesh.ts'
import { heightMapToMesh } from './heightmap.ts'

const map = (width: number, height: number, fn: (i: number, j: number) => number): HeightMap => {
  const data = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = fn(i, j)
  return { width, height, data }
}

/** PRNG com semente — o teste tem que falhar sempre no mesmo lugar. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function bbox(m: Mesh) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], m.verts[i + k])
      hi[k] = Math.max(hi[k], m.verts[i + k])
    }
  }
  return { lo, hi }
}

test('mapa uniforme: fechado e com a caixa envolvente certa', () => {
  const hm = map(5, 3, () => 1)
  const m = heightMapToMesh(hm, { cellSize: 2, z0: 1, layerHeight: 0.4 })

  assert.equal(findOpenEdges(m), 0)
  const { lo, hi } = bbox(m)
  assert.deepEqual(lo, [0, 0, 1])
  assert.deepEqual(hi, [10, 6, 1.4])
})

test('origem desloca o relevo', () => {
  const hm = map(4, 4, () => 2)
  const m = heightMapToMesh(hm, { cellSize: 1, originX: -3, originY: 5, z0: 0, layerHeight: 0.2 })
  const { lo, hi } = bbox(m)
  assert.deepEqual(lo, [-3, 5, 0])
  assert.deepEqual(hi, [1, 9, 0.4])
})

test('mapa aleatório determinístico fecha', () => {
  const rnd = mulberry32(20260817)
  const hm = map(17, 13, () => Math.floor(rnd() * 5))
  const m = heightMapToMesh(hm, { cellSize: 1.5, z0: 0.6, layerHeight: 0.1 })

  assert.ok(triangleCount(m) > 100, 'mapa irregular tem que gerar geometria de verdade')
  assert.equal(findOpenEdges(m), 0)
})

test('degrau: fecha e tem parede na transição', () => {
  const cellSize = 3
  const z0 = 1
  const layerHeight = 0.5
  const hm = map(8, 4, (i) => (i < 4 ? 1 : 3))
  const m = heightMapToMesh(hm, { cellSize, z0, layerHeight })

  assert.equal(findOpenEdges(m), 0)

  // a parede vive no plano x = 4*cellSize e sobe do topo do lado baixo ao do alto
  const xw = 4 * cellSize
  let zLo = Infinity
  let zHi = -Infinity
  let n = 0
  for (let t = 0; t < m.verts.length; t += 9) {
    const xs = [m.verts[t], m.verts[t + 3], m.verts[t + 6]]
    if (!xs.every((x) => x === xw)) continue
    n++
    for (const k of [2, 5, 8]) {
      zLo = Math.min(zLo, m.verts[t + k])
      zHi = Math.max(zHi, m.verts[t + k])
    }
  }
  assert.ok(n >= 2, 'esperava triângulos de parede no plano do degrau')
  assert.equal(zLo, z0 + 1 * layerHeight)
  assert.equal(zHi, z0 + 3 * layerHeight)
})

test('máscara: célula mascarada não gera geometria e a malha segue fechada', () => {
  const cellSize = 2
  const hm = map(6, 6, () => 2)
  const mask = new Uint8Array(36).fill(1)
  for (let j = 0; j < 6; j++) mask[j * 6] = 0 // coluna 0 fora da peça
  mask[3 * 6 + 3] = 0 // buraco no meio

  const m = heightMapToMesh(hm, { cellSize, z0: 0, layerHeight: 0.3, mask })

  assert.equal(findOpenEdges(m), 0)
  assert.equal(bbox(m).lo[0], cellSize, 'a coluna mascarada não pode aparecer')

  // o buraco do meio é um vazio de verdade: nenhum triângulo de topo o cobre
  const hx = 3.5 * cellSize
  const hy = 3.5 * cellSize
  const zTop = 2 * 0.3
  const covers = (t: number) => {
    const p = [0, 3, 6].map((o) => [m.verts[t + o], m.verts[t + o + 1], m.verts[t + o + 2]])
    if (!p.every((v) => v[2] === zTop)) return false
    const xs = p.map((v) => v[0])
    const ys = p.map((v) => v[1])
    return Math.min(...xs) < hx && hx < Math.max(...xs) && Math.min(...ys) < hy && hy < Math.max(...ys)
  }
  for (let t = 0; t < m.verts.length; t += 9) assert.ok(!covers(t), 'o buraco da máscara foi coberto')
})

test('máscara aleatória também fecha', () => {
  const rnd = mulberry32(7)
  const hm = map(15, 11, () => 1 + Math.floor(rnd() * 4))
  const mask = Uint8Array.from({ length: 15 * 11 }, () => (rnd() < 0.3 ? 0 : 1))
  const m = heightMapToMesh(hm, { cellSize: 1, z0: 0, layerHeight: 0.2, mask })

  assert.equal(findOpenEdges(m), 0)
})

test('greedy funde mesmo: 200x200 uniforme sai com dezenas de triângulos', () => {
  const hm = map(200, 200, () => 1)
  const m = heightMapToMesh(hm, { cellSize: 0.5, z0: 0, layerHeight: 0.2 })

  assert.equal(findOpenEdges(m), 0)
  assert.ok(triangleCount(m) < 100, `esperava dezenas, veio ${triangleCount(m)}`)
})

test('altura 0 em todo lugar: malha vazia', () => {
  const m = heightMapToMesh(map(9, 9, () => 0), { cellSize: 1, z0: 0, layerHeight: 0.2 })
  assert.equal(m.verts.length, 0)
})

test('máscara de tamanho errado é erro explícito', () => {
  assert.throws(
    () => heightMapToMesh(map(4, 4, () => 1), { cellSize: 1, z0: 0, layerHeight: 0.2, mask: new Uint8Array(9) }),
    /máscara/,
  )
})
