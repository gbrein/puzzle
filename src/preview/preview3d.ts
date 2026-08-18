import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Mesh } from '../mesh/mesh.ts'
import { toLinear } from '../color/space.ts'
import type { Palette } from '../color/types.ts'

export interface Visualizador3D {
  mostrar(mesh: Mesh, coloracao?: Coloracao): void
  redimensionar(): void
  destruir(): void
}

/**
 * Dados para pintar a malha com a cor que cada ponto vai ter impresso.
 *
 * No modelo de camadas monótonas a cor de um ponto depende SÓ da altura dele,
 * então o z do vértice já carrega a cor: `indice = round((z - baseZ) /
 * layerHeight)`, e a cor é `palette[indice]`. O índice 0 é a própria cor da
 * base, então todo o corpo da peça abaixo de `baseZ` cai certo sem tratamento
 * especial — visto de cima, o 3D reproduz exatamente o preview 2D.
 */
export interface Coloracao {
  /** A cor por nível de altura, índice 0 = cor da base. */
  palette: Palette
  /** Topo da base em mm: `plan.baseLayers * plan.layerHeight`. */
  baseZ: number
  /** Altura de camada em mm. */
  layerHeight: number
}

/**
 * Cena three.js para inspecionar a malha antes de imprimir.
 *
 * `destruir` libera geometria, material, controles e o renderer — sem isso,
 * trocar de resultado vaza GPU a cada geração. Chame-o ao substituir o preview.
 */
export function criarVisualizador3D(container: HTMLElement): Visualizador3D {
  const cena = new THREE.Scene()
  cena.background = new THREE.Color(0x14161a)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  // Luz calibrada para a cor de vértice chegar FIEL no topo (a vista de quem
  // julga), não estourada: o MeshStandardMaterial com color branco multiplica a
  // cor do vértice pela iluminação, e um ambiente forte (0,8) + direcional
  // forte (1,4) somariam >1 na face do topo e lavariam tudo para o branco.
  // Com a luz apontando de (1, 1.2, 0.8), a face do topo recebe
  //   ambiente 0,6 + direcional 0,55·(1,2/|L|) ≈ 0,6 + 0,38 = 0,98 ≈ 1,0
  // — o topo mostra a cor quase como está no preview 2D, e as faces inclinadas
  // escurecem só o bastante para dar forma.
  //
  // ponytail: a luz é calibrada a olho para a vista de julgamento (o topo), não
  // é uma exposição fisicamente correta — num material PBR de verdade a soma
  // ambiente+direcional deveria sair do mesmo ponto da exposição da câmera.
  // Upgrade: expor a intensidade (ou usar renderer.toneMapping + exposure) como
  // knob de interface se um dia a fidelidade da cor em ângulos baixos importar.
  const luzAmbiente = new THREE.AmbientLight(0xffffff, 0.6)
  cena.add(luzAmbiente)
  const luzDirecional = new THREE.DirectionalLight(0xffffff, 0.55)
  luzDirecional.position.set(1, 1.2, 0.8)
  cena.add(luzDirecional)

  const controles = new OrbitControls(camera, renderer.domElement)
  controles.enableDamping = true
  controles.dampingFactor = 0.08

  let geometria: THREE.BufferGeometry | null = null
  let material: THREE.MeshStandardMaterial | null = null
  let grupo: THREE.Group | null = null

  const redimensionar = () => {
    const largura = container.clientWidth || 1
    const altura = container.clientHeight || 1
    camera.aspect = largura / altura
    camera.updateProjectionMatrix()
    renderer.setSize(largura, altura)
  }

  const aoRedimensionarJanela = () => redimensionar()
  window.addEventListener('resize', aoRedimensionarJanela)

  const limparCena = () => {
    if (grupo) cena.remove(grupo)
    geometria?.dispose()
    material?.dispose()
    grupo = null
    geometria = null
    material = null
  }

  const mostrar = (mesh: Mesh, coloracao?: Coloracao) => {
    limparCena()
    if (mesh.indices.length === 0) return

    const colorido = coloracao !== undefined

    // positions/indices já são Float32Array/Uint32Array indexados — o
    // BufferGeometry guarda a referência sem copiar nem converter.
    geometria = new THREE.BufferGeometry()
    geometria.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometria.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    if (coloracao) {
      geometria.setAttribute('color', new THREE.BufferAttribute(coresDaMalha(mesh, coloracao), 3))
    }
    geometria.computeVertexNormals()

    material = new THREE.MeshStandardMaterial({
      // com vertexColors o color branco multiplica a cor do vértice por 1
      color: colorido ? 0xffffff : 0xe8e8e8,
      roughness: 0.55,
      metalness: 0.05,
      vertexColors: colorido,
    })
    const objeto = new THREE.Mesh(geometria, material)
    grupo = new THREE.Group()
    grupo.add(objeto)
    cena.add(grupo)

    // enquadra a câmera no bounding box da malha
    geometria.computeBoundingBox()
    const caixa = geometria.boundingBox
    if (!caixa) return
    const centro = caixa.getCenter(new THREE.Vector3())
    const tamanho = caixa.getSize(new THREE.Vector3())
    const raio = Math.max(tamanho.x, tamanho.y, tamanho.z) / 2

    camera.position.set(centro.x + raio * 2, centro.y + raio * 1.6, centro.z + raio * 2.2)
    camera.near = Math.max(0.01, raio / 100)
    camera.far = raio * 20
    camera.updateProjectionMatrix()
    controles.target.copy(centro)
    controles.update()
    redimensionar()
  }

  let quadro = 0
  const animar = () => {
    quadro = requestAnimationFrame(animar)
    controles.update()
    renderer.render(cena, camera)
  }

  const destruir = () => {
    cancelAnimationFrame(quadro)
    window.removeEventListener('resize', aoRedimensionarJanela)
    limparCena()
    controles.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  animar()
  return { mostrar, redimensionar, destruir }
}

/**
 * Cor por vértice a partir do z, com a regra do núcleo: a cor de um ponto
 * depende só da altura dele. O índice 0 é a própria cor da base — todo o corpo
 * da peça abaixo de `baseZ` cai no índice 0 sem tratamento especial.
 *
 * **A cor vai para o three em espaço LINEAR.** A paleta está em sRGB e o three
 * interpreta o BufferAttribute 'color' como linear (o color management do r152+
 * converte o `material.color` de hex, mas NÃO converte cor de vértice) — jogar
 * 0..255/255 direto deixaria a peça lavada e clara demais. `toLinear` faz essa
 * conversão e já existe em `src/color/space.ts`.
 */
const coresDaMalha = (mesh: Mesh, c: Coloracao): Float32Array => {
  const { palette, baseZ, layerHeight } = c
  const n = mesh.positions.length
  const cores = new Float32Array(n)
  if (palette.length === 0) return cores
  for (let i = 0; i < n; i += 3) {
    const nivel = Math.round((mesh.positions[i + 2] - baseZ) / layerHeight)
    const indice = Math.max(0, Math.min(palette.length - 1, nivel))
    const [r, g, b] = toLinear(palette[indice])
    cores[i] = r
    cores[i + 1] = g
    cores[i + 2] = b
  }
  return cores
}