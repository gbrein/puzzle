import earcut from 'earcut'
import type { Ring } from '../geom/types.ts'
import { extrudePolygon } from './extrude.ts'
import { concat, MeshBuilder, type Mesh } from './mesh.ts'

export interface FrameOptions {
  /** Largura do quebra-cabeça montado (a placa inteira), em mm. */
  plateWidth: number
  /** Altura do quebra-cabeça montado, em mm. */
  plateHeight: number
  /** Largura do aro da moldura, em mm. */
  borderWidth?: number
  /** Espessura total da moldura (aro + pé), em mm. */
  thickness?: number
  /** Profundidade do rebaixo onde a placa assenta, em mm — tipicamente a espessura da placa. */
  recessDepth?: number
  /** Folga entre a placa e a abertura da moldura, por lado, em mm. */
  clearance?: number
  /** Ângulo do pé em relação à mesa (0 = deitado, 90 = de pé), em graus. */
  footAngle?: number
}

/**
 * Prisma retangular com um furo retangular centrado, sólido de z0 a z1.
 * Duas instâncias empilhadas em Z (furo grande embaixo, furo menor em cima)
 * formam o rebaixo: a placa entra pelo furo grande e assenta na borda que
 * sobra sob o furo pequeno.
 *
 * earcut já sabe triangular polígono com furo (índice do furo no array
 * plano). As paredes usam o mesmo truque de `extrudePolygon`: percorrer um
 * anel anti-horário gera normal para fora. O furo já é fornecido em sentido
 * horário (convenção de `Polygon`), então percorrê-lo com a mesma fórmula já
 * aponta pra dentro do furo — sem precisar inverter nada.
 */
function frameWithHole(outerW: number, outerH: number, holeW: number, holeH: number, z0: number, z1: number): Mesh {
  const ox = (outerW - holeW) / 2
  const oy = (outerH - holeH) / 2
  const outer: Ring = [
    [0, 0],
    [outerW, 0],
    [outerW, outerH],
    [0, outerH],
  ]
  const hole: Ring = [
    [ox, oy],
    [ox, oy + holeH],
    [ox + holeW, oy + holeH],
    [ox + holeW, oy],
  ]

  const flat: number[] = []
  for (const [x, y] of outer) flat.push(x, y)
  for (const [x, y] of hole) flat.push(x, y)
  const idx = earcut(flat, [outer.length])
  if (idx.length === 0) throw new Error('triangulação da moldura falhou')

  const b = new MeshBuilder()
  const lo = [...outer, ...hole].map(([x, y]) => b.vertex(x, y, z0))
  const hi = [...outer, ...hole].map(([x, y]) => b.vertex(x, y, z1))

  for (let i = 0; i < idx.length; i += 3) {
    const [a, c, d] = [idx[i], idx[i + 1], idx[i + 2]]
    b.tri(hi[a], hi[c], hi[d]) // topo, normal +Z
    b.tri(lo[d], lo[c], lo[a]) // fundo, normal -Z
  }

  const wall = (ring: Ring) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      const [ax, ay] = ring[i]
      const [bx, by] = ring[j]
      const loA = b.vertex(ax, ay, z0)
      const loB = b.vertex(bx, by, z0)
      const hiB = b.vertex(bx, by, z1)
      const hiA = b.vertex(ax, ay, z1)
      b.tri(loA, loB, hiB)
      b.tri(loA, hiB, hiA)
    }
  }
  wall(outer)
  wall(hole)

  return b.build()
}

/**
 * Cunha triangular (pé) presa à aresta Y=0 da moldura, estendendo-se para
 * Y negativo e subindo de Z=0 (na ponta) até Z=thickness (encostada na
 * moldura) — um apoio maciço, apoiado na mesa do começo ao fim, nunca em
 * balanço. Reaproveita `extrudePolygon`: ele extrude um anel 2D ao longo de
 * Z, então construímos o triângulo em (Y,Z) e extrudemos ao longo do que
 * viraria "Z" (aqui, X real) — depois só permutamos as coordenadas de volta.
 * A permutação (x,y,z)→(z,x,y) é uma rotação de eixos (determinante +1), não
 * inverte winding nem o sinal do volume.
 */
function buildFoot(thickness: number, footRun: number, x0: number, x1: number): Mesh {
  const ring: Ring = [
    [0, 0],
    [0, thickness],
    [-footRun, 0],
  ]
  const m = extrudePolygon(ring, x0, x1)
  const p = m.positions
  for (let i = 0; i < p.length; i += 3) {
    const y = p[i]
    const z = p[i + 1]
    const x = p[i + 2]
    p[i] = x
    p[i + 1] = y
    p[i + 2] = z
  }
  return m
}

/**
 * Moldura com pé de apoio a 30° (default): um aro com rebaixo onde a placa
 * montada do puzzle assenta, mais um pé triangular maciço que a segura em pé
 * na mesa. Sólido único, fechado, pensado pra imprimir deitado sem suporte —
 * tanto o rebaixo (dois prismas empilhados) quanto o pé (cunha apoiada do
 * começo ao fim) não têm nenhuma face em balanço.
 */
export function buildFrame(opts: FrameOptions): Mesh {
  const { plateWidth, plateHeight } = opts
  if (!(plateWidth > 0) || !(plateHeight > 0)) throw new Error('plateWidth e plateHeight precisam ser positivos')

  const borderWidth = opts.borderWidth ?? 15
  const thickness = opts.thickness ?? 6
  const recessDepth = opts.recessDepth ?? 3
  const clearance = opts.clearance ?? 0.3
  const footAngle = opts.footAngle ?? 30

  if (!(borderWidth > 0)) throw new Error('borderWidth precisa ser positivo')
  if (!(clearance >= 0)) throw new Error('clearance não pode ser negativo')
  if (!(recessDepth > 0) || recessDepth >= thickness)
    throw new Error('recessDepth precisa ser positivo e menor que thickness')
  if (!(footAngle > 0) || !(footAngle < 90)) throw new Error('footAngle precisa estar entre 0 e 90 graus')

  const outerW = plateWidth + 2 * clearance + 2 * borderWidth
  const outerH = plateHeight + 2 * clearance + 2 * borderWidth
  const backHoleW = plateWidth + 2 * clearance
  const backHoleH = plateHeight + 2 * clearance

  // ponytail: o lip (quanto a abertura frontal encolhe em relação à de trás)
  // é metade da largura do aro, fixo — dá uma borda frontal proporcional sem
  // virar um quinto parâmetro exposto. Se algum dia precisar de um lip fino
  // num aro largo (ou vice-versa), exponha-o separado.
  const lip = borderWidth / 2
  const frontHoleW = backHoleW - 2 * lip
  const frontHoleH = backHoleH - 2 * lip
  if (!(frontHoleW > 0) || !(frontHoleH > 0))
    throw new Error('borderWidth grande demais para o rebaixo — a abertura frontal fecharia')

  const back = frameWithHole(outerW, outerH, backHoleW, backHoleH, 0, thickness - recessDepth)
  const front = frameWithHole(outerW, outerH, frontHoleW, frontHoleH, thickness - recessDepth, thickness)

  const footWidth = outerW / 3
  const footRun = thickness / Math.tan((footAngle * Math.PI) / 180)
  const footX0 = (outerW - footWidth) / 2
  const foot = buildFoot(thickness, footRun, footX0, footX0 + footWidth)

  return concat([back, front, foot])
}
