import type { LayerPlan, Palette, RGB } from './types.ts'
import { fromLinear, parseHex, toLinear } from './space.ts'

/**
 * Modelo óptico de camadas translúcidas (Beer-Lambert).
 *
 * A definição de `td` é operacional: na espessura `td` passam 10% da luz.
 * Daí T = 10^(-espessura/td) — em td a exponencial vale exatamente 0.1.
 */

/** Fração da luz que atravessa uma camada de `layerHeight` mm do filamento. */
export function layerTransmission(layerHeight: number, td: number): number {
  if (!(layerHeight >= 0) || !Number.isFinite(layerHeight)) throw new Error(`altura de camada inválida: ${layerHeight}`)
  if (!(td > 0) || !Number.isFinite(td)) throw new Error(`td inválido: ${td}`)
  return 10 ** (-layerHeight / td)
}

/**
 * Cor vista em cada índice de altura. Índice 0 é só a base opaca; o índice i
 * é a base coberta pelas i primeiras camadas do cronograma.
 *
 * A composição roda em RGB linear porque misturar luz na curva sRGB
 * escurece o resultado (branco sobre preto com T=0.5 daria 127 em vez de 188).
 */
export function buildPalette(plan: LayerPlan): Palette {
  const base = parseHex(plan.base.hex)
  let below = toLinear(base)
  const palette: RGB[] = [base]

  for (const filament of plan.schedule) {
    const t = layerTransmission(plan.layerHeight, filament.td)
    const f = toLinear(parseHex(filament.hex))
    // ponytail: um TD por filamento, igual nos três canais. Filamentos reais
    // transmitem diferente por canal; para isso, trocar td por [tdR,tdG,tdB].
    const mixed = [
      f[0] * (1 - t) + below[0] * t,
      f[1] * (1 - t) + below[1] * t,
      f[2] * (1 - t) + below[2] * t,
    ] as const
    palette.push(fromLinear(mixed))
    below = mixed
  }

  return palette
}
