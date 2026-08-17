import type { PuzzlePiece } from '../puzzle.ts'
import type { Ring } from '../geom/types.ts'
import { concat, translate, type Mesh } from '../mesh/mesh.ts'

export interface PlateOptions {
  /** Largura útil da mesa, em mm. Default: mesa do Bambu X1C. */
  bedWidth?: number
  /** Altura útil da mesa, em mm. Default: mesa do Bambu X1C. */
  bedHeight?: number
  /** Espaço mínimo entre peças e até a borda da mesa, em mm. */
  spacing?: number
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface PlacedPiece {
  row: number
  col: number
  /** Índice da placa, começando em 0. */
  plate: number
  /** Deslocamento aplicado ao `ring`/`mesh` originais da peça para chegar nesta posição. */
  dx: number
  dy: number
  /** Caixa envolvente final na mesa, já com o deslocamento aplicado. */
  bbox: BBox
}

export interface PlateResult {
  /** Uma malha por placa, com as peças já transladadas para a posição final na mesa. */
  plates: Mesh[]
  /** Peça original (mesma ordem de `pieces`) → placa e posição — o mapa de montagem. */
  placement: PlacedPiece[]
}

function ringBBox(ring: Ring): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of ring) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Distribui as peças em placas por bin packing simples (shelf packing): varre
 * as peças na ordem de entrada empilhando em linhas; quando uma linha não cabe
 * mais na largura da mesa, começa a próxima linha, e quando a altura da mesa
 * também acaba, abre outra placa.
 *
 * ponytail: shelf packing não é o bin packing mais denso (não roda peças, não
 * reordena por área) — mas peça de puzzle já é quase quadrada, então o
 * desperdício é pequeno. Trocar por um packer guloso só vale a pena se sobrar
 * muita mesa vazia na prática.
 */
export function layoutPlates(pieces: PuzzlePiece[], opts: PlateOptions = {}): PlateResult {
  const bedWidth = opts.bedWidth ?? 256
  const bedHeight = opts.bedHeight ?? 256
  const spacing = opts.spacing ?? 5
  if (pieces.length === 0) return { plates: [], placement: [] }

  const plateMeshes: Mesh[][] = [[]]
  const placement: PlacedPiece[] = []

  let plate = 0
  let x = spacing
  let y = spacing
  let rowHeight = 0

  for (const piece of pieces) {
    const box = ringBBox(piece.ring)
    const w = box.maxX - box.minX
    const h = box.maxY - box.minY
    if (w + 2 * spacing > bedWidth || h + 2 * spacing > bedHeight) {
      throw new Error(
        `peça (${piece.row},${piece.col}) de ${w.toFixed(1)}×${h.toFixed(1)}mm não cabe na mesa de ${bedWidth}×${bedHeight}mm`,
      )
    }

    if (x + w + spacing > bedWidth) {
      x = spacing
      y += rowHeight + spacing
      rowHeight = 0
    }
    if (y + h + spacing > bedHeight) {
      plate++
      plateMeshes.push([])
      x = spacing
      y = spacing
      rowHeight = 0
    }

    const dx = x - box.minX
    const dy = y - box.minY
    plateMeshes[plate].push(translate(piece.mesh, dx, dy, 0))
    placement.push({
      row: piece.row,
      col: piece.col,
      plate,
      dx,
      dy,
      bbox: { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy },
    })

    x += w + spacing
    rowHeight = Math.max(rowHeight, h)
  }

  return { plates: plateMeshes.map(concat), placement }
}
