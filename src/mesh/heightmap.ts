import type { HeightMap } from '../color/types.ts'
import { addTriangle, emptyMesh, type Mesh } from './mesh.ts'

export interface ReliefOptions {
  /** mm por célula do mapa. */
  cellSize: number
  originX?: number
  originY?: number
  /** Topo da base: onde o relevo começa. */
  z0: number
  layerHeight: number
  /** Opcional, mesmo tamanho do mapa; 0 = célula fora da peça. */
  mask?: Uint8Array
}

type P = readonly [number, number, number]

/** Retângulo em 2 triângulos. A diagonal a→c aparece duas vezes em sentidos opostos, então se cancela. */
function quad(m: Mesh, a: P, b: P, c: P, d: P): void {
  addTriangle(m, a, b, c)
  addTriangle(m, a, c, d)
}

/**
 * Linhas de corte de um eixo: corta em toda posição onde *alguma* célula da
 * linha/coluna muda de altura.
 *
 * É isto que faz o greedy: sem mudança nenhuma (mapa uniforme) sai um bloco só.
 * O corte é global de propósito — um retângulo que só valesse localmente
 * encostaria no meio da aresta do vizinho e criaria T-junction, que o
 * findOpenEdges (com razão) acusa como malha aberta.
 */
function cuts(n: number, m: number, at: (a: number, b: number) => number): number[] {
  const out = [0]
  for (let a = 1; a < n; a++) {
    for (let b = 0; b < m; b++) {
      if (at(a - 1, b) !== at(a, b)) {
        out.push(a)
        break
      }
    }
  }
  out.push(n)
  return out
}

/**
 * Mapa de alturas → sólido fechado apoiado em z0.
 *
 * Cada bloco do particionamento é uniforme, então vira um retângulo de topo,
 * um de fundo e paredes nas quatro bordas onde o vizinho é mais baixo.
 */
export function heightMapToMesh(hm: HeightMap, opts: ReliefOptions): Mesh {
  const w = hm.width
  const h = hm.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0)
    throw new Error('mapa de alturas precisa de largura e altura inteiras positivas')
  if (hm.data.length !== w * h)
    throw new Error(`mapa de alturas tem ${hm.data.length} células, esperado ${w * h}`)
  if (opts.mask && opts.mask.length !== w * h)
    throw new Error(`máscara tem ${opts.mask.length} células, esperado ${w * h}`)
  if (!(opts.cellSize > 0)) throw new Error('cellSize tem que ser positivo')
  if (!(opts.layerHeight > 0)) throw new Error('layerHeight tem que ser positivo')

  const cs = opts.cellSize
  const lh = opts.layerHeight
  const z0 = opts.z0
  const ox = opts.originX ?? 0
  const oy = opts.originY ?? 0

  const mask = opts.mask
  // altura efetiva: fora da máscara é como se não houvesse relevo
  const H = mask ? Uint8Array.from(hm.data, (v, i) => (mask[i] ? v : 0)) : hm.data
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : H[j * w + i])

  const xs = cuts(w, h, (i, j) => H[j * w + i])
  const ys = cuts(h, w, (j, i) => H[j * w + i])

  const m = emptyMesh()

  for (let bj = 0; bj + 1 < ys.length; bj++) {
    const j0 = ys[bj]
    const j1 = ys[bj + 1]
    for (let bi = 0; bi + 1 < xs.length; bi++) {
      const i0 = xs[bi]
      const i1 = xs[bi + 1]
      const hb = at(i0, j0)
      if (hb === 0) continue // altura 0 não vira geometria de espessura zero

      const X0 = ox + i0 * cs
      const X1 = ox + i1 * cs
      const Y0 = oy + j0 * cs
      const Y1 = oy + j1 * cs
      const zt = z0 + hb * lh

      quad(m, [X0, Y0, zt], [X1, Y0, zt], [X1, Y1, zt], [X0, Y1, zt]) // topo, normal +Z
      quad(m, [X0, Y1, z0], [X1, Y1, z0], [X1, Y0, z0], [X0, Y0, z0]) // fundo, normal -Z

      // Paredes camada a camada. Fundir em z pareceria mais esperto, mas um
      // vizinho na quina com altura intermediária partiria a aresta vertical
      // do retângulo alto e abriria a malha.
      // ponytail: uma parede por camada de diferença; se a contagem de
      // triângulos incomodar, fundir em z partindo nos níveis dos 4 blocos da quina.
      const wall = (hn: number, emit: (za: number, zb: number) => void) => {
        for (let k = hn; k < hb; k++) emit(z0 + k * lh, z0 + (k + 1) * lh)
      }
      wall(at(i1, j0), (za, zb) => quad(m, [X1, Y0, za], [X1, Y1, za], [X1, Y1, zb], [X1, Y0, zb])) // +X
      wall(at(i0 - 1, j0), (za, zb) => quad(m, [X0, Y0, za], [X0, Y0, zb], [X0, Y1, zb], [X0, Y1, za])) // -X
      wall(at(i0, j1), (za, zb) => quad(m, [X0, Y1, za], [X0, Y1, zb], [X1, Y1, zb], [X1, Y1, za])) // +Y
      wall(at(i0, j0 - 1), (za, zb) => quad(m, [X0, Y0, za], [X1, Y0, za], [X1, Y0, zb], [X0, Y0, zb])) // -Y
    }
  }

  return m
}
