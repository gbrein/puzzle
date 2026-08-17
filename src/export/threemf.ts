import { triangleCount, type Mesh } from '../mesh/mesh.ts'
import { zipSync } from 'fflate'

/**
 * Data fixa carimbada nas entradas do zip: 2000-01-01T12:00:00Z.
 *
 * Não é a época do zip (1980-01-01) de propósito: o fflate valida a faixa
 * 1980-2099 lendo o ano em hora LOCAL, e 1980-01-01T00:00Z cai em 1979 em
 * qualquer fuso a oeste de Greenwich. Meio-dia de 2000 é o mesmo ano no mundo todo.
 *
 * ponytail: o zip guarda hora local, então o arquivo só sai byte a byte igual
 * dentro do mesmo fuso. Basta para "gerei de novo e deu o mesmo"; se um dia
 * precisar de hash igual entre máquinas, escrever o cabeçalho do zip à mão.
 */
const ZIP_MTIME = 946728000000

export interface ThreeMFObject {
  name: string
  mesh: Mesh
}

/**
 * Uma troca de filamento: a partir do topo da camada em `topZ`, imprime com
 * `extruder` (1-indexado no palette de `filaments`).
 *
 * Cuidado com o nome: isto NÃO vira o `ColorChange` (type=0) do slicer, que é
 * código morto no Orca e no Bambu (o bloco que emitiria M600 está dentro de
 * `#if 0`). Vira `PausePrint` (type=1) no modo manual e `ToolChange` (type=2)
 * no modo AMS. Ver `swapMode`.
 */
export interface ColorChange {
  topZ: number
  extruder: number
  color: string
}

export interface ThreeMFPlate {
  objects: ThreeMFObject[]
  /**
   * Trocas desta placa. Placas de peças repetem a MESMA lista (o cronograma
   * de cor é uma propriedade da pilha de camadas, não da placa) — a moldura,
   * sem relevo, entra com `[]`.
   */
  colorChanges: ColorChange[]
}

export interface ProjectOptions {
  /** Uma placa por entrada. `plater_id` sai da posição (1-indexado). */
  plates: ThreeMFPlate[]
  /** Palette lógico, na ordem dos slots (1-indexados nas trocas). */
  filaments: { color: string; type: string }[]
  printerModel?: string
  /** Altura das camadas acima da primeira, em mm. */
  layerHeight?: number
  /** Primeira camada, em mm — vira `initial_layer_print_height`. */
  firstLayerHeight?: number
  /**
   * `manual` (padrão): impressora sem AMS. O projeto declara UM filamento e
   * cada troca vira uma pausa (type=1). É o único caminho que produz saída
   * útil numa P1S sem AMS — `ToolChange` é descartado sem aviso quando o
   * projeto tem um filamento só, e `ColorChange` não emite nada em versão
   * nenhuma. Preço: a prévia do slicer mostra a peça numa cor só.
   *
   * `ams`: o projeto declara os N filamentos e cada troca vira `ToolChange`
   * (type=2) com `mode=MultiAsSingle`, que é a condição que faz o slicer
   * processar a troca. Abre o diálogo de mapeamento do AMS no envio.
   */
  swapMode?: 'manual' | 'ams'
}

/**
 * G-code de pausa da P1S (`machine_pause_gcode` do perfil BBL comum). O slicer
 * IGNORA este atributo quando `type` está presente — vai escrito só para o
 * arquivo ficar idêntico ao que o Bambu Studio exporta.
 */
const PAUSE_GCODE = 'M400 U1'

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

const escapeXML = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

/** Sem notação científica e sem cauda de zeros — slicers engasgam com "1e-7". */
function num(x: number): string {
  const s = x.toFixed(6)
  // toFixed(6) sempre tem ponto, então dá pra cortar no braço: é o laço mais
  // quente do writer (3 chamadas por vértice, milhões de vértices).
  let e = s.length
  while (s.charCodeAt(e - 1) === 48) e--
  if (s.charCodeAt(e - 1) === 46) e--
  return s.slice(0, e)
}

/**
 * Acumula texto já codificado em blocos. O XML da malha de produção passa de
 * 50MB; segurá-lo como uma string JS custa o dobro disso em UTF-16 antes mesmo
 * de virar bytes.
 */
class ByteSink {
  #enc = new TextEncoder()
  #chunks: Uint8Array[] = []
  #buf = ''
  #len = 0

  push(s: string): void {
    this.#buf += s
    if (this.#buf.length > 65536) this.#flush()
  }

  #flush(): void {
    if (this.#buf.length === 0) return
    const b = this.#enc.encode(this.#buf)
    this.#chunks.push(b)
    this.#len += b.length
    this.#buf = ''
  }

  bytes(): Uint8Array {
    this.#flush()
    const out = new Uint8Array(this.#len)
    let o = 0
    for (const c of this.#chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rel-1" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

/**
 * É o prefixo de `Application` que liga o `m_is_bbl_3mf` do importador. Sem
 * ele o arquivo entra como "de outro programa" e o slicer joga fora config E
 * custom gcode, ficando só com a geometria. O `OrcaSlicer` extra evita o
 * pop-up "criado pelo BambuStudio" e é ignorado pelo Bambu.
 * ponytail: os números de versão são chute — o importador só casa o prefixo.
 * Trocar pelos do export nativo quando alguém gerar o .3mf de referência (P1).
 */
const METADATA =
  ` <metadata name="Application">BambuStudio-01.09.00.60</metadata>\n` +
  ` <metadata name="BambuStudio:3mfVersion">1</metadata>\n` +
  ` <metadata name="OrcaSlicer">2.2.0</metadata>\n`

function writeModel(objects: ThreeMFObject[]): Uint8Array {
  const s = new ByteSink()
  s.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
      METADATA +
      ` <resources>\n`,
  )
  objects.forEach((o, n) => {
    const p = o.mesh.positions
    const ix = o.mesh.indices
    s.push(`  <object id="${n + 1}" type="model" name="${escapeXML(o.name)}">\n   <mesh>\n    <vertices>`)
    // a malha já chega indexada: nada de reindexar aqui. O dedupe por chave de
    // string que morava neste ponto era 1 string por vértice de triângulo.
    for (let i = 0; i < p.length; i += 3) {
      s.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>`)
    }
    s.push(`</vertices>\n    <triangles>`)
    for (let i = 0; i < ix.length; i += 3) {
      s.push(`<triangle v1="${ix[i]}" v2="${ix[i + 1]}" v3="${ix[i + 2]}"/>`)
    }
    s.push(`</triangles>\n   </mesh>\n  </object>\n`)
  })
  s.push(` </resources>\n <build>\n`)
  objects.forEach((_, n) => {
    s.push(`  <item objectid="${n + 1}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>\n`)
  })
  s.push(` </build>\n</model>\n`)
  return s.bytes()
}

/**
 * `<object>` é um recurso GLOBAL do arquivo (um id por objeto, em toda a
 * malha) — mas o `<plate>` que o contém é local a cada placa: só lista os
 * `object_id` que imprimem ali. É essa membership, não a posição bruta dos
 * vértices, que diz ao slicer o que vai em qual placa; por isso cada placa
 * pode reusar coordenadas parecidas (cada peça já entra deslocada pro seu
 * canto da mesa por `layoutPlates`, mas dentro da MESMA faixa 0..bedWidth).
 */
function modelSettings(plates: ThreeMFPlate[]): string {
  const objs: string[] = []
  const plateBlocks: string[] = []
  let id = 0
  for (let p = 0; p < plates.length; p++) {
    const instances: string[] = []
    for (const o of plates[p].objects) {
      id++
      objs.push(
        ` <object id="${id}">\n` +
          `  <metadata key="name" value="${escapeXML(o.name)}"/>\n` +
          // extruder 1 pro objeto inteiro: a cor vem das trocas por camada, não do objeto.
          `  <metadata key="extruder" value="1"/>\n </object>`,
      )
      instances.push(
        `  <model_instance>\n   <metadata key="object_id" value="${id}"/>\n` +
          `   <metadata key="instance_id" value="0"/>\n  </model_instance>`,
      )
    }
    plateBlocks.push(
      ` <plate>\n  <metadata key="plater_id" value="${p + 1}"/>\n  <metadata key="plater_name" value=""/>\n` +
        `${instances.join('\n')}\n </plate>`,
    )
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objs.join('\n')}
${plateBlocks.join('\n')}
</config>
`
}

/**
 * Os seis atributos do `<layer>` são todos obrigatórios: o importador lê cada
 * um com `get<T>()` sem default, e um atributo faltando derruba o load inteiro
 * por exceção. `extra` vazio em especial — era o que faltava e travava tudo.
 *
 * Um `<plate>` por placa: cada uma é uma impressão separada, então cada uma
 * carrega sua própria lista de trocas (placas de peça repetem a mesma lista;
 * a moldura, sem relevo, entra com `colorChanges: []` e nenhum `<layer>`).
 */
function customGcode(plates: ThreeMFPlate[], manual: boolean): string {
  const mode = manual ? 'SingleExtruder' : 'MultiAsSingle'
  const blocks = plates.map((plate, p) => {
    const layers = plate.colorChanges
      .map((c) => {
        const type = manual ? 1 : 2
        const extruder = manual ? 1 : c.extruder
        // no modo manual a cor não tem para onde ir: o projeto tem um filamento
        // só. Atributo vazio é o que o Bambu escreve para pausa; pôr um hex aqui
        // só confunde quem for depurar (no formato legado `color` era a mensagem).
        const color = manual ? '' : c.color
        const gcode = manual ? PAUSE_GCODE : 'tool_change'
        return (
          `  <layer top_z="${num(c.topZ)}" type="${type}" extruder="${extruder}"` +
          ` color="${color}" extra="" gcode="${gcode}"/>`
        )
      })
      .join('\n')
    // `mode` fica dentro do <plate>, depois dos <layer>. MultiAsSingle é condição
    // necessária pro slicer processar ToolChange; pra pausa é decorativo.
    return ` <plate>\n  <plate_info id="${p + 1}"/>\n${layers ? layers + '\n' : ''}  <mode value="${mode}"/>\n </plate>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<custom_gcodes_per_layer>
${blocks.join('\n')}
</custom_gcodes_per_layer>
`
}

/** Malha corrompida vira 3mf corrompido em silêncio — o slicer não reclama, a peça sai errada. */
function validarMalha(nome: string, m: Mesh): void {
  if (m.positions.length % 3 !== 0) {
    throw new Error(`3mf: objeto "${nome}": ${m.positions.length} floats em positions, não é múltiplo de 3`)
  }
  if (m.indices.length % 3 !== 0) {
    throw new Error(`3mf: objeto "${nome}": ${m.indices.length} índices, não é múltiplo de 3`)
  }
  if (triangleCount(m) === 0) throw new Error(`3mf: objeto "${nome}" não tem triângulos`)
  const n = m.positions.length / 3
  for (let i = 0; i < m.indices.length; i++) {
    if (m.indices[i] >= n) {
      throw new Error(`3mf: objeto "${nome}": índice ${m.indices[i]} fora de 0..${n - 1}`)
    }
  }
  for (let i = 0; i < m.positions.length; i++) {
    if (!Number.isFinite(m.positions[i])) {
      throw new Error(`3mf: objeto "${nome}": coordenada ${i} não é finita (${m.positions[i]})`)
    }
  }
}

/** Escreve o .3mf de projeto: malha + filamentos + trocas por camada, pronto pro Bambu Studio / OrcaSlicer. */
export function writeProject3MF(o: ProjectOptions): Uint8Array {
  if (o.plates.length === 0) throw new Error('3mf: nenhuma placa')
  for (const plate of o.plates) {
    if (plate.objects.length === 0) throw new Error('3mf: placa sem objeto nenhum')
  }
  const objects = o.plates.flatMap((p) => p.objects)
  for (const obj of objects) validarMalha(obj.name, obj.mesh)
  if (o.filaments.length === 0) throw new Error('3mf: nenhum filamento declarado')
  for (const f of o.filaments) {
    if (!HEX.test(f.color)) throw new Error(`3mf: cor de filamento "${f.color}" não é hex #RRGGBB`)
  }

  const layerHeight = o.layerHeight ?? 0.08
  const firstLayerHeight = o.firstLayerHeight ?? 0.2
  if (!(layerHeight > 0)) throw new Error(`3mf: layerHeight ${layerHeight} tem que ser positivo`)
  if (!(firstLayerHeight > 0)) throw new Error(`3mf: firstLayerHeight ${firstLayerHeight} tem que ser positivo`)

  const manual = (o.swapMode ?? 'manual') === 'manual'

  // top_z só precisa crescer DENTRO da mesma placa — são impressões separadas,
  // então placas repetindo o mesmo cronograma (o caso normal) é esperado.
  for (const plate of o.plates) {
    let anterior = -Infinity
    for (const c of plate.colorChanges) {
      if (!Number.isInteger(c.extruder) || c.extruder < 1 || c.extruder > o.filaments.length) {
        throw new Error(
          `3mf: extrusora ${c.extruder} fora do intervalo 1..${o.filaments.length} (slots são 1-indexados)`,
        )
      }
      if (!HEX.test(c.color)) throw new Error(`3mf: cor "${c.color}" da troca em ${c.topZ} não é hex #RRGGBB`)
      if (!(c.topZ > anterior)) throw new Error(`3mf: top_z ${c.topZ} não é maior que o anterior ${anterior}`)
      // O topo da camada k é first + (k-1)*layer. Um top_z fora dessa grade não
      // dá erro no slicer: ele encaixa na camada mais próxima e a troca sai numa
      // camada diferente da pedida — defeito que só aparece com a peça na mão.
      const k = Math.round((c.topZ - firstLayerHeight) / layerHeight)
      if (k < 0 || Math.abs(firstLayerHeight + k * layerHeight - c.topZ) > 1e-6) {
        const perto = firstLayerHeight + Math.max(0, k) * layerHeight
        throw new Error(
          `3mf: top_z ${c.topZ} não cai em topo de camada` +
            ` (grade ${firstLayerHeight} + k*${layerHeight}); mais próximo: ${num(perto)}`,
        )
      }
      anterior = c.topZ
    }
  }

  // No modo manual o projeto TEM que declarar um filamento só: o número de
  // entradas de filament_colour é o num_filaments do slicer, e com 2+ ele abre
  // o mapeamento do AMS. As outras cores existem só no cronograma de trocas.
  const declarados = manual ? o.filaments.slice(0, 1) : o.filaments

  const settings = {
    // Todo valor tem que ser string ou array de strings: número cru é
    // descartado em silêncio pelo parser de config do slicer.
    filament_colour: declarados.map((f) => f.color),
    filament_type: declarados.map((f) => f.type),
    // ponytail: settings_id devia ser o nome do preset ("Bambu PLA Basic @BBL P1S"),
    // não o tipo; sai do .3mf de referência quando alguém exportar um (P1).
    filament_settings_id: declarados.map((f) => f.type),
    filament_diameter: declarados.map(() => '1.75'),
    nozzle_diameter: ['0.4'],
    printer_model: o.printerModel ?? 'Bambu Lab P1S',
    layer_height: num(layerHeight),
    initial_layer_print_height: num(firstLayerHeight),
    from: 'puzzle',
  }

  const enc = new TextEncoder()
  return zipSync(
    {
      '[Content_Types].xml': enc.encode(CONTENT_TYPES),
      '_rels/.rels': enc.encode(RELS),
      '3D/3dmodel.model': writeModel(objects),
      'Metadata/project_settings.config': enc.encode(JSON.stringify(settings, null, 4)),
      'Metadata/model_settings.config': enc.encode(modelSettings(o.plates)),
      'Metadata/custom_gcode_per_layer.xml': enc.encode(customGcode(o.plates, manual)),
    },
    // depois que o dedupe saiu, o deflate virou o gasto do writer: medido em
    // 80MB de XML (1,29M triângulos), level 6 custa 2345ms e level 4 custa
    // 1106ms para 1% a mais de arquivo (10,4 vs 10,3 MB). Level 1 economiza
    // mais 330ms mas engorda 9%.
    //
    // mtime fixo: sem isso o fflate carimba a hora atual e duas gerações da
    // MESMA entrada saem com bytes diferentes. Quem reimprime uma peça perdida
    // meses depois precisa poder confirmar que gerou exatamente o mesmo arquivo.
    // O valor é 1980-01-01, a época do formato zip — abaixo disso o fflate
    // recusa ("date not in range 1980-2099").
    { level: 4, mtime: ZIP_MTIME },
  )
}
