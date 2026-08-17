import type { HeightMap } from '../color/types.ts'
import { emptyMesh, type Mesh } from './mesh.ts'

export interface ReliefOptions {
  /** mm por célula do mapa. */
  cellSize: number
  originX?: number
  originY?: number
  /** Topo da base: onde o relevo começa. */
  z0: number
  layerHeight: number
  /** Opcional, mesmo tamanho do mapa; 0 = célula fora da peça. */
  mask?: Uint8Array
}

/**
 * Mapa de alturas → sólido fechado apoiado em z0.
 *
 * Três famílias de face, todas com aresta elementar (um lado de célula, ou uma
 * camada de altura), o que faz a malha fechar sem T-junction:
 *
 * - **fundo**: UM plano em z0 sobre toda a pegada (altura > 0). A pegada é
 *   fundida em retângulos maximais e cada retângulo vira um leque a partir do
 *   centro, com o contorno subdividido em cada passo de célula. Custo
 *   O(perímetro) em vez de O(área) — era daqui que vinham 2 triângulos por
 *   célula, o segundo maior desperdício da malha.
 * - **topo**: mesma fusão, uma vez por nível de altura. Numa imagem sem dither
 *   os níveis são regiões grandes e isso derruba a contagem; com dither as
 *   regiões são salpicadas e o topo volta a custar ~2 por célula — é o piso
 *   teórico de um campo de altura que muda a cada célula.
 * - **paredes**: um quad por célula e por camada de diferença. Fundir parede
 *   não paga: como ela tem uma célula de largura, a subdivisão obrigatória do
 *   contorno custa tanto quanto os quads que ela economizaria. Medido: 97% dos
 *   degraus vizinhos são de 0 ou 1 camada.
 *
 * ponytail: como a parede é por célula, o contorno das faces tem que ser
 * subdividido célula a célula, e um bloco perfeitamente uniforme custa
 * O(perímetro) em vez dos 12 triângulos de uma caixa. Na entrada de produção
 * isso é 0,02 triângulo por célula — só vale mexer (fundindo parede em 2D no
 * plano (corrida, camada) e propagando os pontos de quebra) se algum dia a
 * malha de uma foto lisa passar a dominar.
 *
 * Convenção de eixo: a linha 0 do mapa é o TOPO da foto (igual ao ImageData),
 * e no plano da placa Y cresce para cima — por isso a leitura é espelhada em
 * `(h-1-j)`. Sem isso a foto sai de cabeça para baixo.
 */
export function heightMapToMesh(hm: HeightMap, opts: ReliefOptions): Mesh {
  const w = hm.width
  const h = hm.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0)
    throw new Error('mapa de alturas precisa de largura e altura inteiras positivas')
  if (hm.data.length !== w * h)
    throw new Error(`mapa de alturas tem ${hm.data.length} células, esperado ${w * h}`)
  if (opts.mask && opts.mask.length !== w * h)
    throw new Error(`máscara tem ${opts.mask.length} células, esperado ${w * h}`)
  if (!(opts.cellSize > 0)) throw new Error('cellSize tem que ser positivo')
  if (!(opts.layerHeight > 0)) throw new Error('layerHeight tem que ser positivo')

  const cs = opts.cellSize
  const lh = opts.layerHeight
  const z0 = opts.z0
  const ox = opts.originX ?? 0
  const oy = opts.originY ?? 0

  // altura efetiva já espelhada em Y e já com a máscara aplicada
  const mask = opts.mask
  const H = new Uint8Array(w * h)
  let maxH = 0
  for (let j = 0; j < h; j++) {
    const src = (h - 1 - j) * w
    for (let i = 0; i < w; i++) {
      const v = mask && !mask[src + i] ? 0 : hm.data[src + i]
      H[j * w + i] = v
      if (v > maxH) maxH = v
    }
  }
  if (maxH === 0) return emptyMesh() // altura 0 não vira geometria de espessura zero

  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : H[j * w + i])

  const positions: number[] = []
  const indices: number[] = []
  const tri = (a: number, b: number, c: number) => indices.push(a, b, c)

  // O vértice do reticulado é função de (i, j, nível): a tabela abaixo é só a
  // renumeração para índice compacto, sem Map nem chave de string.
  // ponytail: a tabela é O(w·h·níveis) — 12MB transientes numa placa de 180mm
  // com 16 níveis, 190MB se um dia forem 255. Nesse caso, trocar por uma tabela
  // por nível, alocada sob demanda.
  const nx = w + 1
  const ny = h + 1
  const slot = new Int32Array(nx * ny * (maxH + 1)).fill(-1)
  const vid = (i: number, j: number, n: number): number => {
    const s = (n * ny + j) * nx + i
    let v = slot[s]
    if (v < 0) {
      v = positions.length / 3
      slot[s] = v
      positions.push(ox + i * cs, oy + j * cs, z0 + n * lh)
    }
    return v
  }

  /** Fusão 2D gulosa: varre a máscara e devolve retângulos maximais disjuntos. */
  const greedy = (
    keep: (i: number, j: number) => boolean,
    emit: (i0: number, j0: number, i1: number, j1: number) => void,
  ) => {
    const used = new Uint8Array(w * h)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (used[j * w + i] || !keep(i, j)) continue
        let i1 = i + 1
        while (i1 < w && !used[j * w + i1] && keep(i1, j)) i1++
        let j1 = j + 1
        while (j1 < h) {
          let ok = true
          for (let k = i; k < i1 && ok; k++) ok = !used[j1 * w + k] && keep(k, j1)
          if (!ok) break
          j1++
        }
        for (let b = j; b < j1; b++) used.fill(1, b * w + i, b * w + i1)
        emit(i, j, i1, j1)
      }
    }
  }

  /** Face horizontal do retângulo [i0,i1)×[j0,j1) no nível n. `up`: normal +Z. */
  const face = (i0: number, j0: number, i1: number, j1: number, n: number, up: boolean) => {
    const bw = i1 - i0
    const bh = j1 - j0
    if (bw + bh >= bw * bh) {
      // retângulo pequeno: o leque custaria mais que dois triângulos por célula
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const a = vid(i, j, n)
          const b = vid(i + 1, j, n)
          const c = vid(i + 1, j + 1, n)
          const d = vid(i, j + 1, n)
          if (up) {
            tri(a, b, c)
            tri(a, c, d)
          } else {
            tri(a, c, b)
            tri(a, d, c)
          }
        }
      return
    }
    // contorno anti-horário subdividido em cada passo de célula: assim ele casa
    // exatamente com as paredes e com os retângulos vizinhos
    const ring: number[] = []
    for (let i = i0; i < i1; i++) ring.push(vid(i, j0, n))
    for (let j = j0; j < j1; j++) ring.push(vid(i1, j, n))
    for (let i = i1; i > i0; i--) ring.push(vid(i, j1, n))
    for (let j = j1; j > j0; j--) ring.push(vid(i0, j, n))
    // leque a partir do centro (vértice interior, usado só por este leque):
    // nenhum triângulo degenerado, e os raios se cancelam aos pares
    const c = positions.length / 3
    positions.push(ox + ((i0 + i1) / 2) * cs, oy + ((j0 + j1) / 2) * cs, z0 + n * lh)
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k]
      const b = ring[(k + 1) % ring.length]
      if (up) tri(c, a, b)
      else tri(c, b, a)
    }
  }

  // fundo: um plano só sobre toda a pegada
  greedy(
    (i, j) => H[j * w + i] > 0,
    (i0, j0, i1, j1) => face(i0, j0, i1, j1, 0, false),
  )

  // topo: um plano por nível de altura
  for (let n = 1; n <= maxH; n++) {
    greedy(
      (i, j) => H[j * w + i] === n,
      (i0, j0, i1, j1) => face(i0, j0, i1, j1, n, true),
    )
  }

  // paredes: só onde o vizinho é mais baixo, uma camada por vez
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const hb = H[j * w + i]
      if (hb === 0) continue
      for (let k = at(i + 1, j); k < hb; k++) {
        // +X
        tri(vid(i + 1, j, k), vid(i + 1, j + 1, k), vid(i + 1, j + 1, k + 1))
        tri(vid(i + 1, j, k), vid(i + 1, j + 1, k + 1), vid(i + 1, j, k + 1))
      }
      for (let k = at(i - 1, j); k < hb; k++) {
        // -X
        tri(vid(i, j, k), vid(i, j, k + 1), vid(i, j + 1, k + 1))
        tri(vid(i, j, k), vid(i, j + 1, k + 1), vid(i, j + 1, k))
      }
      for (let k = at(i, j + 1); k < hb; k++) {
        // +Y
        tri(vid(i, j + 1, k), vid(i, j + 1, k + 1), vid(i + 1, j + 1, k + 1))
        tri(vid(i, j + 1, k), vid(i + 1, j + 1, k + 1), vid(i + 1, j + 1, k))
      }
      for (let k = at(i, j - 1); k < hb; k++) {
        // -Y
        tri(vid(i, j, k), vid(i + 1, j, k), vid(i + 1, j, k + 1))
        tri(vid(i, j, k), vid(i + 1, j, k + 1), vid(i, j, k + 1))
      }
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
