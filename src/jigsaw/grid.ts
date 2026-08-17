import type { Point, Ring } from '../geom/types.ts'
import { dedupeRing } from '../geom/types.ts'

export interface GridSpec {
  /** Largura da placa em mm. */
  width: number
  /** Altura da placa em mm. */
  height: number
  cols: number
  rows: number
  /** Semente para o sorteio das abas. Mesma semente = mesmo puzzle. */
  seed?: number
}

export interface EdgeContext {
  /** true quando a aresta está na borda da placa (tem que ser reta). */
  border: boolean
  /** Semente determinística desta aresta. */
  seed: number
}

/**
 * Desenha uma aresta da grade como polilinha de `a` até `b`, inclusive.
 * A MESMA polilinha é usada pelas duas peças vizinhas (uma delas invertida),
 * então o encaixe é exato por construção — não por tolerância.
 */
export type EdgeFn = (a: Point, b: Point, ctx: EdgeContext) => Point[]

/** Aresta reta. É o que a borda da placa sempre usa. */
export const straightEdge: EdgeFn = (a, b) => [a, b]

export interface Grid {
  spec: Required<GridSpec>
  /** h[r][c]: aresta horizontal do nó (r,c) ao nó (r,c+1). */
  h: Point[][][]
  /** v[r][c]: aresta vertical do nó (r,c) ao nó (r+1,c). */
  v: Point[][][]
}

/** Hash inteiro estável — dá a cada aresta uma semente própria e reproduzível. */
function edgeSeed(seed: number, kind: number, r: number, c: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0
  for (const n of [kind, r, c]) {
    x = Math.imul(x ^ n, 0x85ebca6b) >>> 0
    x = (x ^ (x >>> 13)) >>> 0
  }
  return x >>> 0
}

export function buildGrid(spec: GridSpec, edgeFn: EdgeFn = straightEdge): Grid {
  const { width, height, cols, rows } = spec
  const seed = spec.seed ?? 1
  if (cols < 1 || rows < 1) throw new Error('grade precisa de pelo menos 1 coluna e 1 linha')

  const node = (r: number, c: number): Point => [(c * width) / cols, (r * height) / rows]

  const h: Point[][][] = []
  for (let r = 0; r <= rows; r++) {
    const line: Point[][] = []
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || r === rows
      const fn = border ? straightEdge : edgeFn
      line.push(fn(node(r, c), node(r, c + 1), { border, seed: edgeSeed(seed, 0, r, c) }))
    }
    h.push(line)
  }

  const v: Point[][][] = []
  for (let r = 0; r < rows; r++) {
    const line: Point[][] = []
    for (let c = 0; c <= cols; c++) {
      const border = c === 0 || c === cols
      const fn = border ? straightEdge : edgeFn
      line.push(fn(node(r, c), node(r + 1, c), { border, seed: edgeSeed(seed, 1, r, c) }))
    }
    v.push(line)
  }

  return { spec: { width, height, cols, rows, seed }, h, v }
}

export interface Piece {
  row: number
  col: number
  /** Contorno anti-horário, sem ponto repetido no fecho. */
  ring: Ring
}

/** Contorno da peça (r,c), montado a partir das quatro arestas compartilhadas. */
export function pieceOutline(grid: Grid, r: number, c: number): Ring {
  const rev = (e: Point[]) => [...e].reverse()
  const ring = [
    ...grid.h[r][c], // baixo, esquerda → direita
    ...grid.v[r][c + 1], // direita, baixo → cima
    ...rev(grid.h[r + 1][c]), // cima, direita → esquerda
    ...rev(grid.v[r][c]), // esquerda, cima → baixo
  ]
  return dedupeRing(ring)
}

export function pieces(grid: Grid): Piece[] {
  const out: Piece[] = []
  for (let r = 0; r < grid.spec.rows; r++) {
    for (let c = 0; c < grid.spec.cols; c++) {
      out.push({ row: r, col: c, ring: pieceOutline(grid, r, c) })
    }
  }
  return out
}

/**
 * Grade que se aproxima de `target` peças mantendo as peças quase quadradas
 * para a proporção dada. É o que faz a grade "se adaptar à foto".
 */
export function gridForAspect(width: number, height: number, target: number): { cols: number; rows: number } {
  const aspect = width / height
  let best = { cols: 1, rows: 1, err: Infinity }
  for (let cols = 1; cols <= target; cols++) {
    const rows = Math.max(1, Math.round(cols / aspect))
    const count = cols * rows
    // erro combinado: quantas peças erramos + quanto a peça foge do quadrado
    const squareness = Math.abs(Math.log((width / cols) / (height / rows)))
    const err = Math.abs(count - target) / target + squareness
    if (err < best.err) best = { cols, rows, err }
  }
  return { cols: best.cols, rows: best.rows }
}
