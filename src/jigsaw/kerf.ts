import ClipperLib from 'clipper-lib'
import type { Point, Ring } from '../geom/types.ts'
import { dedupeRing, ensureCCW, signedArea } from '../geom/types.ts'

/** Clipper trabalha em inteiros. 1e4 dá resolução de 0.1µm — muito além da impressora. */
const SCALE = 1e4
/** Erro máximo na aproximação dos arcos: 2µm. */
const ARC_TOLERANCE = 0.002 * SCALE

/**
 * Afasta (delta > 0) ou encolhe (delta < 0) o anel por uma distância CONSTANTE
 * em toda a borda. Junta arredondada porque as abas do encaixe são curvas —
 * miter criaria bicos nos cantos côncavos do pescoço da aba.
 */
export function offsetRing(ring: Ring, delta: number): Ring[] {
  if (delta === 0) return [ring]
  const path = ensureCCW(ring).map(([x, y]) => ({
    X: Math.round(x * SCALE),
    Y: Math.round(y * SCALE),
  }))

  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE)
  co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)

  const solution = new ClipperLib.Paths()
  co.Execute(solution, delta * SCALE)

  return solution.map((p) =>
    ensureCCW(dedupeRing(p.map((pt) => [pt.X / SCALE, pt.Y / SCALE] as Point))),
  )
}

/**
 * Encolhe a peça pela metade da folga em cada lado, para que duas vizinhas
 * fiquem separadas por exatamente `kerf`.
 *
 * Erro explícito quando o pescoço da aba é mais fino que a folga: nesse caso o
 * offset parte a peça em pedaços, e devolver o maior deles calado geraria um
 * puzzle com peças mutiladas.
 */
export function shrinkByKerf(ring: Ring, kerf: number): Ring {
  if (kerf <= 0) return ring
  const parts = offsetRing(ring, -kerf / 2)
    .filter((p) => p.length >= 3)
    .sort((a, b) => signedArea(b) - signedArea(a))

  if (parts.length === 0 || signedArea(parts[0]) <= 0) {
    throw new Error(`folga de ${kerf}mm consome a peça inteira — use peças maiores ou folga menor`)
  }
  if (parts.length > 1 && signedArea(parts[1]) > 0.01 * signedArea(parts[0])) {
    throw new Error(
      `folga de ${kerf}mm parte a peça em ${parts.length} pedaços (pescoço da aba fino demais)`,
    )
  }
  return parts[0]
}

/** Centroide de área — usado pelo layout de placas. */
export function centroid(ring: Ring): Point {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += cross
    cx += (ring[j][0] + ring[i][0]) * cross
    cy += (ring[j][1] + ring[i][1]) * cross
  }
  a /= 2
  if (Math.abs(a) < 1e-12) {
    const n = ring.length
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (6 * a), cy / (6 * a)]
}
