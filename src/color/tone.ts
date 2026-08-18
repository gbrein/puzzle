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
 * ponytail: só L é remapeado, a-estrela e b-estrela (croma) ficam intactos.
 * Cheguei a escalar a-estrela e b-estrela pela MESMA inclinação (comprimir
 * croma junto com luminância, para uma foto escura-vira-clara não sair com
 * saturação fora de proporção) — a hipótese era recuperar o tom quente da
 * madeira que o experimento do Guilherme perdeu remapeando só L. Medido numa
 * cena sintética com a mesma estrutura (região escura de baixa croma + região
 * quente de croma alta, ver `tone.test.ts`): a escala uniforme piorou os DOIS
 * sinais — erro de croma contra o alvo (6,4 → 14,5 ΔE de croma) e ΔE geral
 * (11,6 → 15,0) — sem melhorar nem a fração do nível mais populoso nem os
 * níveis usados (28,4% / 9 níveis com só L vs. 27,5% / 9 níveis com croma
 * escalada, igual dentro do ruído). A escala uniforme empurra a croma pra
 * fora da proporção original porque a inclinação vem do alcance de L, não do
 * alcance de croma — os dois não têm por que casar. Upgrade, se a perda de
 * croma incomodar de novo: escalar a croma pela própria razão de alcance de
 * croma da paleta (não a de L), ou só comprimir quando o pixel cai fora do
 * envelope de croma que a paleta alcança, em vez de sempre.
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
