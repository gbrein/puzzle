import test from 'node:test'
import assert from 'node:assert/strict'
import type { Bitmap, Filament, LayerPlan, RGB } from './types.ts'
import { buildPalette } from './beer-lambert.ts'
import { ditherToPalette } from './dither.ts'
import { imageError, renderHeightMap, solveHeights } from './solver.ts'
import { countBands, countSwaps, scorePlan, searchSchedule, type ScheduleOptions } from './schedule.ts'

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

/**
 * Catálogo grande: 12 filamentos, hex e TD copiados do catálogo real
 * (`filaments/db.ts`) mas fixados aqui para o teste não quebrar quando o
 * catálogo mudar. Doze é o que importa: com 12 a enumeração de pares custa
 * 2·12·12·12 = 3456 avaliações, passa do orçamento padrão de 1200 e **desliga**
 * — é exatamente o regime em que só o sorteio produz plano de duas faixas, onde
 * os defeitos do sorteio aparecem. Com o POOL de 6 a enumeração fica ligada e
 * mascara tudo.
 */
const CATALOGO: Filament[] = [
  { id: 'bambu-black', name: 'Bambu PLA Basic Black', hex: '#000000', td: 0.6 },
  { id: 'jade-white', name: 'Bambu PLA Basic Jade White', hex: '#FFFFFF', td: 5.0 },
  { id: 'azure-blue', name: 'Prusament PLA Azure Blue', hex: '#0682AC', td: 6.6 },
  { id: 'lipstick-red', name: 'Prusament PLA Lipstick Red', hex: '#D03036', td: 3.3 },
  { id: 'pineapple-yellow', name: 'Prusament PLA Pineapple Yellow', hex: '#EFD006', td: 7.6 },
  { id: 'simply-green', name: 'Prusament PLA Simply Green', hex: '#70A640', td: 3.0 },
  { id: 'ms-pink', name: 'Prusament PLA Ms. Pink', hex: '#E34A93', td: 4.1 },
  { id: 'prusa-orange', name: 'Prusament PLA Prusa Orange', hex: '#FE6E31', td: 6.6 },
  { id: 'gravity-grey', name: 'Prusament PLA Gravity Grey', hex: '#9FA4A7', td: 0.7 },
  { id: 'royal-blue', name: 'Prusament PLA Royal Blue', hex: '#04518E', td: 0.8 },
  { id: 'jet-black', name: 'Prusament PLA Jet Black', hex: '#24292A', td: 0.3 },
  { id: 'marble-grey', name: 'Prusament PLA Marble Grey', hex: '#B0B4B4', td: 3.5 },
]

const de = (pool: Filament[], id: string): Filament => {
  const f = pool.find((x) => x.id === id)
  if (!f) throw new Error(`filamento de teste inexistente: ${id}`)
  return f
}
const acha = (id: string) => de(POOL, id)
const achaCat = (id: string) => de(CATALOGO, id)

const rep = (f: Filament, n: number): Filament[] => Array.from({ length: n }, () => f)

/** Índice da primeira camada que difere da primeira faixa — a profundidade da troca. */
const profundidadeDaTroca = (p: LayerPlan): number => {
  for (let i = 0; i < p.schedule.length; i++) if (p.schedule[i].id !== p.schedule[0].id) return i
  return p.schedule.length
}

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

/** Plano verdadeiro: base preta, 4 camadas de amarelo, 4 de azul (2 trocas). */
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

test('maxSwaps conta a troca base → primeira camada de cor', () => {
  const img = bitmapCiclando(40, 40, buildPalette(PLANO_VERDADEIRO))
  for (const maxSwaps of [0, 1, 2, 4]) {
    const plan = searchSchedule(img, POOL, { ...BASE_OPTS, layers: 10, maxSwaps })
    assert.equal(plan.schedule.length, 10)
    // O invariante é sobre trocas físicas de rolo, e trocar da base para a
    // primeira camada de cor é parar a impressora igualzinho às outras.
    const trocas = countSwaps(plan)
    assert.ok(trocas <= maxSwaps, `maxSwaps=${maxSwaps} produziu ${trocas} trocas reais`)
  }

  // maxSwaps: 0 é "não me faça parar a impressora": um filamento do fundo ao
  // topo. Com o catálogo inteiro à disposição, e não só as duas bases.
  const zero = searchSchedule(img, POOL, { ...BASE_OPTS, maxSwaps: 0 })
  assert.equal(countSwaps(zero), 0)
  assert.deepEqual(new Set(zero.schedule.map((f) => f.id)), new Set([zero.base.id]))
})

test('sem troca nenhuma, a cor sai do catálogo inteiro — não só das duas bases', () => {
  // Imagem chapada de um cinza que está no catálogo. Com maxSwaps: 0 o plano é
  // um filamento só, e o certo é o cinza; se as candidatas a base continuarem
  // sendo apenas a mais escura e a mais clara, sobra preto ou branco e o erro
  // pula de ~0 para dezenas.
  const cinza = achaCat('gravity-grey')
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < 16 * 16; i++) data.set([0x9f, 0xa4, 0xa7, 255], i * 4)
  const img: Bitmap = { width: 16, height: 16, data }

  const plan = searchSchedule(img, CATALOGO, { layerHeight: 0.15, baseLayers: 5, layers: 8, maxSwaps: 0, seed: 1 })
  assert.equal(countSwaps(plan), 0)
  assert.equal(plan.base.id, cinza.id)
  assert.ok(scorePlan(img, plan) < 1, `ΔE ${scorePlan(img, plan).toFixed(2)}`)
})

test('a enumeração de pares acha a troca profunda exata', () => {
  // A enumeração é quem acha o corte exato — o sorteio raramente cai na
  // combinação certa. Por isso os cortes enumerados também precisam alcançar o
  // meio do print: parando em 8, a troca da verdade na camada 16 fica fora.
  const verdade: LayerPlan = {
    layerHeight: 0.15,
    baseLayers: 5,
    base: achaCat('bambu-black'),
    schedule: [...rep(achaCat('azure-blue'), 16), ...rep(achaCat('lipstick-red'), 16)],
  }
  const img = bitmapCiclando(24, 24, buildPalette(verdade))

  // Orçamento igual ao custo da enumeração (2 bases × 12² × 12 cortes = 3456):
  // o sorteio não sobra, então o que este teste mede é só a enumeração.
  const plan = searchSchedule(img, CATALOGO, { layerHeight: 0.15, baseLayers: 5, layers: 32, maxSwaps: 2, candidates: 3456, seed: 1 })
  assert.equal(profundidadeDaTroca(plan), 16)
  assert.ok(scorePlan(img, plan) < 0.5, `ΔE ${scorePlan(img, plan).toFixed(2)}`)
})

test('countBands conta faixas contíguas, não filamentos distintos', () => {
  const a = acha('preto')
  const b = acha('branco')
  assert.equal(countBands([a, a, a]), 1)
  assert.equal(countBands([a, a, b, b]), 2)
  // Mesmo filamento voltando depois de outro são duas faixas — são duas trocas.
  assert.equal(countBands([a, b, a]), 3)

  // countSwaps olha o plano inteiro: a base é um rolo na impressora também.
  const plano = (base: Filament, schedule: Filament[]): LayerPlan => ({ layerHeight: 0.15, baseLayers: 5, base, schedule })
  assert.equal(countSwaps(plano(a, [a, a])), 0)
  assert.equal(countSwaps(plano(a, [b, b])), 1)
  assert.equal(countSwaps(plano(a, [a, b])), 1)
  assert.equal(countSwaps(plano(a, [b, a])), 2)
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
  for (const layers of [2, 4, 8, 16, 24, 48]) {
    const erro = scorePlan(img, searchSchedule(img, POOL, { ...orcamento, layers }))
    assert.ok(erro <= anterior + 1e-9, `${layers} camadas piorou: ${erro} > ${anterior}`)
    anterior = erro
  }
})

test('scorePlan pontua por vizinho mais próximo, não pelo dithering', () => {
  // A produção vai imprimir o resultado do dithering, mas quem pontua aqui é o
  // vizinho mais próximo: só ele é monotônico na paleta, que é a garantia em
  // que a busca inteira se apoia (ver o comentário de scorePlan).
  // Gradiente: nenhuma cor cai exatamente na paleta, que é onde as duas
  // pontuações divergem (numa imagem feita da própria paleta as duas dão 0).
  const data = new Uint8ClampedArray(32 * 32 * 4)
  for (let i = 0; i < 32 * 32; i++) {
    data.set([(i * 4) % 256, (i * 9) % 256, (i * 15) % 256, 255], i * 4)
  }
  const img: Bitmap = { width: 32, height: 32, data }
  const pal = buildPalette(PLANO_VERDADEIRO)
  const vizinho = imageError(img, renderHeightMap(solveHeights(img, pal), pal))
  const dither = imageError(img, renderHeightMap(ditherToPalette(img, pal), pal))
  assert.equal(scorePlan(img, PLANO_VERDADEIRO), vizinho)
  assert.notEqual(scorePlan(img, PLANO_VERDADEIRO), dither)
})

test('catálogo grande: a base escura não some do sorteio de duas faixas', () => {
  // Com 12 filamentos a enumeração de pares desliga e só o sorteio produz plano
  // de duas faixas. Sorteando base e número de faixas do mesmo contador, com 2
  // bases e maxBands par, a base vira função do número de faixas: todo plano de
  // duas faixas nascia na base clara e a verdade (base preta) ficava inatingível
  // — ΔE ≥ 15 em vez de ≤ 4.
  const verdade: LayerPlan = {
    layerHeight: 0.15,
    baseLayers: 5,
    base: achaCat('bambu-black'),
    schedule: [...rep(achaCat('azure-blue'), 16), ...rep(achaCat('lipstick-red'), 16)],
  }
  const img = bitmapCiclando(40, 40, buildPalette(verdade))
  assert.ok(scorePlan(img, verdade) < 1e-9)

  for (const seed of [3, 42, 99]) {
    const plan = searchSchedule(img, CATALOGO, { layerHeight: 0.15, baseLayers: 5, layers: 32, maxSwaps: 2, seed })
    assert.equal(plan.base.id, 'bambu-black', `semente ${seed} pegou a base ${plan.base.id}`)
    assert.equal(countSwaps(plan), 2)
    const erro = scorePlan(img, plan)
    assert.ok(erro < 8, `semente ${seed}: ΔE ${erro.toFixed(2)}`)
  }
})

test('a troca sorteada alcança o meio do print, e o teto de 64 camadas é conhecido', () => {
  // Verdade com a troca lá na camada 90 de 120. O comprimento de faixa é
  // sorteado sem olhar para `layers` (é isso que dá a monotonicidade), então há
  // um teto fixo: com o teto antigo de 6 nenhuma troca passava da camada 6 e um
  // print de 120 camadas nunca via troca no meio.
  const verdade: LayerPlan = {
    layerHeight: 0.08,
    baseLayers: 5,
    base: achaCat('bambu-black'),
    schedule: [...rep(achaCat('azure-blue'), 90), ...rep(achaCat('lipstick-red'), 30)],
  }
  const img = bitmapCiclando(24, 24, buildPalette(verdade))

  const cortes = [1, 2, 3, 5].map((seed) =>
    profundidadeDaTroca(searchSchedule(img, CATALOGO, { layerHeight: 0.08, baseLayers: 5, layers: 120, maxSwaps: 2, seed })),
  )
  const maisFundo = Math.max(...cortes)
  assert.ok(maisFundo >= 12, `troca mais profunda alcançada: camada ${maisFundo} (cortes: ${cortes})`)
  // ponytail documentado: 64 é o teto do comprimento de faixa. A troca da
  // verdade, na camada 90, está fora do alcance do sorteio de propósito.
  assert.ok(maisFundo <= 64, `troca acima do teto de 64: camada ${maisFundo} (cortes: ${cortes})`)
})

test('imagem alongada: nenhuma linha some da amostragem', () => {
  // 256×4. Derivando um passo único do maior lado, a amostra vira 64×1 e as
  // linhas 1..3 — 75% da imagem — desaparecem da pontuação.
  const verdade: LayerPlan = {
    layerHeight: 0.15,
    baseLayers: 5,
    base: achaCat('bambu-black'),
    schedule: rep(achaCat('pineapple-yellow'), 8),
  }
  const pal = buildPalette(verdade)
  const w = 256
  const h = 4
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Linha 0 é só a cor da base; a cor de verdade está nas linhas de baixo.
      const c = y === 0 ? pal[0] : pal[1 + ((x + y) % (pal.length - 1))]
      data.set([c.r, c.g, c.b, 255], (y * w + x) * 4)
    }
  }
  const img: Bitmap = { width: w, height: h, data }

  const plan = searchSchedule(img, CATALOGO, { layerHeight: 0.15, baseLayers: 5, layers: 8, maxSwaps: 1, seed: 1 })
  const erro = scorePlan(img, plan)
  // Enxergando só a linha 0 a busca acha que a imagem é preta e devolve um
  // plano chapado, que erra ΔE ~45 na imagem inteira.
  assert.ok(erro < 1, `ΔE ${erro.toFixed(2)} — a busca não viu as linhas de baixo`)
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
  const plan = searchSchedule(img, CATALOGO, { layerHeight: 0.08, baseLayers: 5, layers: 12, maxSwaps: 3, seed: 3 })
  const dt = performance.now() - t0
  assert.equal(plan.schedule.length, 12)
  assert.ok(dt < 3000, `searchSchedule levou ${dt.toFixed(0)}ms`)
})
