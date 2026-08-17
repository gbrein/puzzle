import { triangleCount, type Mesh } from '../mesh/mesh.ts'

/** STL binário. Roda igual no Node e no browser — só produz bytes. */
export function toBinarySTL(mesh: Mesh, header = 'puzzle'): Uint8Array {
  const n = triangleCount(mesh)
  const buf = new ArrayBuffer(84 + n * 50)
  const view = new DataView(buf)

  const head = new TextEncoder().encode(header.slice(0, 79))
  new Uint8Array(buf, 0, 80).set(head)
  view.setUint32(80, n, true)

  // o STL é não-indexado: aqui os índices são expandidos de volta em vértices
  const p = mesh.positions
  const ix = mesh.indices
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50
    const a = ix[t * 3] * 3
    const b = ix[t * 3 + 1] * 3
    const c = ix[t * 3 + 2] * 3
    const ux = p[b] - p[a]
    const uy = p[b + 1] - p[a + 1]
    const uz = p[b + 2] - p[a + 2]
    const wx = p[c] - p[a]
    const wy = p[c + 1] - p[a + 1]
    const wz = p[c + 2] - p[a + 2]
    let nx = uy * wz - uz * wy
    let ny = uz * wx - ux * wz
    let nz = ux * wy - uy * wx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len

    view.setFloat32(o, nx, true)
    view.setFloat32(o + 4, ny, true)
    view.setFloat32(o + 8, nz, true)
    view.setFloat32(o + 12, p[a], true)
    view.setFloat32(o + 16, p[a + 1], true)
    view.setFloat32(o + 20, p[a + 2], true)
    view.setFloat32(o + 24, p[b], true)
    view.setFloat32(o + 28, p[b + 1], true)
    view.setFloat32(o + 32, p[b + 2], true)
    view.setFloat32(o + 36, p[c], true)
    view.setFloat32(o + 40, p[c + 1], true)
    view.setFloat32(o + 44, p[c + 2], true)
    view.setUint16(o + 48, 0, true)
  }

  return new Uint8Array(buf)
}
