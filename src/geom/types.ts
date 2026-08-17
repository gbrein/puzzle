/** Ponto no plano da placa, em milímetros. */
export type Point = readonly [number, number]

/**
 * Anel fechado implicitamente: o último ponto NÃO repete o primeiro.
 * Convenção: anel externo em sentido anti-horário (área positiva).
 */
export type Ring = Point[]

/** Área com furos opcionais. Furos em sentido horário (área negativa). */
export interface Polygon {
  outer: Ring
  holes?: Ring[]
}

/** Área com sinal. Positiva = anti-horário. */
export function signedArea(ring: Ring): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  }
  return a / 2
}

/** Garante o sentido anti-horário sem mutar a entrada. */
export function ensureCCW(ring: Ring): Ring {
  return signedArea(ring) < 0 ? [...ring].reverse() : ring
}

/**
 * Remove pontos consecutivos duplicados (inclusive o fecho, se vier repetido).
 * Necessário porque as arestas da grade compartilham os nós de canto.
 */
export function dedupeRing(ring: Ring, eps = 1e-9): Ring {
  const out: Point[] = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p)
  }
  while (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= eps) out.pop()
    else break
  }
  return out
}
