import { planToProject } from './color/project.ts'
import { resolveColor } from './color/resolve.ts'
import { imageError } from './color/solver.ts'
import { deltaE, rgbToLab } from './color/space.ts'
import type { Bitmap, Filament, LayerPlan, Palette } from './color/types.ts'
import { totalHeight } from './color/types.ts'
import { writeProject3MF } from './export/threemf.ts'
import { toBinarySTL } from './export/stl.ts'
import { layoutPlates, type PlacedPiece } from './jigsaw/plates.ts'
import { pieceMask } from './jigsaw/mask.ts'
import { tabEdge } from './jigsaw/tabs.ts'
import { buildFrame } from './mesh/frame.ts'
import { heightMapToMesh } from './mesh/heightmap.ts'
import { concat, meshBytes, signedVolume, translate, triangleCount, type Mesh } from './mesh/mesh.ts'
import { buildPuzzle } from './puzzle.ts'

/** PLA: densidade típica usada pra converter volume em massa estimada. */
const PLA_G_POR_CM3 = 1.24

/**
 * As cores são ESCOLHA DE QUEM USA, não inferência nossa.
 *
 * A plataforma mostra um seletor: quantas cores e quais. O catálogo de
 * filamentos existe só para pré-preencher o TD; quem tiver um rolo fora da
 * lista digita o hex e o TD medido. `searchSchedule` não escolhe *quais*
 * filamentos — ela só decide em que ordem e em que alturas os escolhidos entram.
 */
export interface GenerateOptions {
  /** A foto, já decodificada. No browser vem de `createImageBitmap` + canvas. */
  image: Bitmap
  /** As cores selecionadas por quem está usando a plataforma. */
  filaments: Filament[]

  /** Maior dimensão da placa em mm. */
  size?: number
  pieceCount?: number
  /** Folga entre peças. Depende de impressora e filamento — calibre imprimindo. */
  kerf?: number
  seed?: number

  /** Camadas de cor acima da base. Mais camadas = mais tons, print mais alto. */
  layers?: number
  layerHeight?: number
  /** Espessura da peça abaixo da cor, em mm. Vira um número inteiro de camadas. */
  baseThickness?: number
  /** Trocas de filamento permitidas, contando base → primeira cor. */
  maxSwaps?: number
  /**
   * Difusão de erro (Floyd-Steinberg). **Desligado por default**, e o motivo é
   * medição, não gosto.
   *
   * Difusão de erro só ajuda quando a cor alvo está dentro do que a paleta
   * alcança. Uma pilha de filamentos produz uma paleta que é uma CURVA no
   * espaço de cor, não um volume — então a cor de uma foto que cai fora dessa
   * curva gera erro que nenhuma altura corrige, e a difusão o transforma em
   * ruído visível. Medido (ΔE borrado, liso → dither):
   *   rampa preto→branco, foto em tons de cinza .... 2,33 → 1,27  (ganha muito)
   *   rampa preto→verm→amarelo, foto quente ........ 55,6 → 51,3  (ganha)
   *   rampa preto→branco, foto azul/verde .......... 34,3 → 35,3  (perde)
   * E custa ~2,3× mais triângulos em todos os casos.
   *
   * Ligue quando a foto estiver dentro da gama dos filamentos escolhidos —
   * `stats.paletteSpan` é o indicador que a interface pode usar pra sugerir.
   */
  dither?: boolean

  /**
   * Largura de extrusão do bico, em mm. É o piso físico da resolução: uma
   * feature mais estreita que isso o slicer não imprime, ela some ou vira blob.
   */
  extrusionWidth?: number
  /** mm por célula do relevo. Default = largura de extrusão. */
  cellSize?: number

  swapMode?: 'manual' | 'ams'
  printerModel?: string

  /** Inclui a moldura com pé de 30° como objeto extra, na própria placa. */
  frame?: boolean
  /** Mesa útil, em mm. Default 256×256 (X1C). */
  bedWidth?: number
  bedHeight?: number
}

export interface GenerateResult {
  threemf: Uint8Array
  /** Reserva: se o projeto não abrir na máquina de alguém, ainda dá pra imprimir. */
  stl: Uint8Array
  /** Instruções de troca em texto puro, o último recurso. */
  swaps: string
  plan: LayerPlan
  palette: Palette
  /** Como a placa vai ficar impressa — para o preview 2D. */
  preview: Bitmap
  /** A malha final concatenada — para o preview 3D. Use direto, sem parsear o STL de volta. */
  mesh: Mesh
  /** Peça original → placa e posição na mesa. Mesma ordem de `puzzle.pieces` (não inclui a moldura). */
  placement: PlacedPiece[]
  stats: {
    cols: number
    rows: number
    pieces: number
    width: number
    height: number
    cells: string
    triangles: number
    meshMB: number
    swaps: number
    deltaE: number
    totalHeightMm: number
    /**
     * ΔE entre os extremos da paleta: o quanto as cores escolhidas conseguem
     * se afastar da base com a espessura pedida. Abaixo de ~40 a paleta é uma
     * rampa curta e a foto sai enlameada por mais camadas que se peça — é o
     * número que a interface usa pra avisar "aumente as camadas ou escolha
     * cores mais contrastantes", em vez de deixar a pessoa descobrir imprimindo.
     */
    paletteSpan: number
    /** Quantas placas a impressão vai precisar (peças + moldura, se pedida). */
    plates: number
    /** Massa estimada de filamento, em gramas: volume × 1,24 g/cm³ (PLA). */
    grams: number
  }
}

/** Foto → quebra-cabeça colorido pronto para fatiar. */
export function generatePuzzle(opts: GenerateOptions): GenerateResult {
  const {
    image,
    filaments,
    size = 180,
    pieceCount = 20,
    kerf = 0.4,
    seed = 1,
    // Defaults escolhidos por medição, não por gosto: o que decide se a cor
    // acontece é a ESPESSURA TOTAL de cor contra o TD dos filamentos. Com TD
    // típico de 1 a 6mm, uma camada de 0,16mm transmite ~95% do que está
    // embaixo; 12 camadas de 0,08mm (0,96mm) mal saem da cor da base e a paleta
    // vira uma rampa curta e enlameada. 25 × 0,16 = 4mm de cor foi onde o erro
    // parou de cair na medição (ΔE 17,5 → 11,6, estável a partir daí).
    layers = 25,
    layerHeight = 0.16,
    baseThickness = 2.4,
    maxSwaps = 3,
    dither = false,
    extrusionWidth = 0.42,
    swapMode = 'manual',
    printerModel,
  } = opts
  const cellSize = opts.cellSize ?? extrusionWidth

  if (!filaments?.length) throw new Error('escolha pelo menos uma cor de filamento')
  if (!(size > 0)) throw new Error('size tem que ser positivo')
  if (!Number.isInteger(pieceCount) || pieceCount < 1) throw new Error('pieceCount tem que ser inteiro >= 1')
  if (!Number.isInteger(layers) || layers < 1) throw new Error('layers tem que ser inteiro >= 1')
  if (!(layerHeight > 0)) throw new Error('layerHeight tem que ser positivo')
  if (!(baseThickness > 0)) throw new Error('baseThickness tem que ser positivo')
  if (!(image?.width > 0) || !(image?.height > 0)) throw new Error('imagem vazia')
  if (cellSize < extrusionWidth) {
    // não é preciosismo: célula menor que o filete extrudado gera feature que a
    // impressora não consegue materializar, e o relevo sai borrado ou com blob
    throw new Error(
      `cellSize ${cellSize}mm é menor que a largura de extrusão ${extrusionWidth}mm — ` +
        `a impressora não resolve essa feature`,
    )
  }

  // A base do quebra-cabeça É a base opaca do modelo de cor: um número só.
  // Aceitar espessura e contagem de camadas como entradas independentes é o
  // caminho mais curto para as cores saírem deslocadas na peça impressa.
  const baseLayers = Math.max(1, Math.round(baseThickness / layerHeight))
  const baseZ = baseLayers * layerHeight

  const aspect = image.width / image.height
  const puzzle = buildPuzzle({
    size,
    aspect,
    pieceCount,
    thickness: baseZ,
    kerf,
    seed,
    edgeFn: tabEdge(),
  })

  // O caminho de cor mora em `color/resolve.ts` porque o preview ao vivo da
  // interface roda exatamente ele — duas cópias divergiriam em silêncio, e a
  // prévia passaria a mostrar uma cor diferente da que sai impressa.
  const {
    plan,
    palette,
    heightMap: hm,
    preview,
    target: alvo,
    cols,
    rows,
  } = resolveColor(image, filaments, {
    width: puzzle.width,
    height: puzzle.height,
    cellSize,
    layerHeight,
    baseLayers,
    layers,
    maxSwaps,
    dither,
    seed,
  })

  const objetos = puzzle.pieces.map((p) => {
    const mask = pieceMask(p.ring, { width: cols, height: rows }, cellSize)
    // Dois sólidos sobrepostos no plano z = baseZ — a base com a borda bezier
    // exata e o relevo em blocos alinhados à grade. Cada um fecha sozinho e o
    // slicer os une; casar a borda curva com a grade de células custaria muito
    // mais e não muda nada no que sai da impressora.
    const relevo = mask.some((v) => v)
      ? heightMapToMesh(hm, { cellSize, z0: baseZ, layerHeight, mask })
      : null
    return {
      name: `peca-${p.row}-${p.col}`,
      mesh: relevo ? concat([p.mesh, relevo]) : p.mesh,
    }
  })
  // `mesh` continua sendo a placa MONTADA (sem empacotar em mesas separadas) —
  // é a foto inteira, o que faz sentido pro preview 3D e pro STL de reserva.
  // ponytail: o STL de reserva não reflete o auto plate split (pode passar da
  // mesa se a placa for maior que ela); o .3mf multi-placa abaixo é quem sai
  // pronto pra fatiar peça por peça. Se algum dia o STL precisar ser
  // igualmente fatiável, gere um por placa a partir de `layout.plates`.
  const mesh = concat(objetos.map((o) => o.mesh))

  const { filaments: slots, colorChanges } = planToProject(plan)

  // Auto plate split: cada peça sai posicionada na sua mesa (`layout.placement`
  // está na MESMA ordem de `puzzle.pieces`/`objetos` — layoutPlates recebe os
  // dois emparelhados e devolve o índice de placa e o deslocamento de cada um).
  const layout = layoutPlates(
    puzzle.pieces.map((p, i) => ({ row: p.row, col: p.col, ring: p.ring, mesh: objetos[i].mesh })),
    { bedWidth: opts.bedWidth, bedHeight: opts.bedHeight },
  )
  const objetosPorPlaca: { name: string; mesh: Mesh }[][] = layout.plates.map(() => [])
  layout.placement.forEach((p, i) => {
    objetosPorPlaca[p.plate].push({ name: objetos[i].name, mesh: translate(objetos[i].mesh, p.dx, p.dy, 0) })
  })

  let frameMesh: Mesh | null = null
  if (opts.frame) {
    frameMesh = buildFrame({ plateWidth: puzzle.width, plateHeight: puzzle.height })
    const bed = { w: opts.bedWidth ?? 256, h: opts.bedHeight ?? 256 }
    const bbox = bboxXY(frameMesh)
    const w = bbox.maxX - bbox.minX
    const h = bbox.maxY - bbox.minY
    if (w > bed.w || h > bed.h) {
      // ponytail: a moldura é um objeto só, sem auto-split — se não couber
      // numa mesa, a saída é reduzir borderWidth/plateWidth ou usar mesa maior.
      throw new Error(`moldura de ${w.toFixed(1)}×${h.toFixed(1)}mm não cabe na mesa de ${bed.w}×${bed.h}mm`)
    }
    frameMesh = translate(frameMesh, -bbox.minX, -bbox.minY, 0)
    objetosPorPlaca.push([{ name: 'moldura', mesh: frameMesh }])
  }

  const threemf = writeProject3MF({
    // as placas de peça repetem o MESMO cronograma de trocas (é a pilha de
    // camadas que decide a cor, não a placa); a moldura, sem relevo, não troca.
    plates: objetosPorPlaca.map((objects, i) => ({
      objects,
      colorChanges: opts.frame && i === objetosPorPlaca.length - 1 ? [] : colorChanges,
    })),
    filaments: slots,
    layerHeight,
    // `heightOf` mede em passos uniformes de layerHeight a partir de zero, e o
    // writer valida topZ contra `first + k*layer`. Se a primeira camada tiver
    // altura diferente, nenhuma troca cai num topo real e o slicer arredonda
    // cada uma para a camada vizinha — cores deslocadas na peça impressa.
    firstLayerHeight: layerHeight,
    swapMode,
    printerModel,
  })

  const gramas =
    ((objetos.reduce((s, o) => s + signedVolume(o.mesh), 0) + (frameMesh ? signedVolume(frameMesh) : 0)) / 1000) *
    PLA_G_POR_CM3

  return {
    threemf,
    stl: toBinarySTL(mesh, 'puzzle'),
    swaps: descreveTrocas(plan, colorChanges),
    plan,
    palette,
    preview,
    mesh,
    placement: layout.placement,
    stats: {
      cols: puzzle.cols,
      rows: puzzle.rows,
      pieces: puzzle.pieces.length,
      width: puzzle.width,
      height: puzzle.height,
      cells: `${cols}×${rows}`,
      triangles: triangleCount(mesh),
      meshMB: meshBytes(mesh) / 1e6,
      swaps: colorChanges.length,
      deltaE: imageError(alvo, preview),
      totalHeightMm: totalHeight(plan),
      paletteSpan: extensaoDaPaleta(palette),
      plates: objetosPorPlaca.length,
      grams: gramas,
    },
  }
}

/** Caixa envolvente em XY — usada só para posicionar a moldura na mesa. */
function bboxXY(m: Mesh): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i]
    const y = m.positions[i + 1]
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Maior distância entre DUAS entradas quaisquer da paleta.
 *
 * Comparar só a primeira com a última mede errado: um cronograma que termina no
 * mesmo filamento da base (coisa que a busca escolhe quando compensa) fecha o
 * ciclo e devolve ~0, mesmo tendo passado longe no meio. A paleta tem no máximo
 * 256 entradas, então o par a par é irrelevante perto do resto da pipeline.
 */
function extensaoDaPaleta(palette: Palette): number {
  const labs = palette.map(rgbToLab)
  let max = 0
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE(labs[i], labs[j])
      if (d > max) max = d
    }
  }
  return max
}

/** Rede de segurança: se o .3mf não abrir, isto ainda dá para seguir à mão. */
function descreveTrocas(plan: LayerPlan, changes: { topZ: number; color: string }[]): string {
  const linhas = [
    `Puzzle — ${changes.length} troca(s) de filamento`,
    `Altura de camada: ${plan.layerHeight}mm · base: ${plan.baseLayers} camadas (${(plan.baseLayers * plan.layerHeight).toFixed(2)}mm)`,
    `Comece com: ${plan.base.name} (${plan.base.hex})`,
    '',
  ]
  for (const c of changes) {
    linhas.push(`Em Z = ${c.topZ.toFixed(2)}mm — troque para ${c.color}`)
  }
  return linhas.join('\n')
}
