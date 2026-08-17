/**
 * mulberry32: PRNG determinístico e barato.
 *
 * Determinismo não é preciosismo aqui — é requisito de produto. A mesma foto
 * com a mesma semente tem que gerar o mesmo puzzle, senão a pessoa que
 * reimprime uma peça perdida recebe uma peça que não encaixa.
 */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
