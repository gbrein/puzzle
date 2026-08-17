import type { Ring } from './geom/types.ts'
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

export interface PuzzlePiece {
  row: number
  col: number
  /**
   * Contorno anti-horário JÁ com a folga aplicada, em mm no sistema da placa.
   * É o mesmo anel que gerou a malha — quem for rasterizar a máscara de altura
   * da peça tem que usar este, não o da grade, senão a máscara vaza pela folga.
   */
  ring: Ring
  /** Prisma da peça: malha indexada e fechada. */
  mesh: Mesh
}

export interface PuzzleResult {
  /** Todas as peças em uma malha só — atalho para o STL. */
  mesh: Mesh
  pieces: PuzzlePiece[]
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

  const out = pieces(grid).map((p) => {
    const ring = shrinkByKerf(p.ring, kerf)
    return { row: p.row, col: p.col, ring, mesh: extrudePolygon(ring, 0, thickness) }
  })

  return { mesh: concat(out.map((p) => p.mesh)), pieces: out, cols, rows, width, height }
}
