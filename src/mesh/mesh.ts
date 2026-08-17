/**
 * Malha triangular **indexada**.
 *
 * - `positions`: 3 floats por vértice (x, y, z), em mm. Float32 dá ~15nm de
 *   resolução em 250mm — folgado para uma impressora, e custa metade de um
 *   double. Uma malha não-indexada de 1.2M de triângulos em `number[]` passava
 *   de 700MB de RSS; o alvo é uma aba de navegador.
 * - `indices`: 3 uint32 por triângulo, na ordem da regra da mão direita
 *   (a → b → c anti-horário visto de fora ⇒ normal para fora).
 *
 * Invariante que o resto do sistema assume: **posições iguais compartilham o
 * mesmo índice**. `findOpenEdges` conta arestas por par de índices, então dois
 * vértices coincidentes com índices diferentes contam como malha aberta.
 * O `MeshBuilder` garante isso deduplicando; o mesher de relevo garante
 * calculando o índice a partir de (i, j, nível).
 */
export interface Mesh {
  positions: Float32Array
  indices: Uint32Array
}

export const emptyMesh = (): Mesh => ({ positions: new Float32Array(0), indices: new Uint32Array(0) })

export const triangleCount = (m: Mesh): number => m.indices.length / 3

/** Bytes que a malha ocupa de fato — é o número que decide se roda no browser. */
export const meshBytes = (m: Mesh): number => m.positions.byteLength + m.indices.byteLength

/**
 * Construtor incremental com dedupe por coordenada. A chave é string, então
 * use só em malhas pequenas (uma peça, um prisma); para o reticulado do relevo
 * o índice sai de uma conta, não de um Map.
 */
export class MeshBuilder {
  #pos: number[] = []
  #idx: number[] = []
  #seen = new Map<string, number>()

  /** Devolve o índice do vértice, criando-o se for novo. */
  vertex(x: number, y: number, z: number): number {
    // arredonda para float32 ANTES de comparar: dois doubles distintos que
    // colapsam no mesmo float32 têm que virar o mesmo vértice, senão a malha
    // fica com esquina duplicada e "aberta".
    const fx = Math.fround(x)
    const fy = Math.fround(y)
    const fz = Math.fround(z)
    const k = `${fx},${fy},${fz}`
    let i = this.#seen.get(k)
    if (i === undefined) {
      i = this.#pos.length / 3
      this.#seen.set(k, i)
      this.#pos.push(fx, fy, fz)
    }
    return i
  }

  tri(a: number, b: number, c: number): void {
    this.#idx.push(a, b, c)
  }

  build(): Mesh {
    return { positions: Float32Array.from(this.#pos), indices: Uint32Array.from(this.#idx) }
  }
}

/** Move a malha inteira. Usado pra posicionar peça por peça na placa. */
export function translate(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const p = new Float32Array(m.positions.length)
  for (let i = 0; i < p.length; i += 3) {
    p[i] = m.positions[i] + dx
    p[i + 1] = m.positions[i + 1] + dy
    p[i + 2] = m.positions[i + 2] + dz
  }
  return { positions: p, indices: m.indices }
}

/** Junta malhas deslocando os índices. Não deduplica entre malhas — cada uma continua um sólido. */
export function concat(meshes: Mesh[]): Mesh {
  let np = 0
  let ni = 0
  for (const m of meshes) {
    np += m.positions.length
    ni += m.indices.length
  }
  const positions = new Float32Array(np)
  const indices = new Uint32Array(ni)
  let po = 0
  let io = 0
  for (const m of meshes) {
    positions.set(m.positions, po)
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + po / 3
    po += m.positions.length
    io += m.indices.length
  }
  return { positions, indices }
}

/**
 * Uma malha é fechada quando cada aresta dirigida aparece exatamente uma vez
 * e sua oposta também. Com malha indexada isso é exato: a comparação é por
 * índice, sem épsilon de quantização.
 */
export function findOpenEdges(m: Mesh): number {
  const n = m.positions.length / 3
  // a chave é a*n+b; acima disso ela deixaria de ser um inteiro exato
  if (n > 94_906_265) throw new Error('malha grande demais para a chave de aresta')
  const count = new Map<number, number>()
  const bump = (a: number, b: number) => {
    const k = a < b ? a * n + b : b * n + a
    const v = (count.get(k) ?? 0) + (a < b ? 1 : -1)
    if (v === 0) count.delete(k)
    else count.set(k, v)
  }
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t]
    const b = m.indices[t + 1]
    const c = m.indices[t + 2]
    bump(a, b)
    bump(b, c)
    bump(c, a)
  }
  return count.size
}

/**
 * Volume assinado pelo teorema da divergência. Positivo = normais para fora.
 *
 * É a única asserção que pega inversão de winding: contagem de triângulos,
 * caixa envolvente e arestas abertas são todas invariantes a inverter a malha
 * inteira. Comparar com o volume analítico pega, de quebra, face faltando
 * (volume menor) e face sobreposta (volume maior).
 */
export function signedVolume(m: Mesh): number {
  const p = m.positions
  let v = 0
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3
    const b = m.indices[t + 1] * 3
    const c = m.indices[t + 2] * 3
    const ax = p[a]
    const ay = p[a + 1]
    const az = p[a + 2]
    const bx = p[b]
    const by = p[b + 1]
    const bz = p[b + 2]
    const cx = p[c]
    const cy = p[c + 1]
    const cz = p[c + 2]
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return v / 6
}
