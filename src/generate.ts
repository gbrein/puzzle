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
 * RELEVO E NÚMERO DE CORES SÃO ACOPLADOS — um default fixo de camadas erra
 * num dos dois lados. A definição de TD é literal: em `td` mm de espessura
 * passam 10% da luz. Com N cores dividindo o mesmo relevo, cada faixa fica
 * com relevo/(N-1) de espessura própria — pouco pra filamento de TD alto se
 * N crescer e o relevo não acompanhar junto.
 *
 * Medido pelo Guilherme (foto real, cachorro preto sobre madeira, ΔE final
 * contra a espessura TOTAL do relevo):
 *   3 rolos (preto+marrom+branco, maxSwaps 2):
 *     4,00mm 34,49 · 2,40mm 34,49 · 1,60mm 34,59 · 1,20mm 34,71 · 0,96mm 35,10
 *     — cortar de 4mm pra 1,6mm é DE GRAÇA (Δ 0,10)
 *   5 rolos coloridos, TD 3–7mm (maxSwaps 4):
 *     4,00mm 25,16 · 2,40mm 28,20 · 1,60mm 30,90 · 1,20mm 32,81
 *     — o MESMO corte custa 5,7 de ΔE: degradação real
 *
 * A proposta dele foi 10 camadas por faixa (faixas = filaments.length-1, a
 * base não consome camada de cor). Verifiquei em vez de aceitar de olhos
 * fechados: testei 6/8/10/14/20 camadas por faixa em paletas de 3, 4 e 5
 * cores, mesma foto, busca de verdade (`searchSchedule`, maxSwaps = n-1).
 *
 * 3 e 4 cores CONFIRMAM a proposta — o ganho de ΔE cai a pique depois de
 * ~10–14 camadas/faixa; 4 cores satura EXATAMENTE em 10 (ΔE 5,58 idêntico em
 * 10, 14 e 20 camadas/faixa). 5 cores não deu um resultado limpo: achei que
 * `materialize` (`color/schedule.ts`) preenche o que sobra repetindo o
 * ÚLTIMO filamento da faixa sorteada — então mais camadas TOTAIS nem sempre
 * viram mais espessura pra CADA cor, às vezes só esticam a última faixa
 * sorteada e as outras ficam do mesmo tamanho que teriam com bem menos
 * camadas. É um limite real da busca com `maxSwaps` alto e poucas camadas
 * (confirmei parcialmente: um orçamento de `candidates` maior encontra
 * cronograma melhor, mas não muda essa insensibilidade a mais camadas), não
 * desta escolha de default — ponytail: rodada futura, ou `materialize`
 * distribui o resto proporcionalmente entre faixas, ou o orçamento de busca
 * cresce com `maxSwaps`. Como o achado do Guilherme (mais controlado, à mão)
 * concorda com os casos de 3 e 4 cores que consegui confirmar, fica com
 * 10 camadas por faixa.
 */
const LAYERS_POR_FAIXA = 10

/**
 * Espessura mínima de relevo por faixa pro TD ter onde desenvolver, em mm —
 * abaixo disso o defeito que motivou o acoplamento acima reaparece: cor de
 * TD alto (5–7mm no catálogo) mal tinge. Medido junto com `LAYERS_POR_FAIXA`:
 * em 0,48mm/faixa (6 camadas/faixa a 0,08mm, o mesmo teste acima) o ΔE já
 * perde de forma clara pro ponto de saturação (~0,8mm/faixa) tanto em 3
 * quanto em 4 cores. `GenerateResult.stats.mmPorFaixa` é o número pra
 * interface comparar contra este limiar e avisar ANTES de imprimir.
 * Exportado pra ninguém duplicar o número 0,5 num arquivo de UI separado.
 */
export const MM_MINIMO_UTIL_POR_FAIXA = 0.5

/**
 * As cores são ESCOLHA DE QUEM USA, não inferência nossa — mas dentro dessa
 * escolha, a plataforma decide COMO usá-las.
 *
 * A plataforma mostra um seletor: quantas cores e quais. O catálogo de
 * filamentos existe só para pré-preencher o TD; quem tiver um rolo fora da
 * lista digita o hex e o TD medido. `searchSchedule` nunca inventa uma cor
 * que não foi declarada, mas ELA ESCOLHE, dentro do que foi declarado, quais
 * entram de fato no cronograma — pode ser um subconjunto, se a busca achar
 * que uma cor a mais não ajuda dentro do orçamento de trocas — além da ordem
 * e da altura de cada uma. `maxSwaps` (default: `filaments.length - 1`, o
 * mínimo pra caber toda a seleção) é o orçamento; `usedFilaments` no
 * resultado é o que entrou de verdade. A seleção continua editável a
 * qualquer momento — trocar as cores e gerar de novo é sempre a saída.
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

  /**
   * Camadas de cor acima da base. Mais camadas = mais tons, print mais alto.
   * Default: `Math.max(1, maxSwaps) * LAYERS_POR_FAIXA` (10) — relevo e
   * número de cores são acoplados (cada filamento precisa de espessura pra
   * desenvolver a própria cor), então o default acompanha `maxSwaps` em vez
   * de fixo. Pedir menos que isso pra uma paleta grande é legítimo, mas
   * confira `stats.mmPorFaixa` — abaixo do limiar documentado ali, a cor
   * simplesmente não desenvolve.
   */
  layers?: number
  layerHeight?: number
  /** Espessura da peça abaixo da cor, em mm. Vira um número inteiro de camadas. */
  baseThickness?: number
  /**
   * Trocas de filamento permitidas, contando base → primeira cor. Default:
   * `filaments.length - 1` — o mínimo pra caber TODAS as cores escolhidas.
   * Um valor menor é uma escolha legítima (menos paradas manuais), mas quem
   * pedir menos que `filaments.length - 1` fica com filamento sobrando —
   * confira `usedFilaments` no resultado pra saber quais entraram de fato.
   */
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
   * `auto` (default): remapeia a foto (em L\*) pro que os filamentos
   * alcançam ANTES do casamento de cor — sem isso, uma foto mais escura que
   * o filamento mais escuro colapsa inteira no mesmo nível (medido: 36,4%
   * dos pixels de uma foto real caíam nesse caso, e a paleta usava só um
   * nível). `off` desliga e usa a foto crua. Ver `src/color/tone.ts`.
   */
  toneMap?: 'auto' | 'off'

  /**
   * Largura de extrusão do bico, em mm. É o piso físico da resolução: uma
   * feature mais estreita que isso o slicer não imprime, ela some ou vira blob.
   */
  extrusionWidth?: number
  /** mm por célula do relevo. Default = largura de extrusão. */
  cellSize?: number

  /**
   * `ams` (default, decisão do Guilherme): declara a paleta inteira e cada
   * troca vira `ToolChange` — quem tem AMS não toca em nada.
   *
   * `manual`: numa impressora sem AMS o `ToolChange` é descartado em silêncio
   * pelo slicer se o projeto declarar mais de um filamento, então esse modo
   * força o projeto a UM filamento só e cada troca vira uma pausa — é o único
   * caminho que produz saída útil numa P1S sem AMS. Continua existindo por
   * isso; não é um modo legado.
   */
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
  /**
   * Filamentos que o plano REALMENTE usou, na ordem em que entram (base
   * primeiro). Pode ser um subconjunto de `filaments` (a entrada): `maxSwaps`
   * limita quantas trocas cabem, então com o default 3 no máximo 4 filamentos
   * entram (base + 3 trocas), mesmo que a pessoa tenha escolhido 8 — isso
   * acontecia em silêncio até agora. A interface usa esta lista pra avisar
   * quais das cores escolhidas ficaram de fora.
   */
  usedFilaments: Filament[]
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
    /**
     * Espessura de relevo por faixa de cor, em mm: `(layers × layerHeight) /
     * max(1, maxSwaps)`. Relevo e número de cores são acoplados — abaixo de
     * `MM_MINIMO_UTIL_POR_FAIXA` (0,5mm, medido em `generate.ts`) o TD dos
     * filamentos mal desenvolve e a cor "some" mesmo com a paleta certa. É o
     * número que a interface usa pra avisar "poucas camadas pra tantas
     * cores" ANTES de imprimir, em vez de a pessoa descobrir com a peça na
     * mão.
     */
    mmPorFaixa: number
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
    // Com paleta de n cores, um cronograma que usa todas elas precisa de n-1
    // trocas (a primeira já é base → cor 1). Um default fixo (era 3) capava
    // silenciosamente quem escolhia mais que 4 filamentos: a pessoa marcava 6
    // cores e só 4 entravam na impressão, sem aviso nenhum — `usedFilaments`
    // dizia o que aconteceu DEPOIS, mas o default já tinha decidido por ela.
    // `(filaments?.length ?? 1) - 1`, não `filaments.length - 1`: `filaments`
    // pode chegar `undefined` num caller sem TypeScript, e o guard amigável
    // duas linhas abaixo tem que rodar antes de qualquer coisa explodir aqui.
    maxSwaps = (filaments?.length ?? 1) - 1,
    // Precisa vir DEPOIS de `maxSwaps` na desestruturação: o default lê o
    // valor já resolvido dele (`LAYERS_POR_FAIXA`, ver a medição no topo do
    // arquivo — relevo e número de cores são acoplados, o antigo default fixo
    // de 50 camadas/4mm era 2,5× maior que o necessário no caso comum de 3
    // cores e ficava CURTO no caso de 5+ cores).
    layers = Math.max(1, maxSwaps) * LAYERS_POR_FAIXA,
    // 0,08mm é o piso FÍSICO com bico de 0,4mm (o perfil mais fino que o Bambu
    // Studio oferece pra esse bico) — testado contra 0,16 e 0,04mm num relevo
    // de 4mm fixo (antes deste acoplamento; a granularity em si não mudou):
    // 0,04mm cobra 44MB de malha por um ΔE igual ao de 0,08mm, e 0,16mm perde
    // gradação visível (banda na peça). Por isso continua o default, agora só
    // com o TOTAL de camadas acoplado a `maxSwaps` em vez de fixo em 50.
    layerHeight = 0.08,
    baseThickness = 2.4,
    dither = false,
    toneMap = 'auto',
    extrusionWidth = 0.42,
    // ams: com AMS instalado, todas as cores viram ToolChange e ninguém troca
    // rolo na mão. Quem imprime numa P1S sem AMS passa `swapMode: 'manual'`.
    swapMode = 'ams',
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
    toneMap,
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
  const usedFilaments = filamentosUsados(plan)

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

  // mesmo denominador do default de `layers` (Math.max(1, maxSwaps)) — pra o
  // aviso e a derivação concordarem sobre o que é "uma faixa"
  const mmPorFaixa = (layers * layerHeight) / Math.max(1, maxSwaps)

  return {
    threemf,
    stl: toBinarySTL(mesh, 'puzzle'),
    swaps: descreveTrocas(plan, colorChanges),
    plan,
    palette,
    usedFilaments,
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
      mmPorFaixa,
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

/** Deduplica base + cronograma por id, na ordem em que cada filamento entra. */
function filamentosUsados(plan: LayerPlan): Filament[] {
  const vistos = new Set<string>()
  const out: Filament[] = []
  for (const f of [plan.base, ...plan.schedule]) {
    if (vistos.has(f.id)) continue
    vistos.add(f.id)
    out.push(f)
  }
  return out
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
