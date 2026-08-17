import type { Point } from '../geom/types.ts'
import { rng } from '../rand.ts'
import type { EdgeFn } from './grid.ts'

export interface TabOptions {
  /**
   * Meia-base da aba, em fração do comprimento da aresta. A cabeça estufa
   * ~2.5× isso para fora. Default 0.1 (aba clássica de quebra-cabeça).
   * Faixa aceita: (0, 0.14] — ver TAB_MAX.
   */
  tabSize?: number
  /**
   * Bagunça dos pontos de controle, em fração do comprimento. Default 0.04.
   * Faixa aceita: [0, tabSize], com tabSize + jitter <= 0.16 — ver REACH_MAX.
   */
  jitter?: number
  /** Pontos amostrados por bezier — são 3 beziers por aresta. Default 16. */
  samples?: number
}

/** Teto de `tabSize` sozinho. Medido: 0.15 já parte peça em célula 40×30. */
const TAB_MAX = 0.14
/**
 * Teto de `tabSize + jitter`. As abas das duas arestas que se encontram num
 * canto da peça apontam para dentro dela e crescem uma na direção da outra; o
 * jitter empurra as duas mais um tanto. Passando de 0.16 elas se tocam e a peça
 * sai partida (o `shrinkByKerf` é só quem descobre depois).
 */
const REACH_MAX = 0.16

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
 * // ponytail: como `w` escala pelo comprimento da aresta e não pela dimensão
 * // transversal da peça, os tetos acima só valem para células até ~1.6:1
 * // (medido com os defaults e kerf 0.3: aspecto 1.6 → 0/3200 peças partidas,
 * // 1.8 → 55/3600, 2.0 → 468/4000). `gridForAspect` nunca passa de 1.33, mas
 * // `buildGrid` aceita cols/rows arbitrários. Upgrade: levar o tamanho
 * // transversal da célula no EdgeContext e escalar `w` por ele.
 */
export function tabEdge(opts: TabOptions = {}): EdgeFn {
  const t = opts.tabSize ?? 0.1
  const j = opts.jitter ?? 0.04
  const samples = opts.samples ?? 16

  if (!(t > 0) || t > TAB_MAX) {
    throw new Error(
      `tabSize ${t} fora de (0, ${TAB_MAX}] — acima disso a cabeça da aba alcança a aba da aresta vizinha da mesma peça e o contorno se fecha sobre si`,
    )
  }
  if (!(j >= 0) || j > t) throw new Error(`jitter ${j} fora de [0, tabSize=${t}]`)
  if (t + j > REACH_MAX) {
    throw new Error(
      `tabSize ${t} + jitter ${j} passa de ${REACH_MAX} — o sorteio joga a cabeça da aba por cima da aba vizinha e parte a peça`,
    )
  }
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
