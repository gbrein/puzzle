import earcut, { deviation } from 'earcut'
import type { Ring } from '../geom/types.ts'
import { ensureCCW } from '../geom/types.ts'
import { MeshBuilder, type Mesh } from './mesh.ts'

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
  if (idx.length === 0) throw new Error('triangulação falhou — anel degenerado')

  // earcut não detecta auto-interseção: um bowtie sai calado, com triângulos
  // que não cobrem o anel e a malha aberta. `deviation` compara a área dos
  // triângulos com a área do anel e é o que denuncia isso (Infinity quando a
  // área do anel se cancela, como no bowtie).
  const dev = deviation(flat, null, 2, idx)
  if (!(dev < 1e-6)) throw new Error(`anel auto-intersectante: a triangulação erra a área em ${dev}`)

  const m = new MeshBuilder()
  const lo = r.map(([x, y]) => m.vertex(x, y, z0))
  const hi = r.map(([x, y]) => m.vertex(x, y, z1))

  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]]
    m.tri(hi[a], hi[b], hi[c]) // topo, normal +Z
    m.tri(lo[c], lo[b], lo[a]) // fundo, normal -Z
  }

  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length
    // anel anti-horário ⇒ a normal da parede aponta pra fora
    m.tri(lo[i], lo[j], hi[j])
    m.tri(lo[i], hi[j], hi[i])
  }

  return m.build()
}
