/**
 * Contratos do motor de cor. Este arquivo é a fronteira entre os módulos —
 * mude aqui só com intenção, porque geometria, solver e export dependem dele.
 */

/** Cor sRGB, canais 0..255. */
export interface RGB {
  r: number
  g: number
  b: number
}

/** Imagem RGBA. Compatível em forma com o ImageData do canvas. */
export interface Bitmap {
  width: number
  height: number
  /** 4 bytes por pixel, ordem R,G,B,A. */
  data: Uint8ClampedArray
}

/**
 * Filamento. `td` é a *transmission distance* em mm: a espessura na qual
 * o filamento deixa passar ~10% da luz. Escuro ~0.5mm, claro 6mm+.
 */
export interface Filament {
  id: string
  name: string
  /** Cor em hex, ex.: "#0F62FE". */
  hex: string
  td: number
  /** true quando o valor de td é estimativa, não medição. */
  estimated?: boolean
}

/**
 * O plano de impressão: quantas camadas, qual filamento em cada uma.
 * As trocas acontecem em alturas globais, iguais para a placa inteira —
 * é por isso que a cor de um ponto depende só da altura dele.
 */
export interface LayerPlan {
  /** Altura de camada em mm. */
  layerHeight: number
  /** Camadas opacas de fundo, impressas em `base`. */
  baseLayers: number
  /** Filamento do fundo opaco. */
  base: Filament
  /** Um filamento por camada de cor, de baixo para cima. */
  schedule: Filament[]
}

/**
 * Cor vista para cada índice de altura. Comprimento = schedule.length + 1:
 * o índice 0 é "só a base", o índice i é "base + i camadas de cor".
 */
export type Palette = RGB[]

/** Índice de altura por célula: 0..schedule.length. */
export interface HeightMap {
  width: number
  height: number
  data: Uint8Array
}

/** Altura em mm do topo do índice de altura `h`. */
export function heightOf(plan: LayerPlan, h: number): number {
  return (plan.baseLayers + h) * plan.layerHeight
}

/** Espessura total da parte colorida, em mm. */
export function totalHeight(plan: LayerPlan): number {
  return heightOf(plan, plan.schedule.length)
}
