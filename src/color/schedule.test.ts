import test from 'node:test'
import assert from 'node:assert/strict'
import type { Bitmap, Filament, LayerPlan, RGB } from './types.ts'
import { buildPalette } from './beer-lambert.ts'
import { countBands, scorePlan, searchSchedule, type ScheduleOptions } from './schedule.ts'

/**
 * Conjunto pequeno e contrastado. Os TD são da faixa opaca do catálogo real
 * (0.3–1.4) de propósito: com TD alto e camada de 0.15mm cada camada cobre ~6%
 * e a paleta inteira vira um degradê de cinza — aí qualquer cronograma acerta e
 * o teste não distinguiria nada.
 */
const POOL: Filament[] = [
  { id: 'preto', name: 'Preto', hex: '#1A1A1A', td: 0.3 },
  { id: 'branco', name: 'Branco', hex: '#F2F2F2', td: 5.5 },
  { id: 'vermelho', name: 'Vermelho', hex: '#D03036', td: 0.9 },
  { id: 'azul', name: 'Azul', hex: '#04518E', td: 0.8 },
  { id: 'amarelo', name: 'Amarelo', hex: '#EFD006', td: 1.4 },
  { id: 'cinza', name: 'Cinza', hex: '#9FA4A7', td: 0.7 },
]

const acha = (id: string): Filament => {
  const f = POOL.find((x) => x.id === id)
  if (!f) throw new Error(`filamento de teste inexistente: ${id}`)
  return f
}

const rep = (f: Filament, n: number): Filament[] => Array.from({ length: n }, () => f)

/** Imagem que percorre as cores dadas em padrão fixo — todas aparecem. */
function bitmapCiclando(w: number, h: number, cores: RGB[]): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const c = cores[(i * 7 + Math.floor(i / w) * 3) % cores.length]
    data.set([c.r, c.g, c.b, 255], i * 4)
  }
  return { width: w, height: h, data }
}

const BASE_OPTS: ScheduleOptions = { layerHeight: 0.15, baseLayers: 5, layers: 8, maxSwaps: 2, seed: 7 }

/** Plano verdadeiro: base preta, 4 camadas de amarelo, 4 de azul (2 faixas, 1 troca). */
const PLANO_VERDADEIRO: LayerPlan = {
  layerHeight: 0.15,
  baseLayers: 5,
  base: acha('preto'),
  schedule: [...rep(acha('amarelo'), 4), ...rep(acha('azul'), 4)],
}

test('imagem gerada da paleta de um plano conhecido: a busca chega perto', () => {
  const img = bitmapCiclando(40, 40, buildPalette(PLANO_VERDADEIRO))

  // O plano que gerou a imagem reproduz ela exatamente — sanidade do alvo.
  assert.ok(scorePlan(img, PLANO_VERDADEIRO) < 1e-9)

  const achado = searchSchedule(img, POOL, BASE_OPTS)
  const erro = scorePlan(img, achado)

  // Limiar 3.0: ΔE ~2.3 é o limite do perceptível (JND), então 3 tolera um
  // cronograma vizinho do verdadeiro (uma camada a mais de amarelo, p.ex.) e
  // rejeita qualquer plano que erre a *cor*. Achando o cronograma exato dá 0.
  assert.ok(erro < 3, `erro do plano achado: ΔE ${erro.toFixed(2)}`)

  // Referência de "ruim": um cronograma de uma cor só nesta imagem passa de 30.
  const chapado: LayerPlan = { ...PLANO_VERDADEIRO, schedule: rep(acha('cinza'), 8) }
  assert.ok(scorePlan(img, chapado) > 20, 'o plano chapado deveria ser bem pior')
})

test('o número de faixas respeita maxSwaps', () => {
  const img = bitmapCiclando(40, 40, buildPalette(PLANO_VERDADEIRO))
  for (const maxSwaps of [0, 1, 2, 4]) {
    const plan = searchSchedule(img, POOL, { ...BASE_OPTS, layers: 10, maxSwaps })
    assert.equal(plan.schedule.length, 10)
    const faixas = countBands(plan.schedule)
    assert.ok(faixas <= maxSwaps + 1, `maxSwaps=${maxSwaps} produziu ${faixas} faixas`)
  }
})

test('countBands conta faixas contíguas, não filamentos distintos', () => {
  const a = acha('preto')
  const b = acha('branco')
  assert.equal(countBands([a, a, a]), 1)
  assert.equal(countBands([a, a, b, b]), 2)
  // Mesmo filamento voltando depois de outro são duas faixas — são duas trocas.
  assert.equal(countBands([a, b, a]), 3)
})

test('mesma semente e mesma entrada dão exatamente o mesmo plano', () => {
  const img = bitmapCiclando(40, 40, buildPalette(PLANO_VERDADEIRO))
  const ids = (p: LayerPlan) => [p.base.id, ...p.schedule.map((f) => f.id)]

  const a = searchSchedule(img, POOL, { ...BASE_OPTS, seed: 42 })
  const b = searchSchedule(img, POOL, { ...BASE_OPTS, seed: 42 })
  assert.deepEqual(ids(a), ids(b))

  // E a semente tem que importar de verdade. Com orçamento apertado a busca
  // não converge para o mesmo ótimo, então sementes diferentes param em
  // cronogramas diferentes — prova de que o sorteio dirige a exploração.
  const c = searchSchedule(img, POOL, { ...BASE_OPTS, seed: 43, candidates: 40 })
  const d = searchSchedule(img, POOL, { ...BASE_OPTS, seed: 99, candidates: 40 })
  assert.notDeepEqual(ids(c), ids(d))
})

test('mais camadas nunca piora o melhor erro, com o mesmo orçamento de candidatos', () => {
  const img = bitmapCiclando(48, 48, buildPalette(PLANO_VERDADEIRO))
  const orcamento = { ...BASE_OPTS, maxSwaps: 3, candidates: 60, seed: 11 }

  let anterior = Infinity
  for (const layers of [2, 4, 8, 16, 24]) {
    const erro = scorePlan(img, searchSchedule(img, POOL, { ...orcamento, layers }))
    assert.ok(erro <= anterior + 1e-9, `${layers} camadas piorou: ${erro} > ${anterior}`)
    anterior = erro
  }
})

test('entradas inválidas são erro explícito', () => {
  const img = bitmapCiclando(8, 8, buildPalette(PLANO_VERDADEIRO))
  assert.throws(() => searchSchedule(img, [], BASE_OPTS), /nenhum filamento/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, layerHeight: 0 }), /altura de camada/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, baseLayers: -1 }), /baseLayers/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, layers: 0 }), /layers inválido/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, layers: 300 }), /layers inválido/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, maxSwaps: -1 }), /maxSwaps/)
  assert.throws(() => searchSchedule(img, POOL, { ...BASE_OPTS, candidates: 0 }), /candidates/)
})

test('guarda de tempo: busca padrão em 256×256 em poucos segundos', () => {
  const n = 256 * 256
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4)
  }
  const img: Bitmap = { width: 256, height: 256, data }

  const t0 = performance.now()
  const plan = searchSchedule(img, POOL, { layerHeight: 0.08, baseLayers: 5, layers: 12, maxSwaps: 3, seed: 3 })
  const dt = performance.now() - t0
  assert.equal(plan.schedule.length, 12)
  assert.ok(dt < 3000, `searchSchedule levou ${dt.toFixed(0)}ms`)
})
