import type { Bitmap, Filament } from './types.ts'
import { fromLinear, labToLinear, linearToLab, parseHex, rgbToLab, type Lab } from './space.ts'
import { LINEAR_LUT, pixelCount } from './solver.ts'

/**
 * Remapeia a foto para o que os filamentos alcançam, ANTES do casamento por
 * vizinho mais próximo.
 *
 * O problema medido (foto real, cachorro preto sobre madeira, contra 4
 * filamentos): 36,4% dos pixels são mais escuros que o filamento mais escuro
 * — `solveHeights` faz casamento ABSOLUTO, então todos colapsam no mesmo
 * nível 0 e a foto vira uma mancha chapada (focinho, peito e pelo somem).
 *
 * Default: os percentis 1 e 99 da foto (em L\*) viram os extremos de L\*
 * alcançáveis pelos filamentos escolhidos — o mesmo remapeamento de
 * luminância que o HueForge faz. 1/99 em vez de min/max porque um pixel
 * isolado de ruído ou reflexo não pode esticar o mapeamento inteiro.
 *
 * ponytail: só L é remapeado, a-estrela e b-estrela (croma) ficam intactos —
 * **duas tentativas de corrigir isso, as duas medidas e as duas rejeitadas.**
 *
 * Tentativa 1 (escala uniforme): escalar a-estrela/b-estrela pela MESMA
 * inclinação do L, comprimindo croma junto com luminância. Medida numa cena
 * sintética (região escura de baixa croma + região quente de croma alta, ver
 * `tone.test.ts`): piorou os DOIS sinais — erro de croma contra o alvo (6,4 →
 * 14,5 ΔE de croma) e ΔE geral (11,6 → 15,0) — sem melhorar nível mais
 * populoso nem níveis usados. A inclinação vem do alcance de L, não do
 * alcance de croma — os dois não têm por que casar.
 *
 * Tentativa 2 (envelope de croma por L, "para cada altura, comprima o croma
 * da foto pro máximo que a paleta alcança ali, preservando o matiz" — a
 * madeira saía acinzentada mesmo com marrom na paleta). Testei exatamente
 * essa proposta: envelope construído dos pontos (L, croma) de cada filamento
 * puro (`rgbToLab` do hex), interpolado linear por L, comprime só quando o
 * pixel excede o teto. Medido contra `public/cachorro.jpg` (madeira, croma
 * moderado) e uma cena sintética de quadrantes saturados (croma alto, o caso
 * que devia provar o conceito) — ΔE sempre contra a foto ORIGINAL (alvo
 * fixo, não o alvo remapeado, pra não cair na armadilha do alvo móvel de
 * novo) e uma métrica de croma (croma médio do resultado ÷ croma médio da
 * foto — não só ΔE, que já mentiu uma vez neste arquivo):
 *
 *   cachorro (preto+marrom+branco):      off 0,50 · L 0,51 · L+croma 0,51
 *   quadrantes saturados (5 filamentos): off 0,56 · L 0,68 · L+croma 0,12(!)
 *
 * A versão ingênua do envelope DESTRÓI a croma no caso saturado (razão 0,12):
 * preto e branco entram no envelope com croma zero por definição, então o
 * teto interpolado desaba pra perto de zero exatamente onde o remapeamento
 * de L concentra mais pixels (perto dos extremos). Tirando os filamentos
 * quase neutros (croma < 5) do envelope, o desastre some (razão 0,64) mas o
 * ganho também — fica ABAIXO do que já fazer nada além do L (0,68). E no
 * cachorro a razão não mexe NADA (0,51 com ou sem croma): a foto já perde
 * metade do croma original SEM tone map nenhum (razão 0,50 no "off") — a
 * perda acontece no casamento por vizinho mais próximo/na composição
 * Beer-Lambert, não na entrada. Um remapeamento que só COMPRIME croma jamais
 * consegue consertar uma perda que já acontece rio abaixo.
 *
 * Upgrade, se a perda de croma incomodar de novo: não é tone map — é
 * `solveHeights`/`scorePlan` ponderarem croma explicitamente no casamento
 * (hoje é distância euclidiana em Lab, L domina por ter faixa maior), ou uma
 * correção de croma DEPOIS da busca, contra a paleta REAL já composta
 * (`buildPalette` do `LayerPlan` escolhido) em vez do envelope grosseiro dos
 * filamentos puros que dá pra montar aqui, antes de existir cronograma.
 */
export interface ToneMapOptions {
  /** 'auto' (default) remapeia; 'off' devolve a foto sem tocar. */
  mode?: 'auto' | 'off'
  /** Percentil da foto que vira o extremo escuro alcançável. Default 1. */
  loPercentile?: number
  /** Percentil da foto que vira o extremo claro alcançável. Default 99. */
  hiPercentile?: number
}

/** L* de cada pixel, calculado uma vez — é sobre isto que os percentis são tirados. */
function luminancias(img: Bitmap): Float64Array {
  const n = pixelCount(img)
  const d = img.data
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    out[i] = linearToLab([LINEAR_LUT[d[p]], LINEAR_LUT[d[p + 1]], LINEAR_LUT[d[p + 2]]])[0]
  }
  return out
}

function percentil(sorted: Float64Array, pct: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))))
  return sorted[i]
}

export function toneMap(img: Bitmap, filaments: Filament[], opts: ToneMapOptions = {}): Bitmap {
  if ((opts.mode ?? 'auto') === 'off') return img
  if (filaments.length === 0) throw new Error('tone map: nenhum filamento disponível')
  const lo = opts.loPercentile ?? 1
  const hi = opts.hiPercentile ?? 99
  if (!(lo >= 0) || !(hi <= 100) || !(lo < hi)) throw new Error(`tone map: percentis inválidos ${lo}..${hi}`)

  const ls = luminancias(img)
  const ordenado = Float64Array.from(ls).sort()
  const imgLo = percentil(ordenado, lo)
  const imgHi = percentil(ordenado, hi)

  const lsFilamentos = filaments.map((f) => rgbToLab(parseHex(f.hex))[0])
  const palLo = Math.min(...lsFilamentos)
  const palHi = Math.max(...lsFilamentos)

  // sem variação de um lado ou do outro não há o que remapear (foto lisa, ou
  // catálogo de uma cor só) — devolve intacta em vez de dividir por ~0
  if (imgHi - imgLo < 1e-6 || palHi - palLo < 1e-6) return img

  const escala = (palHi - palLo) / (imgHi - imgLo)

  const n = pixelCount(img)
  const d = img.data
  const out = new Uint8ClampedArray(d.length)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    const lab = linearToLab([LINEAR_LUT[d[p]], LINEAR_LUT[d[p + 1]], LINEAR_LUT[d[p + 2]]])
    const remapeado: Lab = [Math.max(0, Math.min(100, palLo + (lab[0] - imgLo) * escala)), lab[1], lab[2]]
    const rgb = fromLinear(labToLinear(remapeado))
    out[p] = rgb.r
    out[p + 1] = rgb.g
    out[p + 2] = rgb.b
    out[p + 3] = d[p + 3]
  }
  return { width: img.width, height: img.height, data: out }
}
