/**
 * Malha triangular não-indexada: cada 9 números em `verts` é um triângulo
 * (x,y,z ×3), com a normal saindo pela regra da mão direita.
 * Não-indexada porque é o que o STL quer; o 3MF dedupa na hora de exportar.
 */
export interface Mesh {
  verts: number[]
}

export const emptyMesh = (): Mesh => ({ verts: [] })

export function addTriangle(
  m: Mesh,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  m.verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
}

export function concat(meshes: Mesh[]): Mesh {
  const out = emptyMesh()
  for (const m of meshes) out.verts.push(...m.verts)
  return out
}

export const triangleCount = (m: Mesh): number => m.verts.length / 9

/** Move a malha inteira. Usado pra posicionar peça por peça na placa. */
export function translate(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const v = m.verts.slice()
  for (let i = 0; i < v.length; i += 3) {
    v[i] += dx
    v[i + 1] += dy
    v[i + 2] += dz
  }
  return { verts: v }
}

/**
 * Uma malha é fechada quando cada aresta dirigida aparece exatamente uma vez
 * e sua oposta também. Se não fecha, o slicer produz lixo — por isso o teste
 * roda em cima de cada peça gerada.
 */
export function findOpenEdges(m: Mesh, eps = 1e-6): number {
  const q = (x: number) => Math.round(x / eps)
  const key = (i: number) => `${q(m.verts[i])},${q(m.verts[i + 1])},${q(m.verts[i + 2])}`
  const count = new Map<string, number>()
  const bump = (a: string, b: string, d: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    count.set(k, (count.get(k) ?? 0) + (a < b ? d : -d))
  }
  for (let t = 0; t < m.verts.length; t += 9) {
    const k = [key(t), key(t + 3), key(t + 6)]
    bump(k[0], k[1], 1)
    bump(k[1], k[2], 1)
    bump(k[2], k[0], 1)
  }
  let open = 0
  for (const n of count.values()) if (n !== 0) open++
  return open
}
