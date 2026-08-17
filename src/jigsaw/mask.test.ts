import assert from 'node:assert/strict'
import test from 'node:test'

import type { Point, Ring } from '../geom/types.ts'
import { buildGrid, pieceOutline } from './grid.ts'
import { pieceMask } from './mask.ts'
import { tabEdge } from './tabs.ts'

/**
 * Ponto-dentro-do-anel independente do usado em mask.ts — se os dois forem o
 * mesmo código, o teste concorda com o bug em vez de pegá-lo. Aqui: soma dos
 * ângulos (winding), não cruzamento de raio.
 */
function dentro(ring: Ring, p: Point): boolean {
  let soma = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0] - p[0]
    const ay = ring[j][1] - p[1]
    const bx = ring[i][0] - p[0]
    const by = ring[i][1] - p[1]
    soma += Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
  }
  return Math.abs(soma) > Math.PI
}

const conta = (m: Uint8Array) => m.reduce((s, v) => s + v, 0)

const quadrado = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

test('quadrado alinhado à grade marca exatamente as células que ele cobre', () => {
  const m = pieceMask(quadrado(0, 0, 10, 10), { width: 10, height: 10 }, 1)
  assert.equal(conta(m), 100)
})

test('quadrado alinhado menor marca só as células dentro dele', () => {
  const m = pieceMask(quadrado(2, 3, 8, 9), { width: 10, height: 10 }, 1)
  assert.equal(conta(m), 6 * 6)
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++) {
      // linha r do mapa ocupa y de (9-r) a (10-r) na placa
      const y0 = 9 - r
      const esperado = c >= 2 && c < 8 && y0 >= 3 && y0 + 1 <= 9 ? 1 : 0
      assert.equal(m[r * 10 + c], esperado, `célula linha ${r} coluna ${c}`)
    }
})

test('anel deslocado de meia célula PERDE a borda (conservador de propósito)', () => {
  const m = pieceMask(quadrado(0.5, 0.5, 9.5, 9.5), { width: 10, height: 10 }, 1)
  // só as células inteiramente dentro: x em [1,9] e y em [1,9]
  assert.equal(conta(m), 64)
  for (let k = 0; k < 10; k++) {
    assert.equal(m[k * 10 + 0], 0, `coluna 0, linha ${k}`)
    assert.equal(m[k * 10 + 9], 0, `coluna 9, linha ${k}`)
    assert.equal(m[0 * 10 + k], 0, `linha 0, coluna ${k}`)
    assert.equal(m[9 * 10 + k], 0, `linha 9, coluna ${k}`)
  }
  // uma versão por centro-da-célula marcaria as 100
  assert.notEqual(conta(m), 100)
})

test('célula fora do anel nunca entra', () => {
  const longe = pieceMask(quadrado(50, 50, 60, 60), { width: 10, height: 10 }, 1)
  assert.equal(conta(longe), 0)

  // anel que não cobre nenhuma célula inteira
  const fino = pieceMask(quadrado(2.1, 2.1, 2.9, 2.9), { width: 10, height: 10 }, 1)
  assert.equal(conta(fino), 0)
})

test('linha 0 da máscara é o TOPO da placa (mesma convenção do HeightMap)', () => {
  // metade de CIMA da placa em Y (5..10) → linhas 0..4 do mapa
  const m = pieceMask(quadrado(0, 5, 10, 10), { width: 10, height: 10 }, 1)
  assert.equal(conta(m), 50)
  for (let c = 0; c < 10; c++) {
    for (let r = 0; r <= 4; r++) assert.equal(m[r * 10 + c], 1, `linha ${r} coluna ${c}`)
    for (let r = 5; r < 10; r++) assert.equal(m[r * 10 + c], 0, `linha ${r} coluna ${c}`)
  }
})

test('origem desloca a grade no plano da placa', () => {
  const m = pieceMask(quadrado(20, 30, 26, 36), { width: 6, height: 6 }, 1, 20, 30)
  assert.equal(conta(m), 36)
})

/**
 * Peça do MEIO de uma grade 3×3: as quatro arestas são abas bezier, nenhuma é
 * a borda reta da placa. É o anel côncavo de verdade — e nenhum ponto dele cai
 * exatamente sobre a grade de células, então "dentro" nunca é ambíguo.
 */
function pecaCentral(cs: number) {
  const grid = buildGrid({ width: 60, height: 60, cols: 3, rows: 3, seed: 7 }, tabEdge())
  const ring = pieceOutline(grid, 1, 1)
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const ox = Math.floor(Math.min(...xs) / cs) * cs - cs
  const oy = Math.floor(Math.min(...ys) / cs) * cs - cs
  const width = Math.ceil((Math.max(...xs) - ox) / cs) + 1
  const height = Math.ceil((Math.max(...ys) - oy) / cs) + 1
  return { ring, ox, oy, width, height }
}

test('anel côncavo real (tabEdge) não vaza: nenhum canto de célula marcada fica fora', () => {
  const cs = 0.5
  const { ring, ox, oy, width: w, height: h } = pecaCentral(cs)
  const m = pieceMask(ring, { width: w, height: h }, cs, ox, oy)

  const marcadas = conta(m)
  // sem isto o teste passaria com uma máscara toda zerada
  assert.ok(marcadas > w * h * 0.3, `marcou só ${marcadas} de ${w * h} células`)
  // e o anel côncavo tem que recortar de verdade: a caixa é bem maior que a peça
  assert.ok(marcadas < w * h * 0.85, `marcou ${marcadas} de ${w * h} — não recortou nada`)

  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (!m[r * w + c]) continue
      const x0 = ox + c * cs
      const y0 = oy + (h - 1 - r) * cs
      for (const canto of [
        [x0, y0],
        [x0 + cs, y0],
        [x0 + cs, y0 + cs],
        [x0, y0 + cs],
      ] as Point[]) {
        assert.ok(dentro(ring, canto), `canto ${canto} da célula linha ${r} coluna ${c} caiu fora`)
      }
    }
})

test('a máscara côncava é mais restrita que o teste por centro da célula', () => {
  const cs = 0.5
  const { ring, ox, oy, width: w, height: h } = pecaCentral(cs)
  const m = pieceMask(ring, { width: w, height: h }, cs, ox, oy)

  let porCentro = 0
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      if (dentro(ring, [ox + (c + 0.5) * cs, oy + (h - 1 - r + 0.5) * cs])) porCentro++
    }

  const marcadas = conta(m)
  assert.ok(marcadas > 0 && porCentro > marcadas, `centro=${porCentro} máscara=${marcadas}`)
})

test('entradas inválidas lançam', () => {
  const q = quadrado(0, 0, 10, 10)
  assert.throws(() => pieceMask(q, { width: 0, height: 10 }, 1), /dimensões inteiras positivas/)
  assert.throws(() => pieceMask(q, { width: 10, height: 2.5 }, 1), /dimensões inteiras positivas/)
  assert.throws(() => pieceMask(q, { width: 10, height: 10 }, 0), /cellSize/)
  assert.throws(() => pieceMask(q, { width: 10, height: 10 }, -1), /cellSize/)
  assert.throws(() => pieceMask([[0, 0], [1, 1]], { width: 4, height: 4 }, 1), /3 pontos/)
})
