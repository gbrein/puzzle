import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Mesh } from '../mesh/mesh.ts'

export interface Visualizador3D {
  mostrar(mesh: Mesh): void
  redimensionar(): void
  destruir(): void
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

  const luzAmbiente = new THREE.AmbientLight(0xffffff, 0.8)
  cena.add(luzAmbiente)
  const luzDirecional = new THREE.DirectionalLight(0xffffff, 1.4)
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

  const mostrar = (mesh: Mesh) => {
    limparCena()
    if (mesh.indices.length === 0) return

    // positions/indices já são Float32Array/Uint32Array indexados — o
    // BufferGeometry guarda a referência sem copiar nem converter.
    geometria = new THREE.BufferGeometry()
    geometria.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
    geometria.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
    geometria.computeVertexNormals()

    material = new THREE.MeshStandardMaterial({
      color: 0xe8e8e8,
      roughness: 0.55,
      metalness: 0.05,
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