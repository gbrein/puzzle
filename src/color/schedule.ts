import type { Bitmap, Filament, LayerPlan } from './types.ts'
import { parseHex, rgbToLab } from './space.ts'
import { buildPalette } from './beer-lambert.ts'
import { imageError, renderHeightMap, solveHeights } from './solver.ts'
import { rng } from '../rand.ts'

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
  /**
   * Trocas de filamento permitidas (a pessoa troca à mão!). Conta a troca
   * base → primeira camada de cor, que é troca de rolo como qualquer outra:
   * `maxSwaps: 0` significa impressão de um filamento só, do fundo ao topo.
   */
  maxSwaps: number
  /**
   * Orçamento da parte *buscada*: enumeração de duas faixas + sorteio. As
   * sementes determinísticas rodam por fora e custam até `filaments.length * 3`
   * avaliações — são o piso de qualidade, não entram no orçamento.
   * Sem efeito com `maxSwaps <= 1`: aí as sementes já são a resposta exata.
   */
  candidates?: number
  seed?: number
}

/**
 * Lado máximo da imagem reduzida na qual a busca pontua. Até 64×64 = 4096
 * pixels amostrados por vizinho mais próximo — a busca roda no browser e
 * pontuar a foto inteira centenas de vezes travaria a aba. A 4096 amostras o
 * erro médio de um cronograma já está estável na segunda casa; o que muda de um
 * plano para outro é muito maior que esse ruído.
 *
 * ponytail: amostragem por salto, sem média de área — em imagens com textura
 * fina (xadrez de 1px) a amostra vira aliasing. Se incomodar, fazer média de
 * bloco no downsample.
 */
const SAMPLE_MAX = 64

/**
 * Comprimento máximo de faixa sorteado. Precisa ser independente de `layers`
 * (ver a nota de monotonicidade em `materialize`), por isso é constante — mas
 * uma constante pequena vira teto de profundidade: com 6, nenhuma troca era
 * sorteada abaixo da camada 6 por faixa, e um print de 120 camadas nunca via
 * uma troca no meio.
 *
 * ponytail: teto de 64 camadas por faixa. Acima disso a troca profunda só entra
 * pela enumeração de CORTES. Se aparecer print com muito mais que 64 camadas de
 * cor, subir os dois (o custo é convergência mais lenta, não tempo por
 * candidato) ou sortear o comprimento em fração de `layers` — o que exigiria
 * abrir mão da monotonicidade.
 */
const MAX_BAND_LEN = 64

/** Cortes testados na enumeração de duas faixas: onde a primeira faixa termina. */
const CORTES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]

/**
 * Quantos cronogramas avaliar quando o chamador não diz. Dá para enumerar o
 * caso de duas faixas com um catálogo de até ~10 filamentos e ainda sobrar
 * aleatório; a busca inteira fica abaixo de 1s numa imagem amostrada.
 */
const DEFAULT_CANDIDATES = 1200

/**
 * Erro médio (ΔE) entre a imagem e o que o plano consegue reproduzir. Menor é melhor.
 *
 * Pontua com `solveHeights` (vizinho mais próximo) e **não** com
 * `ditherToPalette`, que é o que a produção vai imprimir. A escolha é
 * deliberada: só o vizinho mais próximo é monotônico na paleta. Como a paleta
 * de L camadas é prefixo da de L' > L, acrescentar camadas só pode aproximar o
 * vizinho — daí "mais camadas nunca piora" ser garantia. O dithering difunde
 * erro entre pixels: acrescentar uma cor muda a difusão da imagem inteira e o
 * ΔE médio por pixel às vezes sobe (medido num gradiente 64×64: ditherizado vai
 * de 44.505 com 17 camadas para 44.506 com 18, e de 44.489 com 19 para 44.490
 * com 20 — violação pequena, mas a garantia é um `<=` estrito). Pior: ΔE por pixel
 * pune justamente quem ditheriza bem, porque o dithering troca erro por pixel
 * por acerto na média espacial — julgá-lo exigiria uma métrica com borrão, mais
 * cara e com outro parâmetro para calibrar. O que a busca escolhe é a *paleta*,
 * e cobertura de paleta é o que o vizinho mais próximo mede.
 */
export function scorePlan(img: Bitmap, plan: LayerPlan): number {
  const palette = buildPalette(plan)
  return imageError(img, renderHeightMap(solveHeights(img, palette), palette))
}

/**
 * Número de faixas contíguas na sequência dada.
 *
 * Para contar as trocas manuais de um plano, a base entra na conta — ela é um
 * rolo na impressora como qualquer outro: `countBands([plan.base,
 * ...plan.schedule]) - 1`.
 */
export function countBands(schedule: Filament[]): number {
  let n = 0
  for (let i = 0; i < schedule.length; i++) {
    if (i === 0 || schedule[i].id !== schedule[i - 1].id) n++
  }
  return n
}

/** Trocas manuais que um plano exige. */
export function countSwaps(plan: LayerPlan): number {
  return countBands([plan.base, ...plan.schedule]) - 1
}

/** Reduz por vizinho mais próximo até caber em SAMPLE_MAX de lado. */
function sampleDown(img: Bitmap): Bitmap {
  // Passo por eixo, não pelo maior lado: com passo único, uma imagem 512×16
  // colapsa para 64×2 e 14 das 16 linhas somem da pontuação. A busca só olha a
  // população de cores, então distorcer a proporção aqui não custa nada.
  const passoX = Math.max(1, Math.ceil(img.width / SAMPLE_MAX))
  const passoY = Math.max(1, Math.ceil(img.height / SAMPLE_MAX))
  if (passoX === 1 && passoY === 1) return img
  const w = Math.max(1, Math.ceil(img.width / passoX))
  const h = Math.max(1, Math.ceil(img.height / passoY))
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (Math.min(y * passoY, img.height - 1) * img.width + Math.min(x * passoX, img.width - 1)) * 4
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
 * trocar por `filaments` inteiro — o custo é linear no número de bases. O caso
 * monocromático foge desta restrição: lá toda cor do catálogo é base candidata.
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
  const rand = rng(opts.seed ?? 1)

  const monta = (base: Filament, bands: Band[]): LayerPlan => ({
    layerHeight: opts.layerHeight,
    baseLayers: opts.baseLayers,
    base,
    schedule: materialize(bands, opts.layers),
  })

  let best: LayerPlan | undefined
  let bestErr = Infinity
  const avalia = (base: Filament, bands: Band[]) => {
    // Orçamento contado nas *faixas*, não no cronograma materializado: o corte
    // em `materialize` só reduz trocas, e contar depois do corte faria o mesmo
    // candidato ser legal com poucas camadas e ilegal com muitas — o que
    // quebraria a monotonicidade.
    if (countBands([base, ...bands.map((b) => b.filament)]) - 1 > opts.maxSwaps) return
    const plan = monta(base, bands)
    const err = scorePlan(alvo, plan)
    if (err < bestErr) {
      bestErr = err
      best = plan
    }
  }

  // Monocromático: um filamento do fundo ao topo, zero trocas. É o único plano
  // legal com maxSwaps = 0 — e aí a base não pode ficar presa às duas
  // candidatas, senão "imprima tudo de uma cor" ignoraria o catálogo inteiro.
  for (const f of filaments) avalia(f, [{ filament: f, len: 1 }])

  // Sementes determinísticas: cada base com cada filamento em faixa única.
  // Garante um piso decente mesmo com orçamento apertado de candidatos.
  for (const base of bases) {
    for (const f of filaments) avalia(base, [{ filament: f, len: 1 }])
  }

  // Com até uma troca as sementes acima já são a resposta exata (dadas as bases
  // candidatas), então nem enumeração nem sorteio: o único plano de uma troca é
  // "base X, cronograma todo de Y", e as sementes varrem todo par (X, Y).
  // Esticar a base nas primeiras camadas — base X, faixa X, depois Y — é
  // *dominado*: a paleta vira subconjunto da de "X + tudo Y" (cor sobre ela
  // mesma não muda nada, e o topo perde camadas), e vizinho mais próximo num
  // subconjunto nunca erra menos. Só vale enquanto `scorePlan` for vizinho mais
  // próximo; com dithering o argumento cai junto.
  if (opts.maxSwaps <= 1) {
    if (!best) throw new Error('busca não produziu nenhum cronograma')
    return best
  }

  // Duas faixas é o formato mais usado na prática, e o aleatório demora muito
  // para cair na combinação exata. Quando o catálogo é pequeno o bastante para
  // caber no orçamento, enumera tudo. Com catálogo grande o custo é n², então
  // cai no aleatório — a condição só olha para o tamanho do catálogo, nunca
  // para `layers`.
  const custoPares = bases.length * filaments.length * filaments.length * CORTES.length
  let usados = 0
  if (custoPares <= candidates) {
    for (const base of bases) {
      for (const a of filaments) {
        for (const b of filaments) {
          for (const corte of CORTES) {
            avalia(base, [{ filament: a, len: corte }, { filament: b, len: 1 }])
          }
        }
      }
    }
    usados = custoPares
  }

  // Aleatório determinístico no orçamento restante. O sorteio NÃO olha para
  // `opts.layers` (ver `materialize`), então o mesmo candidato com mais camadas
  // é sempre um refinamento do mesmo cronograma, nunca um cronograma diferente.
  // Cada faixa é uma troca, inclusive a primeira (base → faixa 1); aqui
  // maxSwaps já é >= 2, então sempre cabe pelo menos uma faixa.
  const maxBands = opts.maxSwaps
  for (let c = 0; c < candidates - usados; c++) {
    // A base sai do PRNG, não do contador: derivada de `c` junto com `k` ela
    // vira função determinística do número de faixas — com 2 bases e maxBands
    // par (maxSwaps par, o caso comum), metade das combinações base×faixas
    // nunca era avaliada e a base escura perdia todo plano de duas faixas.
    const base = bases[Math.floor(rand() * bases.length)]
    // Estratifica o número de faixas em vez de sortear, para nenhuma contagem
    // ficar sem amostra com orçamento pequeno. Medido: em erro final dá empate
    // com sortear ou fixar k — fica pelo determinismo, não por ganho provado.
    const k = 1 + (c % maxBands)
    const bands: Band[] = []
    for (let j = 0; j < k; j++) {
      bands.push({
        filament: filaments[Math.floor(rand() * filaments.length)],
        // Quadrático: puxa para faixas curtas (a maioria das trocas boas é
        // rasa) sem perder as profundas, que uniforme em 1..6 nunca alcançava.
        len: 1 + Math.floor(rand() ** 2 * MAX_BAND_LEN),
      })
    }
    avalia(base, bands)
  }

  if (!best) throw new Error('busca não produziu nenhum cronograma')
  return best
}
