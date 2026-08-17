import type { Bitmap, Filament, LayerPlan } from './types.ts'
import { parseHex, rgbToLab } from './space.ts'
import { buildPalette } from './beer-lambert.ts'
import { imageError, renderHeightMap, solveHeights } from './solver.ts'

/**
 * Escolha do cronograma: qual filamento vai em cada camada.
 *
 * O cronograma é feito de **faixas contíguas** porque a troca é manual — a
 * pessoa para a impressora e troca o rolo. Sortear filamento camada a camada
 * daria um print impossível de acompanhar.
 *
 * Com o cronograma fixo o resto é barato: `buildPalette` dá as L+1 cores e
 * `solveHeights` + `imageError` pontuam o cronograma inteiro de uma vez. A
 * busca é só um laço por cima dessas duas funções.
 */

export interface ScheduleOptions {
  layerHeight: number
  baseLayers: number
  /** Camadas de cor acima da base. */
  layers: number
  /** Trocas de filamento permitidas (a pessoa troca à mão!). */
  maxSwaps: number
  /** Quantos cronogramas avaliar. */
  candidates?: number
  seed?: number
}

/**
 * Lado máximo da imagem reduzida na qual a busca pontua. 64×64 = 4096 pixels
 * amostrados por vizinho mais próximo — a busca roda no browser e pontuar a
 * foto inteira centenas de vezes travaria a aba. A 4096 amostras o erro médio
 * de um cronograma já está estável na segunda casa; o que muda de um plano
 * para outro é muito maior que esse ruído.
 *
 * ponytail: amostragem por salto, sem média de área — em imagens com textura
 * fina (xadrez de 1px) a amostra vira aliasing. Se incomodar, fazer média de
 * bloco no downsample.
 */
const SAMPLE_MAX = 64

/** Comprimento máximo de faixa sorteado. Ver a nota de monotonicidade abaixo. */
const MAX_BAND_LEN = 6

/** Cortes testados na enumeração de duas faixas: onde a primeira faixa termina. */
const CORTES = [1, 2, 3, 4, 6, 8]

/**
 * Quantos cronogramas avaliar quando o chamador não diz. Dá para enumerar o
 * caso de duas faixas com um catálogo de até ~10 filamentos e ainda sobrar
 * aleatório; a busca inteira fica abaixo de 1s numa imagem amostrada.
 */
const DEFAULT_CANDIDATES = 1200

/** Erro médio (ΔE) entre a imagem e o que o plano consegue reproduzir. Menor é melhor. */
export function scorePlan(img: Bitmap, plan: LayerPlan): number {
  const palette = buildPalette(plan)
  return imageError(img, renderHeightMap(solveHeights(img, palette), palette))
}

/** Número de faixas contíguas: trocas manuais = countBands - 1. */
export function countBands(schedule: Filament[]): number {
  let n = 0
  for (let i = 0; i < schedule.length; i++) {
    if (i === 0 || schedule[i].id !== schedule[i - 1].id) n++
  }
  return n
}

/** mulberry32 — PRNG determinístico de uma linha, para a busca ser reprodutível. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Reduz por vizinho mais próximo até caber em SAMPLE_MAX de lado. */
function sampleDown(img: Bitmap): Bitmap {
  const passo = Math.max(1, Math.ceil(Math.max(img.width, img.height) / SAMPLE_MAX))
  if (passo === 1) return img
  const w = Math.max(1, Math.ceil(img.width / passo))
  const h = Math.max(1, Math.ceil(img.height / passo))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.min(y * passo, img.height - 1) * img.width + Math.min(x * passo, img.width - 1)) * 4
      const dst = (y * w + x) * 4
      data[dst] = img.data[src]
      data[dst + 1] = img.data[src + 1]
      data[dst + 2] = img.data[src + 2]
      data[dst + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

interface Band {
  filament: Filament
  len: number
}

/**
 * Faixas → cronograma de `layers` camadas: corta o que sobra e repete o último
 * filamento no que falta.
 *
 * O corte/preenchimento no **topo** é o que dá a monotonicidade: as faixas são
 * sorteadas sem olhar para `layers`, então o cronograma de L camadas é sempre
 * prefixo do de L' > L camadas. Como `buildPalette` é cumulativa, a paleta de L
 * é prefixo da de L' — mais camadas só acrescentam cores, nunca tiram. Daí
 * "mais camadas nunca piora o erro" ser garantia, não sorte.
 */
function materialize(bands: Band[], layers: number): Filament[] {
  const out: Filament[] = []
  for (const b of bands) {
    for (let i = 0; i < b.len && out.length < layers; i++) out.push(b.filament)
  }
  const ultimo = bands[bands.length - 1].filament
  while (out.length < layers) out.push(ultimo)
  return out
}

/**
 * Bases candidatas: a mais escura e a mais clara do conjunto.
 *
 * ponytail: só duas bases. Cobre os dois estilos usados na prática (fundo preto
 * puxando as sombras, fundo branco puxando as luzes). Se quiser varrer tudo,
 * trocar por `filaments` inteiro — o custo é linear no número de bases.
 */
function baseCandidates(filaments: Filament[]): Filament[] {
  let escuro = filaments[0]
  let claro = filaments[0]
  let lEscuro = Infinity
  let lClaro = -Infinity
  for (const f of filaments) {
    const l = rgbToLab(parseHex(f.hex))[0]
    if (l < lEscuro) {
      lEscuro = l
      escuro = f
    }
    if (l > lClaro) {
      lClaro = l
      claro = f
    }
  }
  return escuro.id === claro.id ? [escuro] : [escuro, claro]
}

export function searchSchedule(img: Bitmap, filaments: Filament[], opts: ScheduleOptions): LayerPlan {
  if (filaments.length === 0) throw new Error('nenhum filamento disponível')
  if (!(opts.layerHeight > 0) || !Number.isFinite(opts.layerHeight)) {
    throw new Error(`altura de camada inválida: ${opts.layerHeight}`)
  }
  if (!Number.isInteger(opts.baseLayers) || opts.baseLayers < 0) {
    throw new Error(`baseLayers inválido: ${opts.baseLayers}`)
  }
  // A paleta tem layers+1 entradas e o HeightMap é Uint8Array — 255 é o teto real.
  if (!Number.isInteger(opts.layers) || opts.layers < 1 || opts.layers > 255) {
    throw new Error(`layers inválido: ${opts.layers} (1..255)`)
  }
  if (!Number.isInteger(opts.maxSwaps) || opts.maxSwaps < 0) {
    throw new Error(`maxSwaps inválido: ${opts.maxSwaps}`)
  }
  const candidates = opts.candidates ?? DEFAULT_CANDIDATES
  if (!Number.isInteger(candidates) || candidates < 1) {
    throw new Error(`candidates inválido: ${candidates}`)
  }

  const alvo = sampleDown(img)
  const bases = baseCandidates(filaments)
  // Sem `min` com `layers` de propósito: o sorteio tem que ser igual para
  // qualquer número de camadas. Faixa que não cabe é cortada em `materialize`.
  const maxBands = opts.maxSwaps + 1
  const rand = rng(opts.seed ?? 1)

  const monta = (base: Filament, bands: Band[]): LayerPlan => ({
    layerHeight: opts.layerHeight,
    baseLayers: opts.baseLayers,
    base,
    schedule: materialize(bands, opts.layers),
  })

  let best: LayerPlan | undefined
  let bestErr = Infinity
  const avalia = (plan: LayerPlan) => {
    const err = scorePlan(alvo, plan)
    if (err < bestErr) {
      bestErr = err
      best = plan
    }
  }

  // Sementes determinísticas: cada base com cada filamento em faixa única.
  // Garante um piso decente mesmo com orçamento apertado de candidatos.
  for (const base of bases) {
    for (const f of filaments) avalia(monta(base, [{ filament: f, len: 1 }]))
  }

  // Duas faixas (base + uma troca) é o formato mais usado na prática, e o
  // aleatório demora muito para cair na combinação exata. Quando o catálogo é
  // pequeno o bastante para caber no orçamento, enumera tudo. Com catálogo
  // grande o custo é n², então cai no aleatório — a condição só olha para o
  // tamanho do catálogo, nunca para `layers`.
  const custoPares = bases.length * filaments.length * filaments.length * CORTES.length
  let usados = 0
  if (maxBands >= 2 && custoPares <= candidates) {
    for (const base of bases) {
      for (const a of filaments) {
        for (const b of filaments) {
          for (const corte of CORTES) {
            avalia(monta(base, [{ filament: a, len: corte }, { filament: b, len: 1 }]))
          }
        }
      }
    }
    usados = custoPares
  }

  // Aleatório determinístico no orçamento restante. O sorteio NÃO olha para
  // `opts.layers` (ver `materialize`), então o mesmo candidato com mais camadas
  // é sempre um refinamento do mesmo cronograma, nunca um cronograma diferente.
  for (let c = 0; c < candidates - usados; c++) {
    const base = bases[c % bases.length]
    // Estratifica o número de faixas em vez de sortear: com orçamento pequeno,
    // sortear deixaria alguma contagem de faixas sem nenhuma amostra.
    const k = 1 + (c % maxBands)
    const bands: Band[] = []
    for (let j = 0; j < k; j++) {
      bands.push({
        filament: filaments[Math.floor(rand() * filaments.length)],
        len: 1 + Math.floor(rand() * MAX_BAND_LEN),
      })
    }
    avalia(monta(base, bands))
  }

  if (!best) throw new Error('busca não produziu nenhum cronograma')
  return best
}
