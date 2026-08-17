import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPuzzle } from '../puzzle.ts'
import { layoutPlates, type BBox } from './plates.ts'

const overlaps = (a: BBox, b: BBox) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY

test('nenhuma peça cai fora da mesa útil', () => {
  const { pieces } = buildPuzzle({ size: 150, aspect: 1, pieceCount: 16 })
  const bedWidth = 100
  const bedHeight = 100
  const { placement } = layoutPlates(pieces, { bedWidth, bedHeight })

  assert.equal(placement.length, pieces.length)
  for (const p of placement) {
    assert.ok(p.bbox.minX >= 0, `peça (${p.row},${p.col}) vaza pela esquerda`)
    assert.ok(p.bbox.minY >= 0, `peça (${p.row},${p.col}) vaza por baixo`)
    assert.ok(p.bbox.maxX <= bedWidth, `peça (${p.row},${p.col}) vaza pela direita`)
    assert.ok(p.bbox.maxY <= bedHeight, `peça (${p.row},${p.col}) vaza por cima`)
  }
})

// Só dentro da mesma placa: cada placa é uma impressão própria, então duas
// peças em placas diferentes ocupam o mesmo espaço da mesa de propósito.
test('dentro de uma placa, nenhum par de bounding boxes se sobrepõe', () => {
  const { pieces } = buildPuzzle({ size: 150, aspect: 1, pieceCount: 16 })
  const { placement } = layoutPlates(pieces, { bedWidth: 100, bedHeight: 100 })

  // várias placas são esperadas aqui — a mesa é pequena de propósito
  const plates = new Set(placement.map((p) => p.plate))
  assert.ok(plates.size > 1, 'esperava mais de uma placa para forçar o teste do split')

  for (let i = 0; i < placement.length; i++) {
    for (let j = i + 1; j < placement.length; j++) {
      if (placement[i].plate !== placement[j].plate) continue
      assert.ok(
        !overlaps(placement[i].bbox, placement[j].bbox),
        `peças (${placement[i].row},${placement[i].col}) e (${placement[j].row},${placement[j].col}) se sobrepõem na placa ${placement[i].plate}`,
      )
    }
  }
})

test('toda peça de entrada aparece exatamente uma vez no mapa de montagem', () => {
  const { pieces } = buildPuzzle({ size: 150, aspect: 1.4, pieceCount: 12 })
  const { placement } = layoutPlates(pieces, { bedWidth: 90, bedHeight: 90 })

  assert.equal(placement.length, pieces.length)
  const seen = new Set(placement.map((p) => `${p.row},${p.col}`))
  assert.equal(seen.size, pieces.length, 'alguma peça apareceu mais de uma vez ou ficou de fora')
  for (const p of pieces) assert.ok(seen.has(`${p.row},${p.col}`), `peça (${p.row},${p.col}) sumiu do mapa`)
})

test('cada placa devolvida é a malha das peças que o mapa de montagem aponta pra ela', () => {
  const { pieces } = buildPuzzle({ size: 150, aspect: 1, pieceCount: 16 })
  const { plates, placement } = layoutPlates(pieces, { bedWidth: 100, bedHeight: 100 })

  for (let i = 0; i < plates.length; i++) {
    const n = placement.filter((p) => p.plate === i).length
    assert.ok(n > 0, `placa ${i} não tem nenhuma peça no mapa de montagem`)
  }
  assert.equal(new Set(placement.map((p) => p.plate)).size, plates.length)
})

test('peça maior que a mesa é erro explícito, não um packing quebrado', () => {
  const { pieces } = buildPuzzle({ size: 150, aspect: 1, pieceCount: 4 })
  assert.throws(() => layoutPlates(pieces, { bedWidth: 20, bedHeight: 20 }), /não cabe na mesa/)
})
