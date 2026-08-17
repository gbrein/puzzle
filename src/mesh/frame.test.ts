import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFrame } from './frame.ts'
import { findOpenEdges, signedVolume } from './mesh.ts'

test('a moldura é um sólido fechado, com as normais para fora', () => {
  const m = buildFrame({ plateWidth: 180, plateHeight: 120 })
  assert.equal(findOpenEdges(m), 0, 'moldura com aresta aberta')
  assert.ok(signedVolume(m) > 0, 'volume negativo — normais invertidas')
})

test('o pé sai no ângulo pedido — derivado da própria malha, não da fórmula interna', () => {
  const thickness = 6
  for (const footAngle of [20, 30, 45]) {
    const m = buildFrame({ plateWidth: 150, plateHeight: 100, thickness, footAngle })

    // o pé é a única parte da moldura com Y negativo: sua ponta fica no menor Y.
    let minY = 0
    for (let i = 0; i < m.positions.length; i += 3) minY = Math.min(minY, m.positions[i + 1])
    const footRun = -minY
    assert.ok(footRun > 0, 'não achei o pé (nenhum vértice com Y negativo)')

    const angulo = (Math.atan2(thickness, footRun) * 180) / Math.PI
    assert.ok(Math.abs(angulo - footAngle) < 0.5, `ângulo do pé ${angulo} ≠ ${footAngle}`)
  }
})

test('a abertura da moldura acompanha o tamanho da placa e a folga pedida', () => {
  const plateWidth = 200
  const plateHeight = 140
  const borderWidth = 12
  const clearance = 0.5
  const m = buildFrame({ plateWidth, plateHeight, borderWidth, clearance })

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < m.positions.length; i += 3) {
    minX = Math.min(minX, m.positions[i])
    maxX = Math.max(maxX, m.positions[i])
    minY = Math.min(minY, m.positions[i + 1])
    maxY = Math.max(maxY, m.positions[i + 1])
  }

  const outerW = plateWidth + 2 * clearance + 2 * borderWidth
  const outerH = plateHeight + 2 * clearance + 2 * borderWidth
  assert.ok(Math.abs(maxX - minX - outerW) < 1e-3, `largura da moldura ${maxX - minX} ≠ ${outerW}`)
  // Y mínimo é negativo por causa do pé — o topo (maxY) é que reflete a moldura
  assert.ok(Math.abs(maxY - outerH) < 1e-3, `altura da moldura ${maxY} ≠ ${outerH}`)
})

test('borderWidth grande demais pro rebaixo é erro explícito', () => {
  assert.throws(
    () => buildFrame({ plateWidth: 50, plateHeight: 50, borderWidth: 60 }),
    /rebaixo/,
  )
})

test('recessDepth fora do intervalo (0, thickness) é erro explícito', () => {
  assert.throws(() => buildFrame({ plateWidth: 100, plateHeight: 80, thickness: 6, recessDepth: 6 }), /recessDepth/)
  assert.throws(() => buildFrame({ plateWidth: 100, plateHeight: 80, recessDepth: -1 }), /recessDepth/)
})
