import test from 'node:test'
import assert from 'node:assert/strict'

import type { Point, Ring } from '../geom/types.ts'
import { signedArea } from '../geom/types.ts'
import { buildGrid, pieces } from './grid.ts'
import { shrinkByKerf } from './kerf.ts'
import { tabEdge } from './tabs.ts'

const A: Point = [0, 0]
const B: Point = [40, 0]
const ctx = (seed: number) => ({ border: false, seed })

/** Distância máxima da polilinha até a reta a→b. */
function bulge(poly: Point[], a: Point, b: Point): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  let max = 0
  for (const p of poly) {
    const d = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len
    if (d > max) max = d
  }
  return max
}

function cross(o: Point, p: Point, q: Point): number {
  return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
}

function onSeg(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  )
}

/** Cruzamento próprio ou toque colineares — endpoints compartilhados não contam. */
function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) {
    return true
  }
  if (d1 === 0 && onSeg(p3, p4, p1)) return true
  if (d2 === 0 && onSeg(p3, p4, p2)) return true
  if (d3 === 0 && onSeg(p1, p2, p3)) return true
  if (d4 === 0 && onSeg(p1, p2, p4)) return true
  return false
}

/** Primeiro par de segmentos não adjacentes que se cruza, ou null. */
function selfIntersection(ring: Ring): [number, number] | null {
  const n = ring.length
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue // fecham no mesmo vértice
      if (segmentsCross(ring[i], ring[(i + 1) % n], ring[k], ring[(k + 1) % n])) return [i, k]
    }
  }
  return null
}

test('a polilinha começa e termina exatamente nos nós', () => {
  const edge = tabEdge()
  for (const seed of [1, 7, 12345, 0xdeadbeef]) {
    const poly = edge(A, B, ctx(seed))
    assert.deepEqual(poly[0], A)
    assert.deepEqual(poly[poly.length - 1], B)
  }
  // também numa aresta vertical e de trás para frente
  const v = tabEdge()([10, 50], [10, 10], ctx(99))
  assert.deepEqual(v[0], [10, 50])
  assert.deepEqual(v[v.length - 1], [10, 10])

  // coordenadas que não fecham em float: aqui o extremo só bate se for copiado,
  // não recalculado (é o que garante o encaixe com a peça vizinha)
  const p: Point = [176.1167061244227, 6.097775905628016]
  const q: Point = [31.02492830730903, 77.4542490843443]
  const obl = tabEdge()(p, q, ctx(4))
  assert.deepEqual(obl[0], p)
  assert.deepEqual(obl[obl.length - 1], q)
})

test('borda continua reta', () => {
  assert.deepEqual(tabEdge()(A, B, { border: true, seed: 3 }), [A, B])
})

test('mesma semente ⇒ mesma aba; sementes diferentes ⇒ abas diferentes', () => {
  const edge = tabEdge()
  assert.deepEqual(edge(A, B, ctx(42)), edge(A, B, ctx(42)))

  const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
  const shapes = seeds.map((s) => JSON.stringify(edge(A, B, ctx(s))))
  assert.equal(new Set(shapes).size, seeds.length, 'sementes distintas colidiram')

  // e o lado da aba muda de semente para semente (não é sempre o mesmo)
  const lados = new Set(
    seeds.map((s) => Math.sign(cross(A, B, edge(A, B, ctx(s))[20]))),
  )
  assert.equal(lados.size, 2, 'a aba estufa sempre para o mesmo lado')

  // duas grades com sementes diferentes geram peças diferentes
  const g1 = buildGrid({ width: 200, height: 160, cols: 5, rows: 4, seed: 1 }, edge)
  const g2 = buildGrid({ width: 200, height: 160, cols: 5, rows: 4, seed: 2 }, edge)
  assert.notDeepEqual(pieces(g1)[6].ring, pieces(g2)[6].ring)
})

test('a aba estufa na medida do tabSize e do comprimento da aresta', () => {
  // sem jitter a cabeça é simétrica: o topo da bezier do meio fica em 2.5·t
  for (const t of [0.06, 0.1, 0.15]) {
    const poly = tabEdge({ tabSize: t, jitter: 0 })(A, B, ctx(5))
    assert.ok(
      Math.abs(bulge(poly, A, B) - 2.5 * t * 40) < 1e-9,
      `tabSize ${t}: estufou ${bulge(poly, A, B)}`,
    )
  }

  // o ombro dá um mergulho raso para o lado oposto — é o undercut que prende a
  // peça. Sem jitter ele vale exatamente 0.25·t (mínimo da bezier do ombro).
  for (const t of [0.06, 0.1, 0.15]) {
    const poly = tabEdge({ tabSize: t, jitter: 0 })(A, B, ctx(5))
    const lado = Math.sign(cross(A, B, poly[20]))
    let fundo = 0
    for (const p of poly) {
      const d = (cross(A, B, p) * lado) / 40
      if (d < fundo) fundo = d
    }
    assert.ok(Math.abs(-fundo - 0.25 * t * 40) < 1e-9, `tabSize ${t}: undercut ${-fundo}`)
  }

  // dobrar a aresta dobra a aba
  const curta = tabEdge({ jitter: 0 })(A, B, ctx(5))
  const longa = tabEdge({ jitter: 0 })(A, [80, 0], ctx(5))
  assert.ok(Math.abs(bulge(longa, A, [80, 0]) - 2 * bulge(curta, A, B)) < 1e-9)

  // com jitter a aba continua no mesmo patamar
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const d = bulge(tabEdge()(A, B, ctx(seed)), A, B) / 40
    assert.ok(d > 2.5 * 0.1 - 0.04 && d < 2.5 * 0.1 + 0.04, `estufou ${d} do comprimento`)
  }
})

test('a soma das áreas das peças é a área da placa', () => {
  const grid = buildGrid({ width: 200, height: 160, cols: 5, rows: 4, seed: 7 }, tabEdge())
  const total = pieces(grid).reduce((s, p) => s + signedArea(p.ring), 0)
  assert.ok(Math.abs(total - 200 * 160) < 1e-6, `soma ${total} != 32000`)
  // e cada peça é anti-horária, com área na ordem da célula
  for (const p of pieces(grid)) {
    const a = signedArea(p.ring)
    assert.ok(a > 0.5 * 40 * 40 && a < 1.5 * 40 * 40, `peça ${p.row},${p.col} com área ${a}`)
  }
})

test('nenhum contorno de peça se auto-intersecta', () => {
  // a checagem tem que ser capaz de acusar: um laço explícito precisa falhar
  assert.notEqual(
    selfIntersection([
      [0, 0],
      [10, 0],
      [0, 10],
      [10, 10],
    ]),
    null,
  )

  for (const seed of [1, 2, 3, 99, 20260817]) {
    const grid = buildGrid({ width: 200, height: 160, cols: 5, rows: 4, seed }, tabEdge())
    for (const p of pieces(grid)) {
      assert.equal(
        selfIntersection(p.ring),
        null,
        `peça ${p.row},${p.col} da semente ${seed} se auto-intersecta`,
      )
    }
  }
})

test('shrinkByKerf não parte nenhuma peça', () => {
  const boards = [
    { width: 200, height: 160 }, // peças de 40mm
    { width: 150, height: 120 }, // peças de 30mm
  ]
  for (const board of boards) {
    const grid = buildGrid({ ...board, cols: 5, rows: 4, seed: 3 }, tabEdge())
    for (const kerf of [0.15, 0.3]) {
      for (const p of pieces(grid)) {
        const shrunk = shrinkByKerf(p.ring, kerf)
        const perda = 1 - signedArea(shrunk) / signedArea(p.ring)
        // encolher 0.15mm num contorno de ~150mm não pode comer mais que ~5% da área
        assert.ok(perda > 0 && perda < 0.06, `peça ${p.row},${p.col} perdeu ${perda} da área`)
      }
    }
  }
})

test('opções fora de faixa dão erro explícito', () => {
  assert.throws(() => tabEdge({ tabSize: 0 }), /tabSize/)
  assert.throws(() => tabEdge({ tabSize: 0.3 }), /tabSize/)
  assert.throws(() => tabEdge({ jitter: 0.5 }), /jitter/)
  assert.throws(() => tabEdge({ samples: 1 }), /samples/)
  assert.throws(() => tabEdge()(A, [0, 0], ctx(1)), /degenerada/)
})
