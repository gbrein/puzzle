import { buildGrid, gridForAspect, pieces, straightEdge, type EdgeFn } from './jigsaw/grid.ts'
import { shrinkByKerf } from './jigsaw/kerf.ts'
import { extrudePolygon } from './mesh/extrude.ts'
import { concat, type Mesh } from './mesh/mesh.ts'

export interface PuzzleOptions {
  /** Maior dimensão da placa, em mm. A outra sai da proporção. */
  size: number
  /** Proporção largura/altura da foto. */
  aspect: number
  /** Quantidade alvo de peças — a grade se ajusta à proporção. */
  pieceCount: number
  /** Espessura da base, em mm. */
  thickness?: number
  /** Folga entre peças, em mm. Depende de impressora e filamento. */
  kerf?: number
  seed?: number
  /** Como desenhar as arestas internas. Reto no M0; aba bezier no M1. */
  edgeFn?: EdgeFn
}

export interface PuzzleResult {
  mesh: Mesh
  /** Uma malha por peça — o que o 3MF precisa pra tratar cada peça como objeto. */
  pieceMeshes: Mesh[]
  cols: number
  rows: number
  width: number
  height: number
}

export function buildPuzzle(opts: PuzzleOptions): PuzzleResult {
  const { size, aspect, pieceCount } = opts
  const thickness = opts.thickness ?? 3
  const kerf = opts.kerf ?? 0.15

  const width = aspect >= 1 ? size : size * aspect
  const height = aspect >= 1 ? size / aspect : size

  const { cols, rows } = gridForAspect(width, height, pieceCount)
  const grid = buildGrid({ width, height, cols, rows, seed: opts.seed }, opts.edgeFn ?? straightEdge)

  const pieceMeshes = pieces(grid).map((p) =>
    extrudePolygon(shrinkByKerf(p.ring, kerf), 0, thickness),
  )

  return { mesh: concat(pieceMeshes), pieceMeshes, cols, rows, width, height }
}
