import test from 'node:test'
import assert from 'node:assert/strict'
import type { Bitmap, Filament } from './types.ts'
import { resolveColor } from './resolve.ts'
import { toneMap } from './tone.ts'
import { rgbToLab } from './space.ts'

/**
 * Reproduz a estrutura do problema real (foto do Guilherme: cachorro preto
 * sobre madeira, contra um catálogo de filamentos que não alcançava o
 * escuro): uma região grande e escura de baixa croma (o "cachorro"), e uma
 * região de croma alta e quente na faixa média-clara (a "madeira"). Sintética
 * porque o núcleo não tem decodificador de imagem (é livre de DOM de
 * propósito) — não há como abrir o `.jpg` real num teste de Node.
 */
function cenaCachorro(w: number, h: number): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dCao = Math.hypot((x - w * 0.38) / (w * 0.28), (y - h * 0.5) / (h * 0.4))
      const ruido = ((x * 13 + y * 7) % 11) / 11
      if (dCao < 1) {
        // pelo preto: bem mais escuro que qualquer filamento do catálogo abaixo, baixa croma
        const v = 6 + ruido * 6
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v + 2
      } else {
        // madeira: marrom quente, com veios (gradiente + ruído)
        const base = 60 + (x / w) * 40
        data[i] = Math.min(255, base + 30 + ruido * 6)
        data[i + 1] = Math.min(255, base + 5 + ruido * 3.6)
        data[i + 2] = Math.max(0, base - 25 + ruido * 1.8)
      }
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/** Catálogo cujo escuro (L≈17,5) não alcança o pelo preto — a mesma forma do achado real. */
const FILAMENTOS: Filament[] = [
  { id: 'k', name: 'Cinza escuro', hex: '#2B2B2B', td: 0.5 },
  { id: 'r', name: 'Marrom', hex: '#8A4B2E', td: 1.5 },
  { id: 'w', name: 'Bege claro', hex: '#E8DCC8', td: 5.0 },
]

const OPTS = {
  width: 120,
  height: 90,
  cellSize: 1,
  layerHeight: 0.16,
  baseLayers: 15,
  layers: 20,
  maxSwaps: 2,
  dither: false,
  seed: 3,
}

function medir(heightMapData: Uint8Array) {
  const contagem = new Map<number, number>()
  for (const v of heightMapData) contagem.set(v, (contagem.get(v) ?? 0) + 1)
  const maisPopuloso = Math.max(...contagem.values()) / heightMapData.length
  return { maisPopuloso, niveisUsados: contagem.size }
}

test('sem tone map, a foto colapsa num nível — reproduz o achado real (21,3% na foto do Guilherme)', () => {
  const foto = cenaCachorro(120, 90)
  const r = resolveColor(foto, FILAMENTOS, { ...OPTS, toneMap: 'off' })
  const { maisPopuloso } = medir(r.heightMap.data)
  // a região escura sozinha já é ~35% da cena sintética — tem que colapsar
  // toda nela pra reproduzir o problema (o real era 21,3%, a estrutura é a mesma)
  assert.ok(maisPopuloso >= 0.3, `esperava colapso forte sem tone map, veio ${(maisPopuloso * 100).toFixed(1)}%`)
})

test('tone map (auto) derruba a concentração no nível mais populoso e usa mais níveis — trava a regressão', () => {
  const foto = cenaCachorro(120, 90)
  const semTone = medir(resolveColor(foto, FILAMENTOS, { ...OPTS, toneMap: 'off' }).heightMap.data)
  const comTone = medir(resolveColor(foto, FILAMENTOS, OPTS).heightMap.data) // 'auto' é o default

  // Aviso do próprio Guilherme: ΔE médio pode PIORAR com o tone map (medido:
  // 13,8 → 17,8 na foto real) enquanto a imagem melhora muito — a métrica que
  // a busca otimiza premiava o resultado errado. Por isso os dois números que
  // importam aqui são concentração no nível mais populoso e níveis usados,
  // nunca ΔE sozinho.
  assert.ok(
    comTone.maisPopuloso < semTone.maisPopuloso - 0.05,
    `nível mais populoso não caiu o suficiente: ${(semTone.maisPopuloso * 100).toFixed(1)}% → ${(comTone.maisPopuloso * 100).toFixed(1)}%`,
  )
  assert.ok(
    comTone.niveisUsados > semTone.niveisUsados,
    `níveis usados não subiram: ${semTone.niveisUsados} → ${comTone.niveisUsados}`,
  )
})

test("toneMap: 'off' devolve a foto intacta, byte a byte", () => {
  const foto = cenaCachorro(20, 15)
  const out = toneMap(foto, FILAMENTOS, { mode: 'off' })
  assert.deepEqual(out.data, foto.data)
})

test('sem variação de luminância na foto (ou no catálogo), o tone map devolve intacto em vez de dividir por ~0', () => {
  const lisa: Bitmap = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(128) }
  for (let i = 3; i < lisa.data.length; i += 4) lisa.data[i] = 255
  const out = toneMap(lisa, FILAMENTOS)
  assert.deepEqual(out.data, lisa.data)

  const foto = cenaCachorro(20, 15)
  const monocromatico: Filament[] = [{ id: 'k', name: 'Preto', hex: '#111111', td: 0.5 }]
  const out2 = toneMap(foto, monocromatico)
  assert.deepEqual(out2.data, foto.data)
})

test('toneMap só mexe em L — croma e matiz da foto passam intactos (decisão medida, ver o comentário do arquivo)', () => {
  // Duas tentativas de remapear croma também foram medidas e rejeitadas (a
  // segunda chegou a DESTRUIR a croma numa cena saturada — razão 0,12 contra
  // a foto original). Este teste trava a decisão atual: só L muda.
  const foto = cenaCachorro(30, 24)
  const out = toneMap(foto, FILAMENTOS)
  let maiorDiffA = 0
  let maiorDiffB = 0
  for (let i = 0; i < foto.data.length; i += 4) {
    const labIn = rgbToLab({ r: foto.data[i], g: foto.data[i + 1], b: foto.data[i + 2] })
    const labOut = rgbToLab({ r: out.data[i], g: out.data[i + 1], b: out.data[i + 2] })
    maiorDiffA = Math.max(maiorDiffA, Math.abs(labIn[1] - labOut[1]))
    maiorDiffB = Math.max(maiorDiffB, Math.abs(labIn[2] - labOut[2]))
  }
  // tolerância cobre só o arredondamento de 8 bits do round-trip Lab→RGB→Lab
  // depois que L muda — não croma sendo de fato remapeada
  assert.ok(maiorDiffA < 1, `a* mudou mais do que arredondamento explica: ${maiorDiffA}`)
  assert.ok(maiorDiffB < 1, `b* mudou mais do que arredondamento explica: ${maiorDiffB}`)
})

test('percentis inválidos e catálogo vazio lançam', () => {
  const foto = cenaCachorro(10, 10)
  assert.throws(() => toneMap(foto, []), /filamento/)
  assert.throws(() => toneMap(foto, FILAMENTOS, { loPercentile: 50, hiPercentile: 50 }), /percentis/)
  assert.throws(() => toneMap(foto, FILAMENTOS, { loPercentile: -1 }), /percentis/)
  assert.throws(() => toneMap(foto, FILAMENTOS, { hiPercentile: 101 }), /percentis/)
})
