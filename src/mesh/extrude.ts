import earcut from 'earcut'
import type { Ring } from '../geom/types.ts'
import { ensureCCW } from '../geom/types.ts'
import { addTriangle, emptyMesh, type Mesh } from './mesh.ts'

/**
 * Prisma reto: o anel `ring` extrudado de z0 até z1, com tampas fechadas.
 * É a base de tudo — a peça do puzzle é isto mais o relevo em cima.
 */
export function extrudePolygon(ring: Ring, z0: number, z1: number): Mesh {
  const r = ensureCCW(ring)
  if (r.length < 3) throw new Error('anel precisa de pelo menos 3 pontos')
  if (z1 <= z0) throw new Error('z1 tem que ser maior que z0')

  const flat: number[] = []
  for (const [x, y] of r) flat.push(x, y)
  const idx = earcut(flat)
  if (idx.length === 0) throw new Error('triangulação falhou — anel degenerado ou auto-intersectante')

  const m = emptyMesh()
  const at = (i: number, z: number) => [r[i][0], r[i][1], z] as const

  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
    addTriangle(m, at(a, z1), at(b, z1), at(c, z1)) // topo, normal +Z
    addTriangle(m, at(c, z0), at(b, z0), at(a, z0)) // fundo, normal -Z
  }

  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length
    // anel anti-horário ⇒ a normal da parede aponta pra fora
    addTriangle(m, at(i, z0), at(j, z0), at(j, z1))
    addTriangle(m, at(i, z0), at(j, z1), at(i, z1))
  }

  return m
}
