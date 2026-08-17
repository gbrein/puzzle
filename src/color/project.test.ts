import test from 'node:test'
import assert from 'node:assert/strict'
import { planToProject } from './project.ts'
import type { Filament, LayerPlan } from './types.ts'

const fil = (id: string, hex: string): Filament => ({ id, name: id, hex, td: 1 })

const A = fil('a', '#111111')
const B = fil('b', '#0F62FE')
const C = fil('c', '#FF0000')

// 0.25 e 4 são exatos em binário: os topZ esperados podem ser comparados com
// `equal`, sem tolerância escondendo um deslocamento de meia camada.
const LH = 0.25
const BASE = 4

const plano = (base: Filament, schedule: Filament[]): LayerPlan => ({
  layerHeight: LH,
  baseLayers: BASE,
  base,
  schedule,
})

/** Repete `f` `n` vezes — é o que `materialize` produz para uma faixa. */
const faixa = (f: Filament, n: number) => new Array(n).fill(f) as Filament[]

test('3 faixas com um filamento repetido: 3 slots, 3 trocas, o repetido reusa o slot', () => {
  // faixas B,B | C,C | B,B — B aparece duas vezes, mas é o MESMO rolo.
  const p = plano(A, [...faixa(B, 2), ...faixa(C, 2), ...faixa(B, 2)])
  const { filaments, colorChanges } = planToProject(p)

  assert.equal(filaments.length, 3)
  assert.deepEqual(
    filaments.map((f) => f.color),
    ['#111111', '#0F62FE', '#FF0000'],
  )
  assert.deepEqual(
    filaments.map((f) => f.type),
    ['PLA', 'PLA', 'PLA'],
  )

  assert.equal(colorChanges.length, 3)
  // extruder 2 nas duas faixas de B: dedupe por id, não por faixa.
  assert.deepEqual(
    colorChanges.map((c) => c.extruder),
    [2, 3, 2],
  )
  assert.deepEqual(
    colorChanges.map((c) => c.color),
    ['#0F62FE', '#FF0000', '#0F62FE'],
  )
})

test('topZ é o topo da camada de cor que estreia a faixa, não o topo da anterior', () => {
  const p = plano(A, [...faixa(B, 2), ...faixa(C, 2), ...faixa(B, 2)])
  const { colorChanges } = planToProject(p)

  // Faixas estreiam nas camadas de cor 0, 2 e 4 (0-based). O topo da camada de
  // cor i é heightOf(plan, i+1) = (baseLayers + i + 1) * layerHeight:
  //   i=0 → (4+1)*0.25 = 1.25   (heightOf(plan,0) = 1.0 é o topo da BASE)
  //   i=2 → (4+3)*0.25 = 1.75
  //   i=4 → (4+5)*0.25 = 2.25
  assert.deepEqual(
    colorChanges.map((c) => c.topZ),
    [1.25, 1.75, 2.25],
  )
})

test('a última faixa entra, mesmo com uma camada só no topo', () => {
  // faixa B,B | C — C estreia na última camada de cor (i=2 de 3).
  const p = plano(A, [...faixa(B, 2), ...faixa(C, 1)])
  const { colorChanges } = planToProject(p)

  assert.equal(colorChanges.length, 2)
  // i=2 → (4+3)*0.25 = 1.75, que é o topo total da peça (3 camadas de cor).
  assert.equal(colorChanges[1].topZ, 1.75)
  assert.equal(colorChanges[1].extruder, 3)
})

test('base → schedule[0] é troca de verdade', () => {
  const p = plano(A, faixa(B, 4))
  const { filaments, colorChanges } = planToProject(p)

  assert.equal(filaments.length, 2)
  assert.equal(colorChanges.length, 1)
  assert.equal(colorChanges[0].extruder, 2)
  assert.equal(colorChanges[0].topZ, 1.25) // (4+0+1)*0.25
})

test('plano monocromático (faixa única com a base) não produz troca nenhuma', () => {
  const { filaments, colorChanges } = planToProject(plano(A, faixa(A, 5)))

  assert.equal(filaments.length, 1)
  assert.deepEqual(colorChanges, [])
})

test('faixas adjacentes iguais colapsam numa troca só', () => {
  // `materialize` pode emitir [B len 2][B len 3]: coladas, são uma faixa só.
  const colado = planToProject(plano(A, [...faixa(B, 2), ...faixa(B, 3)]))
  assert.equal(colado.colorChanges.length, 1)
  assert.equal(colado.colorChanges[0].topZ, 1.25)

  // e a base colada na primeira faixa também não é troca
  const comBase = planToProject(plano(B, [...faixa(B, 2), ...faixa(C, 2)]))
  assert.equal(comBase.colorChanges.length, 1)
  assert.equal(comBase.colorChanges[0].extruder, 2)
  assert.equal(comBase.colorChanges[0].topZ, 1.75) // C estreia em i=2
})

test('topZ estritamente crescente e extruder dentro dos slots (o que o writer exige)', () => {
  const p = plano(A, [...faixa(B, 1), ...faixa(C, 3), ...faixa(A, 2), ...faixa(B, 1)])
  const { filaments, colorChanges } = planToProject(p)

  assert.equal(colorChanges.length, 4)
  let anterior = -Infinity
  for (const c of colorChanges) {
    assert.ok(c.topZ > anterior, `topZ ${c.topZ} não é maior que ${anterior}`)
    anterior = c.topZ
    assert.ok(Number.isInteger(c.extruder) && c.extruder >= 1 && c.extruder <= filaments.length)
  }
})

test('plano inválido na fronteira falha explícito', () => {
  assert.throws(() => planToProject({ ...plano(A, faixa(B, 2)), layerHeight: 0 }), /altura de camada/)
  assert.throws(() => planToProject({ ...plano(A, faixa(B, 2)), baseLayers: -1 }), /baseLayers/)
})
