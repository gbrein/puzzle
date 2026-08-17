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
import { resolveColor } from '../color/resolve.ts'
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
  /** Tem que ser o mesmo que a geração vai usar, senão o cronograma difere. */
  seed: number
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
    // A MESMA função que o `generatePuzzle` usa — é isso que garante que a
    // prévia não mostre uma cor e a impressão produza outra. As dimensões da
    // placa saem do tamanho e do aspecto da foto, igual ao `buildPuzzle`.
    const aspect = p.image.width / p.image.height
    const { preview } = resolveColor(p.image, p.filaments, {
      width: aspect >= 1 ? p.size : p.size * aspect,
      height: aspect >= 1 ? p.size / aspect : p.size,
      cellSize: p.extrusionWidth,
      layerHeight: p.layerHeight,
      baseLayers: Math.max(1, Math.round(p.baseThickness / p.layerHeight)),
      layers: p.layers,
      maxSwaps: p.maxSwaps,
      dither: p.dither,
      seed: p.seed,
    })

    postar({ tipo: 'resultado', id: p.id, preview }, [preview.data.buffer])
  } catch (err) {
    postar({ tipo: 'erro', id: p.id, mensagem: err instanceof Error ? err.message : String(err) })
  }
}