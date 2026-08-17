import { triangleCount, type Mesh } from '../mesh/mesh.ts'

/** STL binário. Roda igual no Node e no browser — só produz bytes. */
export function toBinarySTL(mesh: Mesh, header = 'puzzle'): Uint8Array {
  const n = triangleCount(mesh)
  const buf = new ArrayBuffer(84 + n * 50)
  const view = new DataView(buf)

  const head = new TextEncoder().encode(header.slice(0, 79))
  new Uint8Array(buf, 0, 80).set(head)
  view.setUint32(80, n, true)

  const v = mesh.verts
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50
    const i = t * 9
    const ux = v[i + 3] - v[i]
    const uy = v[i + 4] - v[i + 1]
    const uz = v[i + 5] - v[i + 2]
    const wx = v[i + 6] - v[i]
    const wy = v[i + 7] - v[i + 1]
    const wz = v[i + 8] - v[i + 2]
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
    for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, v[i + k], true)
    view.setUint16(o + 48, 0, true)
  }

  return new Uint8Array(buf)
}
