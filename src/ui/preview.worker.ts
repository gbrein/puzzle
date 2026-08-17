/**
 * Worker do preview 2D ao vivo.
 *
 * Roda só o caminho de cor do `generatePuzzle` — resize + searchSchedule +
 * paleta + alturas + render — sem geometria nem `.3mf`. É por isso que o
 * preview custa ~7 ms (mais os ~621 ms do schedule quando filamentos/camadas/
 * base mudam) e não 2 s: o worker vive em `src/ui/` porque o contrato da
 * rodada não libera `src/worker/**` (que só gera a placa inteira) — e mexer no
 * núcleo é proibido, então o caminho de cor é reproduzido aqui com as mesmas
 * funções que o `generatePuzzle` usa.
 */
import { buildPalette } from '../color/beer-lambert.ts'
import { ditherToPalette } from '../color/dither.ts'
import { searchSchedule } from '../color/schedule.ts'
import { renderHeightMap, solveHeights } from '../color/solver.ts'
import { resizeBitmap } from '../image/resize.ts'
import type { Bitmap, Filament } from '../color/types.ts'

/** O que a thread principal pede. `image` e `filaments` vão por structured clone. */
export interface PedidoPreview {
  tipo: 'preview'
  id: number
  image: Bitmap
  filaments: Filament[]
  size: number
  layers: number
  layerHeight: number
  baseThickness: number
  maxSwaps: number
  dither: boolean
  extrusionWidth: number
}

export interface ResultadoPreview {
  tipo: 'resultado'
  id: number
  /** A cor resolvida — cabe direto num ImageData. */
  preview: Bitmap
}

export interface ErroPreview {
  tipo: 'erro'
  id: number
  mensagem: string
}

export type RespostaPreview = ResultadoPreview | ErroPreview

// Mesmo cast do gerar.worker.ts: o `self` da lib DOM tipa postMessage como o do
// Window (targetOrigin no 2º argumento) — aqui o contrato é o do worker.
const postar = (mensagem: RespostaPreview, transferíveis?: Transferable[]) => {
  ;(self as unknown as { postMessage(m: RespostaPreview, t?: Transferable[]): void }).postMessage(
    mensagem,
    transferíveis,
  )
}

self.onmessage = (e: MessageEvent<PedidoPreview>) => {
  const p = e.data
  if (p.tipo !== 'preview') return
  try {
    // Espelha o caminho de cor do generatePuzzle: a célula do relevo é a
    // largura de extrusão, e a grade vem de size + aspecto da foto.
    const cellSize = p.extrusionWidth
    const aspect = p.image.width / p.image.height
    const largura = aspect >= 1 ? p.size : p.size * aspect
    const altura = aspect >= 1 ? p.size / aspect : p.size
    const cols = Math.max(1, Math.round(largura / cellSize))
    const rows = Math.max(1, Math.round(altura / cellSize))

    const alvo = resizeBitmap(p.image, cols, rows)
    const baseLayers = Math.max(1, Math.round(p.baseThickness / p.layerHeight))
    const plan = searchSchedule(alvo, p.filaments, {
      layerHeight: p.layerHeight,
      baseLayers,
      layers: p.layers,
      maxSwaps: p.maxSwaps,
    })
    const palette = buildPalette(plan)
    const hm = p.dither ? ditherToPalette(alvo, palette) : solveHeights(alvo, palette)
    const preview = renderHeightMap(hm, palette)

    postar({ tipo: 'resultado', id: p.id, preview }, [preview.data.buffer])
  } catch (err) {
    postar({ tipo: 'erro', id: p.id, mensagem: err instanceof Error ? err.message : String(err) })
  }
}