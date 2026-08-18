import { buildPalette } from './beer-lambert.ts'
import { ditherToPalette } from './dither.ts'
import { searchSchedule } from './schedule.ts'
import { renderHeightMap, solveHeights } from './solver.ts'
import { toneMap, type ToneMapOptions } from './tone.ts'
import { resizeBitmap } from '../image/resize.ts'
import type { Bitmap, Filament, HeightMap, LayerPlan, Palette } from './types.ts'

/**
 * O caminho de cor, em um lugar só.
 *
 * Existe porque ele tem **dois consumidores**: a geração completa
 * (`generatePuzzle`) e o preview 2D ao vivo da interface. Enquanto eram duas
 * cópias, a prévia podia divergir em silêncio do que sai impresso — bastava
 * alguém mudar um default aqui e esquecer da outra ponta. Prévia que mostra
 * uma cor e imprime outra é pior que prévia nenhuma, então a única defesa que
 * funciona é não existir segunda cópia.
 *
 * Custo medido numa grade de 428×285 (placa de 180mm): `searchSchedule` 621 ms,
 * `buildPalette` 0 ms, `solveHeights` + `renderHeightMap` 7 ms. É o que faz o
 * preview de cor caber num debounce e a geometria não.
 */
export interface ResolveOptions {
  /** Largura da placa em mm — a grade de células sai daqui. */
  width: number
  /** Altura da placa em mm. */
  height: number
  /** mm por célula do relevo. */
  cellSize: number
  layerHeight: number
  baseLayers: number
  layers: number
  maxSwaps: number
  dither: boolean
  seed: number
  /** 'auto' (default): remapeia a foto pro que os filamentos alcançam. 'off' desliga. */
  toneMap?: ToneMapOptions['mode']
}

export interface ResolveResult {
  plan: LayerPlan
  palette: Palette
  heightMap: HeightMap
  /** Como a placa vai ficar impressa — cabe direto num ImageData. */
  preview: Bitmap
  /** A foto reamostrada e com o tone map aplicado — é contra ela que o ΔE se mede. */
  target: Bitmap
  cols: number
  rows: number
}

export function resolveColor(image: Bitmap, filaments: Filament[], o: ResolveOptions): ResolveResult {
  const cols = Math.max(1, Math.round(o.width / o.cellSize))
  const rows = Math.max(1, Math.round(o.height / o.cellSize))

  // Reamostrar ANTES de ditherizar. O padrão de Floyd-Steinberg só faz sentido
  // na resolução em que vai ser impresso; ditherizar em 4000px e reduzir depois
  // mistura os pixels de volta e joga fora o trabalho.
  //
  // O tone map roda AQUI, uma vez, antes da busca de cronograma e antes do
  // casamento final — nunca dentro do laço da busca. Ele só depende do
  // catálogo de filamentos escolhido (não do cronograma candidato), então
  // recalcular por candidato seria trabalho jogado fora: converter pra Lab e
  // voltar é barato uma vez, caro milhares de vezes.
  const alvo = toneMap(resizeBitmap(image, cols, rows), filaments, { mode: o.toneMap })

  const plan = searchSchedule(alvo, filaments, {
    layerHeight: o.layerHeight,
    baseLayers: o.baseLayers,
    layers: o.layers,
    maxSwaps: o.maxSwaps,
    seed: o.seed,
  })
  const palette = buildPalette(plan)
  const heightMap = o.dither ? ditherToPalette(alvo, palette) : solveHeights(alvo, palette)
  const preview = renderHeightMap(heightMap, palette)

  return { plan, palette, heightMap, preview, target: alvo, cols, rows }
}
