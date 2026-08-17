import test from 'node:test'
import assert from 'node:assert/strict'
import type { HeightMap } from '../color/types.ts'
import { findOpenEdges, signedVolume, triangleCount, type Mesh } from './mesh.ts'
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
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], m.positions[i + k])
      hi[k] = Math.max(hi[k], m.positions[i + k])
    }
  }
  return { lo, hi }
}

/** As posições são float32: comparar coordenada por igualdade exata é armadilha. */
const assertXYZ = (got: number[], want: number[], msg?: string) =>
  assert.ok(
    got.every((v, k) => Math.abs(v - want[k]) < 1e-5),
    `${msg ?? 'ponto'} ${got} ≠ ${want}`,
  )

/** Volume exato do relevo, direto do mapa: é o número contra o qual o volume assinado tem que bater. */
const volumeOf = (hm: HeightMap, cellSize: number, layerHeight: number, mask?: Uint8Array) => {
  let s = 0
  for (let i = 0; i < hm.data.length; i++) if (!mask || mask[i]) s += hm.data[i]
  return s * cellSize * cellSize * layerHeight
}

/**
 * A checagem que pega o que as outras não pegam. Inverter o winding da malha
 * inteira mantém arestas abertas, contagem e caixa envolvente — só o sinal do
 * volume muda. E o VALOR pega face faltando (volume a menos) e face duplicada
 * (a mais) de uma vez só.
 */
const assertFechada = (m: Mesh, volumeEsperado: number, msg = '') => {
  assert.equal(findOpenEdges(m), 0, `malha aberta ${msg}`)
  const v = signedVolume(m)
  assert.ok(v > 0, `volume negativo (${v}) — normais invertidas ${msg}`)
  assert.ok(
    Math.abs(v - volumeEsperado) < 1e-4 * volumeEsperado,
    `volume ${v} ≠ ${volumeEsperado} ${msg}`,
  )
}

test('mapa uniforme: fechado, caixa envolvente e volume certos', () => {
  const hm = map(5, 3, () => 1)
  const m = heightMapToMesh(hm, { cellSize: 2, z0: 1, layerHeight: 0.4 })

  assertFechada(m, volumeOf(hm, 2, 0.4))
  const { lo, hi } = bbox(m)
  assertXYZ(lo, [0, 0, 1], 'canto mínimo')
  assertXYZ(hi, [10, 6, 1.4], 'canto máximo')
})

test('origem desloca o relevo', () => {
  const hm = map(4, 4, () => 2)
  const m = heightMapToMesh(hm, { cellSize: 1, originX: -3, originY: 5, z0: 0, layerHeight: 0.2 })
  const { lo, hi } = bbox(m)
  assertXYZ(lo, [-3, 5, 0], 'canto mínimo')
  assertXYZ(hi, [1, 9, 0.4], 'canto máximo')
  assertFechada(m, volumeOf(hm, 1, 0.2))
})

test('linha 0 do mapa é o TOPO da foto — o relevo não pode sair espelhado em Y', () => {
  const cellSize = 2
  const layerHeight = 0.5
  const z0 = 1
  // mapa assimétrico em Y: a linha de cima da foto é a mais alta
  const hm = map(1, 2, (_i, j) => (j === 0 ? 3 : 1))
  const m = heightMapToMesh(hm, { cellSize, z0, layerHeight })

  const zAlto = z0 + 3 * layerHeight
  const yDoTopo: number[] = []
  for (let i = 0; i < m.positions.length; i += 3) {
    if (Math.abs(m.positions[i + 2] - zAlto) < 1e-6) yDoTopo.push(m.positions[i + 1])
  }
  assert.ok(yDoTopo.length > 0, 'esperava vértices no nível mais alto')
  assert.ok(
    Math.min(...yDoTopo) >= cellSize - 1e-6,
    `a linha 0 da foto tem que virar a faixa de Y alto; veio Y a partir de ${Math.min(...yDoTopo)}`,
  )
  assertFechada(m, volumeOf(hm, cellSize, layerHeight))
})

test('mapa aleatório determinístico fecha e tem o volume certo', () => {
  const rnd = mulberry32(20260817)
  const hm = map(17, 13, () => Math.floor(rnd() * 5))
  const m = heightMapToMesh(hm, { cellSize: 1.5, z0: 0.6, layerHeight: 0.1 })

  assert.ok(triangleCount(m) > 100, 'mapa irregular tem que gerar geometria de verdade')
  assertFechada(m, volumeOf(hm, 1.5, 0.1))
})

test('degrau: fecha e tem parede na transição', () => {
  const cellSize = 3
  const z0 = 1
  const layerHeight = 0.5
  const hm = map(8, 4, (i) => (i < 4 ? 1 : 3))
  const m = heightMapToMesh(hm, { cellSize, z0, layerHeight })

  assertFechada(m, volumeOf(hm, cellSize, layerHeight))

  // a parede vive no plano x = 4*cellSize e sobe do topo do lado baixo ao do alto
  const xw = 4 * cellSize
  let zLo = Infinity
  let zHi = -Infinity
  let n = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
    if (!v.every((o) => m.positions[o] === xw)) continue
    n++
    for (const o of v) {
      zLo = Math.min(zLo, m.positions[o + 2])
      zHi = Math.max(zHi, m.positions[o + 2])
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

  assertFechada(m, volumeOf(hm, cellSize, 0.3, mask))
  assert.equal(bbox(m).lo[0], cellSize, 'a coluna mascarada não pode aparecer')

  // o buraco do meio é um vazio de verdade: nenhum triângulo de topo o cobre.
  // a linha 3 do mapa é a linha 6-1-3 = 2 do plano da placa (Y espelhado)
  const hx = 3.5 * cellSize
  const hy = 2.5 * cellSize
  const zTop = 2 * 0.3
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const o = m.indices[t + k] * 3
      return [m.positions[o], m.positions[o + 1], m.positions[o + 2]]
    })
    if (!p.every((v) => v[2] === zTop)) continue
    const xs = p.map((v) => v[0])
    const ys = p.map((v) => v[1])
    const cobre =
      Math.min(...xs) < hx && hx < Math.max(...xs) && Math.min(...ys) < hy && hy < Math.max(...ys)
    assert.ok(!cobre, 'o buraco da máscara foi coberto')
  }
})

test('máscara aleatória também fecha', () => {
  const rnd = mulberry32(7)
  const hm = map(15, 11, () => 1 + Math.floor(rnd() * 4))
  const mask = Uint8Array.from({ length: 15 * 11 }, () => (rnd() < 0.3 ? 0 : 1))
  const m = heightMapToMesh(hm, { cellSize: 1, z0: 0, layerHeight: 0.2, mask })

  assertFechada(m, volumeOf(hm, 1, 0.2, mask))
})

test('região plana custa O(perímetro), não O(área)', () => {
  const n = 200
  const hm = map(n, n, () => 1)
  const m = heightMapToMesh(hm, { cellSize: 0.5, z0: 0, layerHeight: 0.2 })

  assertFechada(m, volumeOf(hm, 0.5, 0.2))
  // fundo e topo viram um leque cada (4n triângulos cada) e a parede é por
  // célula (8n): ~16n. Uma tampa por célula daria 4n² = 160.000.
  assert.ok(triangleCount(m) < 20 * n, `esperava ~${16 * n}, veio ${triangleCount(m)}`)
})

test('fundo do relevo é um plano só, não uma tampa por célula', () => {
  const n = 60
  const rnd = mulberry32(99)
  // relevo ruidoso em cima, pegada cheia embaixo: o fundo tem que ser barato
  const hm = map(n, n, () => 1 + Math.floor(rnd() * 4))
  const m = heightMapToMesh(hm, { cellSize: 1, z0: 0, layerHeight: 0.1 })

  assertFechada(m, volumeOf(hm, 1, 0.1))
  const fundo = new Set<number>()
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3]
    if (v.every((o) => m.positions[o + 2] === 0)) fundo.add(t)
  }
  assert.ok(fundo.size > 0, 'cadê o fundo?')
  assert.ok(
    fundo.size < 6 * n,
    `fundo com ${fundo.size} triângulos — deveria ser O(perímetro), não ${2 * n * n}`,
  )
})

test('altura 0 em todo lugar: malha vazia', () => {
  const m = heightMapToMesh(map(9, 9, () => 0), { cellSize: 1, z0: 0, layerHeight: 0.2 })
  assert.equal(m.indices.length, 0)
  assert.equal(m.positions.length, 0)
})

test('máscara de tamanho errado é erro explícito', () => {
  assert.throws(
    () =>
      heightMapToMesh(map(4, 4, () => 1), {
        cellSize: 1,
        z0: 0,
        layerHeight: 0.2,
        mask: new Uint8Array(9),
      }),
    /máscara/,
  )
})
