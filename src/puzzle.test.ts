import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extrudePolygon } from './mesh/extrude.ts'
import { signedArea } from './geom/types.ts'
import { buildGrid, gridForAspect, pieceOutline, pieces, straightEdge } from './jigsaw/grid.ts'
import { toBinarySTL } from './export/stl.ts'
import { findOpenEdges, MeshBuilder, signedVolume, translate, triangleCount, type Mesh } from './mesh/mesh.ts'
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

test('cada peça vira um sólido fechado, com as normais para fora', () => {
  const thickness = 2.5
  const { pieces } = buildPuzzle({ size: 180, aspect: 1.5, pieceCount: 12, thickness })
  assert.ok(pieces.length > 0)
  for (const p of pieces) {
    assert.equal(findOpenEdges(p.mesh), 0, `malha da peça (${p.row},${p.col}) está aberta`)
    // volume assinado pelo teorema da divergência: positivo = normais para
    // fora, e o valor tem que bater com área×espessura. É o que pega winding
    // invertido, face faltando e face sobreposta — coisas invisíveis para a
    // contagem de triângulos e para a caixa envolvente.
    const esperado = signedArea(p.ring) * thickness
    const v = signedVolume(p.mesh)
    assert.ok(v > 0, `volume negativo (${v}) — normais invertidas`)
    assert.ok(Math.abs(v - esperado) < 1e-4 * esperado, `volume ${v} ≠ ${esperado}`)
  }
})

test('o resultado devolve o anel de cada peça, já com a folga — é ele que rasteriza a máscara', () => {
  const kerf = 0.3
  const { pieces, cols, rows } = buildPuzzle({ size: 120, aspect: 1, pieceCount: 9, kerf })
  assert.equal(pieces.length, cols * rows)
  for (const p of pieces) {
    assert.ok(p.ring.length >= 4, 'anel da peça veio vazio')
    assert.ok(signedArea(p.ring) > 0, 'anel da peça deveria ser anti-horário')
    // o anel tem que ser o MESMO que gerou a malha: a caixa dos dois bate
    const xs = p.ring.map(([x]) => x)
    const px = [...p.mesh.positions].filter((_, i) => i % 3 === 0)
    assert.ok(Math.abs(Math.min(...xs) - Math.min(...px)) < 1e-4, 'anel e malha discordam em X')
    assert.ok(Math.abs(Math.max(...xs) - Math.max(...px)) < 1e-4, 'anel e malha discordam em X')
  }
})

test('extrudePolygon acusa anel auto-intersectante em vez de produzir malha aberta', () => {
  // earcut triangula o bowtie calado: sem o guard sai uma malha com arestas
  // abertas, e o defeito só aparece no slicer do usuário.
  const bowtie = [
    [0, 0],
    [10, 10],
    [10, 0],
    [0, 10],
  ] as [number, number][]
  assert.throws(() => extrudePolygon(bowtie, 0, 1), /auto-intersectante/)

  // e o quadrado equivalente, que NÃO se auto-intersecta, continua passando
  const quadrado = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as [number, number][]
  const m = extrudePolygon(quadrado, 0, 2)
  assert.equal(findOpenEdges(m), 0)
  assert.ok(Math.abs(signedVolume(m) - 200) < 1e-3, `volume ${signedVolume(m)} ≠ 200`)
})

test('a folga separa as peças de verdade', () => {
  const kerf = 0.2
  const tight = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4, kerf: 0 })
  const loose = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4, kerf })

  const bboxWidth = (m: Mesh) => {
    const xs = [...m.positions].filter((_, i) => i % 3 === 0)
    return Math.max(...xs) - Math.min(...xs)
  }
  const p0 = bboxWidth(tight.pieces[0].mesh)
  const p1 = bboxWidth(loose.pieces[0].mesh)
  assert.ok(p0 - p1 > 0, 'com folga a peça tem que ficar menor')
  assert.ok(Math.abs(p0 - p1 - kerf) < 1e-4, `folga aplicada foi ${p0 - p1}, esperava ${kerf}`)
})

test('a placa inteira é a soma das peças — concat não pode embaralhar os índices', () => {
  const thickness = 3
  const { mesh, pieces } = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4, thickness })

  assert.equal(findOpenEdges(mesh), 0, 'a placa inteira ficou aberta')
  const soma = pieces.reduce((s, p) => s + signedVolume(p.mesh), 0)
  const v = signedVolume(mesh)
  assert.ok(Math.abs(v - soma) < 1e-4 * soma, `volume da placa ${v} ≠ soma das peças ${soma}`)
  assert.equal(
    mesh.positions.length,
    pieces.reduce((s, p) => s + p.mesh.positions.length, 0),
  )

  // As peças são congruentes: sem deslocar os índices, a placa vira N cópias da
  // peça 0 — e volume, contagem e arestas abertas continuam batendo. Só a caixa
  // envolvente denuncia, porque os triângulos param de alcançar os vértices das
  // outras peças.
  const bx = [Infinity, -Infinity]
  const by = [Infinity, -Infinity]
  for (let t = 0; t < mesh.indices.length; t++) {
    const o = mesh.indices[t] * 3
    bx[0] = Math.min(bx[0], mesh.positions[o])
    bx[1] = Math.max(bx[1], mesh.positions[o])
    by[0] = Math.min(by[0], mesh.positions[o + 1])
    by[1] = Math.max(by[1], mesh.positions[o + 1])
  }
  assert.ok(bx[1] - bx[0] > 99, `a placa mede ${bx[1] - bx[0]}mm em X, esperava ~100`)
  assert.ok(by[1] - by[0] > 99, `a placa mede ${by[1] - by[0]}mm em Y, esperava ~100`)
})

test('MeshBuilder junta vértices coincidentes — sem isso a malha nasce aberta', () => {
  // cubo 1×1×1 montado face a face: cada esquina é pedida 3 vezes, uma por face
  const b = new MeshBuilder()
  const quad = (p: number[][]) => {
    const [a, c, d, e] = p.map(([x, y, z]) => b.vertex(x, y, z))
    b.tri(a, c, d)
    b.tri(a, d, e)
  }
  quad([[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]) // -Z
  quad([[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]) // +Z
  quad([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]) // -Y
  quad([[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]) // +Y
  quad([[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]) // -X
  quad([[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]) // +X

  const m = b.build()
  assert.equal(m.positions.length / 3, 8, 'um cubo tem 8 esquinas, não 24')
  assert.equal(findOpenEdges(m), 0, 'sem dedupe as faces não compartilham aresta')
  assert.ok(Math.abs(signedVolume(m) - 1) < 1e-6, `volume ${signedVolume(m)} ≠ 1`)
})

test('translate move a malha sem deformá-la', () => {
  const { pieces } = buildPuzzle({ size: 60, aspect: 1, pieceCount: 4 })
  const m = pieces[0].mesh
  const t = translate(m, 10, -4, 2.5)

  assert.ok(Math.abs(signedVolume(t) - signedVolume(m)) < 1e-3, 'translação mudou o volume')
  for (let i = 0; i < m.positions.length; i += 3) {
    assert.ok(Math.abs(t.positions[i] - m.positions[i] - 10) < 1e-3, 'X não andou')
    assert.ok(Math.abs(t.positions[i + 1] - m.positions[i + 1] + 4) < 1e-3, 'Y não andou')
    assert.ok(Math.abs(t.positions[i + 2] - m.positions[i + 2] - 2.5) < 1e-3, 'Z não andou')
  }
})

test('o STL binário reproduz a malha triângulo a triângulo, com a normal certa', () => {
  const { mesh } = buildPuzzle({ size: 100, aspect: 1, pieceCount: 4 })
  const n = triangleCount(mesh)
  const stl = toBinarySTL(mesh)
  assert.equal(stl.byteLength, 84 + 50 * n)
  const view = new DataView(stl.buffer)
  assert.equal(view.getUint32(80, true), n)

  // sortear alguns triângulos e conferir vértice a vértice: sem isto, trocar
  // dois índices na expansão passaria batido (o tamanho do arquivo não muda)
  for (const t of [0, 1, (n / 2) | 0, n - 1]) {
    const o = 84 + t * 50
    const p: number[][] = []
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t * 3 + k] * 3
      p.push([mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]])
      for (let c = 0; c < 3; c++) {
        assert.equal(view.getFloat32(o + 12 + k * 12 + c * 4, true), p[k][c], `triângulo ${t}, vértice ${k}`)
      }
    }
    const u = p[1].map((v, i) => v - p[0][i])
    const w = p[2].map((v, i) => v - p[0][i])
    const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const len = Math.hypot(...cr) || 1
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(view.getFloat32(o + c * 4, true) - cr[c] / len) < 1e-6,
        `normal do triângulo ${t} não bate com o winding`,
      )
    }
  }
})
