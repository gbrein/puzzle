import type { Point } from '../geom/types.ts'
import type { EdgeFn } from './grid.ts'

export interface TabOptions {
  /**
   * Meia-base da aba, em fração do comprimento da aresta. A cabeça estufa
   * ~2.5× isso para fora. Default 0.1 (aba clássica de quebra-cabeça).
   */
  tabSize?: number
  /** Bagunça dos pontos de controle, em fração do comprimento. Default 0.04. */
  jitter?: number
  /** Pontos amostrados por bezier — são 3 beziers por aresta. Default 16. */
  samples?: number
}

/** mulberry32: PRNG determinístico e barato. Mesma semente ⇒ mesma sequência. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Aresta interna como aba clássica (pescoço + cabeça), amostrada em polilinha.
 *
 * A geometria é a de github.com/Draradech/jigsaw, em coordenadas normalizadas:
 * `l` corre de 0 a 1 ao longo da aresta e `w` mede o desvio perpendicular. São
 * três beziers cúbicas — ombro→pescoço, cabeça, pescoço→ombro — e os pontos de
 * controle do meio cruzam para trás em `l`, o que cria o undercut que prende a
 * peça. Aqui `w` também escala pelo comprimento da aresta (o original usava a
 * dimensão transversal da peça), então a aba cresce junto com a peça.
 *
 * // ponytail: cada aresta sorteia sozinha a partir de ctx.seed, então a
 * // tangente não é contínua ao cruzar um nó da grade (o original encadeia
 * // `a = -e` da aresta anterior). Some um "e anterior" ao EdgeContext se o
 * // bico no nó incomodar visualmente — não afeta o encaixe.
 */
export function tabEdge(opts: TabOptions = {}): EdgeFn {
  const t = opts.tabSize ?? 0.1
  const j = opts.jitter ?? 0.04
  const samples = opts.samples ?? 16

  if (!(t > 0) || t > 0.2) {
    throw new Error('tabSize precisa estar em (0, 0.2] — fração do comprimento da aresta')
  }
  if (!(j >= 0) || j > t) throw new Error('jitter precisa estar em [0, tabSize]')
  if (!Number.isInteger(samples) || samples < 2) throw new Error('samples precisa ser inteiro >= 2')

  return (a, b, ctx) => {
    if (ctx.border) return [a, b]

    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if (len === 0) throw new Error('aresta degenerada: a e b coincidem')

    const rand = rng(ctx.seed)
    const u = (lo: number, hi: number) => lo + rand() * (hi - lo)
    // A ordem de consumo do PRNG é parte do contrato de determinismo.
    const flip = rand() > 0.5 ? 1 : -1
    const ja = u(-j, j)
    const jb = u(-j, j)
    const jc = u(-j, j)
    const jd = u(-j, j)
    const je = u(-j, j)

    const ctrl: [number, number][] = [
      [0.0, 0.0],
      [0.2, ja],
      [0.5 + jb + jd, -t + jc],
      [0.5 - t + jb, t + jc],
      [0.5 - 2 * t + jb - jd, 3 * t + jc],
      [0.5 + 2 * t + jb - jd, 3 * t + jc],
      [0.5 + t + jb, t + jc],
      [0.5 + jb + jd, -t + jc],
      [0.8, je],
      [1.0, 0.0],
    ]

    // (l, w) → plano. Afim, então dá na mesma avaliar a bezier antes de mapear.
    const ux = dx / len
    const uy = dy / len
    const side = flip * len
    const at = (l: number, w: number): Point => [
      a[0] + ux * l * len - uy * w * side,
      a[1] + uy * l * len + ux * w * side,
    ]

    const pts: Point[] = [a]
    for (let k = 0; k < 3; k++) {
      const [q0, q1, q2, q3] = ctrl.slice(k * 3, k * 3 + 4)
      for (let i = 1; i <= samples; i++) {
        const s = i / samples
        const m = 1 - s
        const c0 = m * m * m
        const c1 = 3 * m * m * s
        const c2 = 3 * m * s * s
        const c3 = s * s * s
        pts.push(
          at(
            c0 * q0[0] + c1 * q1[0] + c2 * q2[0] + c3 * q3[0],
            c0 * q0[1] + c1 * q1[1] + c2 * q2[1] + c3 * q3[1],
          ),
        )
      }
    }
    // O encaixe depende dos extremos baterem exatamente com os nós da grade.
    pts[pts.length - 1] = b
    return pts
  }
}
