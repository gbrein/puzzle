import test from 'node:test'
import assert from 'node:assert/strict'
import type { Bitmap, Filament } from './types.ts'
import { suggestPalette } from './suggest.ts'

const OPTS = { layerHeight: 0.08, baseLayers: 30, layers: 50 }

/** Bitmap sólido de uma cor. */
function solido(w: number, h: number, hex: string): Bitmap {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4)
  return { width: w, height: h, data }
}

/** Metade escura, metade clara — o caso mais simples com contraste real. */
function metadeAmetade(w: number, h: number, esq: string, dir: string): Bitmap {
  const a = solido(w, h, esq)
  const b = solido(w, h, dir)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const src = x < w / 2 ? a.data : b.data
      data.set(src.subarray(i, i + 4), i)
    }
  }
  return { width: w, height: h, data }
}

const POOL: Filament[] = [
  { id: 'preto', name: 'Preto', hex: '#1A1A1A', td: 0.3 },
  { id: 'branco', name: 'Branco', hex: '#F2F2F2', td: 5.5 },
  { id: 'vermelho', name: 'Vermelho', hex: '#D03036', td: 0.9 },
  { id: 'azul', name: 'Azul', hex: '#04518E', td: 0.8 },
  { id: 'amarelo', name: 'Amarelo', hex: '#EFD006', td: 1.4 },
  { id: 'cinza', name: 'Cinza', hex: '#9FA4A7', td: 0.7 },
  { id: 'verde', name: 'Verde', hex: '#3E8E41', td: 1.1 },
  { id: 'rosa', name: 'Rosa', hex: '#E34A93', td: 1.6 },
]

/**
 * Gradiente horizontal de quase-preto (L≈1) a quase-branco, com uma faixa
 * central mais saturada — a foto de faixa tonal mais larga possível, o pior
 * caso pro provisório de bandas uniformes (estica L inteiro e ainda tem
 * croma). Hex e TD copiados do catálogo real (`filaments/db.ts`) mas
 * fixados aqui, mesma convenção de `schedule.test.ts`.
 */
function gradienteLargo(w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const t = x / (w - 1)
      const v = 3 + t * 249 // quase preto a quase branco
      const faixaCentral = Math.abs(y / h - 0.5) < 0.15
      data[i] = v
      data[i + 1] = faixaCentral ? v * 0.6 : v
      data[i + 2] = faixaCentral ? v * 0.4 : v
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

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

test('a curva tem uma entrada por n, filamentos acumulam (cada passo é prefixo do próximo)', () => {
  const foto = metadeAmetade(40, 40, '#101010', '#F0F0F0')
  const s = suggestPalette(foto, POOL, { ...OPTS, maxColors: 5 })

  assert.equal(s.curve.length, 5)
  s.curve.forEach((passo, i) => {
    assert.equal(passo.n, i + 1)
    assert.equal(passo.filaments.length, i + 1)
    if (i > 0) {
      const anterior = s.curve[i - 1].filaments
      assert.deepEqual(passo.filaments.slice(0, anterior.length), anterior, `passo ${i + 1} não é prefixo do anterior + 1`)
    }
  })
  // nenhum filamento repetido dentro da seleção final
  const ids = s.curve[s.curve.length - 1].filaments.map((f) => f.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('recommended cai dentro da curva e bate com a paleta devolvida', () => {
  const foto = metadeAmetade(40, 40, '#101010', '#F0F0F0')
  const s = suggestPalette(foto, POOL, { ...OPTS, maxColors: 6 })
  assert.ok(s.recommended >= 1 && s.recommended <= s.curve.length)
  const passo = s.curve.find((p) => p.n === s.recommended)
  assert.deepEqual(s.filaments, passo?.filaments)
})

test('maxColors é limitado pelo tamanho do inventário — não inventa cor', () => {
  const foto = solido(20, 20, '#808080')
  const pool = POOL.slice(0, 3)
  const s = suggestPalette(foto, pool, { ...OPTS, maxColors: 10 })
  assert.equal(s.curve.length, 3)
})

test('imagem monocromática: uma cor já é ótima, o erro não cai muito depois disso', () => {
  const foto = solido(20, 20, '#1A1A1A') // igual ao preto do pool
  const s = suggestPalette(foto, POOL, { ...OPTS, maxColors: 4 })
  assert.equal(s.curve[0].filaments[0].id, 'preto')
  assert.ok(s.curve[0].error < 1, `esperava erro ~0 pra foto igual à primeira cor, veio ${s.curve[0].error}`)
})

test('a recomendação para no ponto certo em vez de acumular cinzas quase iguais — a armadilha do alvo recalculado por candidato', () => {
  // Se o alvo fosse recalculado por candidato (tone map ou qualquer outro
  // remapeamento), um trio de cinzas quase idênticos espremeria a foto
  // inteira na própria faixa minúscula e pontuaria baixíssimo — vencendo por
  // reproduzir um alvo achatado quase perfeito, mesmo destruindo o contraste
  // real da foto. Com o alvo FIXO (a foto crua, a mesma pra todo candidato),
  // a 1a cor pode legitimamente ser um cinza (é o compromisso ótimo pra UMA
  // cor só num split 50/50 escuro-claro — qual dos três cinzas quase iguais
  // ganha o desempate não importa aqui), mas preto e branco têm que entrar
  // em seguida — e ADICIONAR os outros dois cinzas depois piora o erro (a
  // banda uniforme fica mais fina), então `recommended` tem que parar antes
  // de acumular os DOIS cinzas redundantes que sobraram.
  const foto = metadeAmetade(40, 40, '#101010', '#F0F0F0')
  const decoy: Filament[] = [
    { id: 'cinza1', name: 'Cinza 1', hex: '#7F7F7F', td: 1.0 },
    { id: 'cinza2', name: 'Cinza 2', hex: '#7E7E7E', td: 1.0 },
    { id: 'cinza3', name: 'Cinza 3', hex: '#808080', td: 1.0 },
    { id: 'preto', name: 'Preto', hex: '#0A0A0A', td: 0.3 },
    { id: 'branco', name: 'Branco', hex: '#FAFAFA', td: 6.0 },
  ]
  const s = suggestPalette(foto, decoy, { ...OPTS, maxColors: 5 })

  const idsRecomendados = s.filaments.map((f) => f.id)
  const cinzasNaRecomendacao = idsRecomendados.filter((id) => id.startsWith('cinza')).length
  assert.ok(idsRecomendados.includes('preto'), 'preto tinha que estar na recomendação')
  assert.ok(idsRecomendados.includes('branco'), 'branco tinha que estar na recomendação')
  assert.ok(
    cinzasNaRecomendacao <= 1,
    `recomendação acumulou cinza redundante em vez de parar: ${idsRecomendados.join('+')}`,
  )

  // e o erro piora de verdade quando os cinzas redundantes entram depois —
  // é ESSE sinal que faz `recommended` parar, não um número mágico
  const antesDosCinzas = s.curve[s.recommended - 1].error
  const depoisDosCinzas = s.curve[s.curve.length - 1].error
  assert.ok(
    depoisDosCinzas > antesDosCinzas,
    `esperava que empilhar cinzas redundantes piorasse o erro: ${antesDosCinzas} → ${depoisDosCinzas}`,
  )
})

test('faixa tonal larga com região quase preta: o alvo cru não explode em violações de monotonicidade', () => {
  // Cenário que motivou a troca de alvo (documentada em cima de
  // `suggestPalette`): gradiente de faixa larga (quase preto a quase branco,
  // com croma) contra um catálogo grande e variado. Medido: com o alvo
  // tonemapeado pro inventário inteiro, este cenário específico dava 4/7
  // violações; a foto crua, no pior caso medido nos 4 cenários da tabela do
  // comentário, nunca passou de 4/7. Aqui ela também dá 4/7 — não é perfeito
  // (o provisório de bandas uniformes tem limite), mas não piora.
  const foto = gradienteLargo(160, 40)
  const s = suggestPalette(foto, CATALOGO, { ...OPTS, maxColors: 8 })

  let violacoes = 0
  for (let i = 1; i < s.curve.length; i++) {
    if (s.curve[i].error > s.curve[i - 1].error + 1e-9) violacoes++
  }
  assert.ok(
    violacoes <= 5,
    `violações de monotonicidade demais: ${violacoes}/${s.curve.length - 1} — ${s.curve.map((p) => p.error.toFixed(1)).join(', ')}`,
  )
  // e o mínimo da curva continua no início, não no fim — é isso que faz o
  // joelho recomendar poucas cores em vez do catálogo inteiro
  const minimo = Math.min(...s.curve.map((p) => p.error))
  assert.ok(s.curve[0].error > minimo, 'a curva tinha que melhorar em algum ponto depois de n=1')
  assert.ok(s.recommended < s.curve.length, 'recommended não devia ser o catálogo inteiro aqui')
})

test('inventário vazio e layers inválido lançam', () => {
  const foto = solido(10, 10, '#808080')
  assert.throws(() => suggestPalette(foto, [], OPTS), /inventário vazio/)
  assert.throws(() => suggestPalette(foto, POOL, { ...OPTS, layers: 0 }), /layers/)
  assert.throws(() => suggestPalette(foto, POOL, { ...OPTS, layerHeight: 0 }), /layerHeight/)
})
