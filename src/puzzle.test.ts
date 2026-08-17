import assert from 'node:assert/strict'
import { test } from 'node:test'
import { signedArea } from './geom/types.ts'
import { buildGrid, gridForAspect, pieceOutline, pieces, straightEdge } from './jigsaw/grid.ts'
import { toBinarySTL } from './export/stl.ts'
import { findOpenEdges, triangleCount } from './mesh/mesh.ts'
import { buildPuzzle } from './puzzle.ts'

const SPEC = { width: 180, height: 120, cols: 4, rows: 3, seed: 7 }

test('a peça fecha e tem orientação anti-horária', () => {
  const grid = buildGrid(SPEC)
  for (const p of pieces(grid)) {
    assert.ok(p.ring.length >= 4, 'anel curto demais')
    const [fx, fy] = p.ring[0]
    const [lx, ly] = p.ring[p.ring.length - 1]
    assert.ok(Math.hypot(fx - lx, fy - ly) > 1e-9, 'o fecho não deve repetir o primeiro ponto')
    assert.ok(signedArea(p.ring) > 0, 'anel deveria ser anti-horário')
  }
})

test('as peças ladrilham a placa exatamente — a soma das áreas é a área da placa', () => {
  const grid = buildGrid(SPEC)
  const total = pieces(grid).reduce((s, p) => s + signedArea(p.ring), 0)
  assert.ok(
    Math.abs(total - SPEC.width * SPEC.height) < 1e-6,
    `soma das áreas ${total} ≠ ${SPEC.width * SPEC.height}`,
  )
})

test('vizinhas compartilham a MESMA aresta, invertida — é isso que garante o encaixe', () => {
  const grid = buildGrid(SPEC)
  const right = grid.v[1][2] // aresta direita da peça (1,1) = aresta esquerda da (1,2)
  const left = grid.v[1][2]
  assert.deepEqual([...right].reverse().reverse(), left)

  // e o contorno das duas peças percorre essa aresta em sentidos opostos
  const a = pieceOutline(grid, 1, 1)
  const b = pieceOutline(grid, 1, 2)
  const inA = right.every((p) => a.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9))
  const inB = right.every((p) => b.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9))
  assert.ok(inA && inB, 'a aresta compartilhada tem que estar nos dois contornos')
})

test('a borda da placa é sempre reta, mesmo com aba nas internas', () => {
  // aresta "aba" caricata: um bico no meio. Se vazar pra borda, o teste pega.
  const bump = (a: readonly [number, number], b: readonly [number, number]) => [
    a,
    [(a[0] + b[0]) / 2 + 5, (a[1] + b[1]) / 2 + 5] as const,
    b,
  ]
  const grid = buildGrid(SPEC, (a, b, ctx) => {
    assert.equal(ctx.border, false, 'edgeFn não deveria ser chamada na borda')
    return bump(a, b) as never
  })
  for (const c of grid.h[0]) assert.equal(c.length, 2, 'linha de baixo tem que ser reta')
  for (const c of grid.h[SPEC.rows]) assert.equal(c.length, 2, 'linha de cima tem que ser reta')
  for (let r = 0; r < SPEC.rows; r++) {
    assert.equal(grid.v[r][0].length, 2, 'coluna da esquerda tem que ser reta')
    assert.equal(grid.v[r][SPEC.cols].length, 2, 'coluna da direita tem que ser reta')
    assert.equal(grid.v[r][1].length, 3, 'coluna interna deveria ter recebido a aba')
  }
})

test('a grade se adapta à proporção da foto', () => {
  const wide = gridForAspect(180, 120, 12)
  assert.ok(wide.cols > wide.rows, `esperava mais colunas que linhas, veio ${wide.cols}×${wide.rows}`)
  const tall = gridForAspect(120, 180, 12)
  assert.ok(tall.rows > tall.cols, `esperava mais linhas que colunas, veio ${tall.cols}×${tall.rows}`)
})

test('cada peça vira uma malha fechada', () => {
  const { pieceMeshes } = buildPuzzle({ size: 180, aspect: 1.5, pieceCount: 12 })
  assert.ok(pieceMeshes.length > 0)
  for (const m of pieceMeshes) {
    assert.equal(findOpenEdges(m), 0, 'malha da peça está aberta')
  }
})

test('a folga separa as peças de verdade', () => {
  const kerf = 0.2
  const tight = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4, kerf: 0 })
  const loose = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4, kerf })

  const bboxWidth = (m: { verts: number[] }) => {
    const xs = m.verts.filter((_, i) => i % 3 === 0)
    return Math.max(...xs) - Math.min(...xs)
  }
  const p0 = bboxWidth(tight.pieceMeshes[0])
  const p1 = bboxWidth(loose.pieceMeshes[0])
  assert.ok(p0 - p1 > 0, 'com folga a peça tem que ficar menor')
  assert.ok(Math.abs(p0 - p1 - kerf) < 1e-6, `folga aplicada foi ${p0 - p1}, esperava ${kerf}`)
})

test('o STL binário tem o tamanho exato de 84 + 50·triângulos', () => {
  const { mesh } = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4 })
  const stl = toBinarySTL(mesh)
  assert.equal(stl.byteLength, 84 + 50 * triangleCount(mesh))
  assert.equal(new DataView(stl.buffer).getUint32(80, true), triangleCount(mesh))
})
