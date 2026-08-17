import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync } from 'fflate'
import { extrudePolygon } from '../mesh/extrude.ts'
import { triangleCount, type Mesh } from '../mesh/mesh.ts'
import { writeProject3MF, type ProjectOptions } from './threemf.ts'

const cubo = () =>
  extrudePolygon(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    0,
    5,
  )

const LAYER = 0.12
const FIRST = 0.2
/** Topo da camada k+1 — a MESMA conta que o writer valida. */
const z = (k: number) => FIRST + k * LAYER

const base = (): ProjectOptions => ({
  objects: [{ name: 'peca-1', mesh: cubo() }],
  filaments: [
    { color: '#000000', type: 'PLA' },
    { color: '#FFFFFF', type: 'PLA' },
    { color: '#0F62FE', type: 'PETG' },
  ],
  colorChanges: [
    { topZ: z(3), extruder: 2, color: '#FFFFFF' },
    { topZ: z(8), extruder: 3, color: '#0F62FE' },
    { topZ: z(15), extruder: 1, color: '#000000' },
  ],
  printerModel: 'Bambu Lab X1C',
  layerHeight: LAYER,
  firstLayerHeight: FIRST,
})

const abrir = (o: ProjectOptions) => {
  const zip = unzipSync(writeProject3MF(o))
  const txt = (p: string) => new TextDecoder().decode(zip[p])
  return { zip, txt }
}

/** Extrai os atributos de cada tag `<nome ...>` — parser mínimo, sem dependência. */
function tags(xml: string, nome: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const m of xml.matchAll(new RegExp(`<${nome}\\s([^>]*?)/?>`, 'g'))) {
    const attrs: Record<string, string> = {}
    for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    out.push(attrs)
  }
  return out
}

test('o zip tem exatamente as entradas esperadas', () => {
  const { zip } = abrir(base())
  assert.deepEqual(Object.keys(zip).sort(), [
    '3D/3dmodel.model',
    'Metadata/custom_gcode_per_layer.xml',
    'Metadata/model_settings.config',
    'Metadata/project_settings.config',
    '[Content_Types].xml',
    '_rels/.rels',
  ])
})

test('os XMLs têm a estrutura que o slicer espera', () => {
  const { txt } = abrir(base())

  const model = txt('3D/3dmodel.model')
  assert.match(model, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(model, /<resources>[\s\S]*<object id="1" type="model"[\s\S]*<\/resources>/)
  assert.match(model, /<mesh>\s*<vertices>/)
  assert.equal(tags(model, 'item')[0].objectid, '1')

  const ms = txt('Metadata/model_settings.config')
  assert.equal(tags(ms, 'metadata').find((m) => m.key === 'plater_id')?.value, '1')
  assert.equal(tags(ms, 'metadata').find((m) => m.key === 'extruder')?.value, '1')
  assert.match(ms, /<plate>[\s\S]*<\/plate>/)

  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  assert.match(cg, /<custom_gcodes_per_layer>\s*<plate>\s*<plate_info id="1"\/>/)
  assert.match(cg, /<\/plate>\s*<\/custom_gcodes_per_layer>/)

  assert.match(txt('_rels/.rels'), /Target="\/3D\/3dmodel\.model"/)
  assert.match(txt('[Content_Types].xml'), /Extension="model"/)

  const cfg = JSON.parse(txt('Metadata/project_settings.config'))
  assert.equal(cfg.printer_model, 'Bambu Lab X1C')
  assert.equal(cfg.layer_height, '0.12')
  assert.equal(cfg.initial_layer_print_height, '0.2')
})

test('sem o Application "BambuStudio-" o slicer descarta config e trocas', () => {
  // não é estética: é o prefixo que liga o m_is_bbl_3mf do importador. Sem ele
  // o arquivo entra como "de outro programa" e sobra só a geometria.
  const model = abrir(base()).txt('3D/3dmodel.model')
  const meta = tags(model, 'metadata')
  const app = model.match(/<metadata name="Application">([^<]*)<\/metadata>/)
  assert.ok(app, 'não existe metadata Application')
  assert.match(app[1], /^BambuStudio-/)
  assert.ok(
    meta.some((m) => m.name === 'BambuStudio:3mfVersion'),
    'falta BambuStudio:3mfVersion',
  )
  assert.match(model, /<metadata name="OrcaSlicer">/)
})

test('a malha indexada vai direto pro XML, vértice a vértice e índice a índice', () => {
  const m = cubo()
  const { txt } = abrir({ ...base(), objects: [{ name: 'c', mesh: m }] })
  const model = txt('3D/3dmodel.model')

  const verts = tags(model, 'vertex')
  const tris = tags(model, 'triangle')

  assert.equal(tris.length, triangleCount(m))
  assert.equal(verts.length, m.positions.length / 3)
  assert.equal(verts.length, 8, 'um cubo indexado tem 8 esquinas')

  // as coordenadas saem na ordem x,y,z do buffer — sem reindexar, sem embaralhar
  for (let i = 0; i < verts.length; i++) {
    for (const [k, o] of [['x', 0], ['y', 1], ['z', 2]] as const) {
      assert.ok(
        Math.abs(Number(verts[i][k]) - m.positions[i * 3 + o]) < 1e-5,
        `vértice ${i}.${k}: ${verts[i][k]} != ${m.positions[i * 3 + o]}`,
      )
    }
  }

  // os índices são os da malha, na ordem: qualquer deslocamento inverte normal
  // ou aponta pro vértice errado, e a peça sai furada
  assert.deepEqual(
    tris.flatMap((t) => [Number(t.v1), Number(t.v2), Number(t.v3)]),
    Array.from(m.indices),
  )
})

test('modo manual: toda troca vira pausa num projeto de UM filamento', () => {
  const o = base()
  const { txt } = abrir(o)
  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  const layers = tags(cg, 'layer')

  assert.equal(layers.length, o.colorChanges.length)
  // 1e-6 é a resolução do formato (6 casas), não folga: erra uma camada inteira
  // quem escrever o top_z errado
  layers.forEach((l, i) =>
    assert.ok(Math.abs(Number(l.top_z) - o.colorChanges[i].topZ) < 1e-6, `top_z ${l.top_z} da troca ${i}`),
  )
  for (const l of layers) {
    assert.equal(l.type, '1', 'type=1 é PausePrint; 0 (ColorChange) é código morto e 2 exige AMS')
    assert.equal(l.extruder, '1')
    assert.equal(l.color, '', 'cor não-vazia aqui era a mensagem de pausa no formato legado')
    assert.equal(l.extra, '', 'extra ausente derruba o import inteiro por exceção')
    assert.ok('extra' in l, 'o atributo extra tem que existir')
    assert.equal(l.gcode, 'M400 U1')
    assert.notEqual(l.gcode, 'tool_change')
  }
  assert.equal(tags(cg, 'mode')[0].value, 'SingleExtruder')

  // 2+ cores em filament_colour = projeto multi-filamento = mapeamento de AMS
  const cfg = JSON.parse(txt('Metadata/project_settings.config'))
  assert.deepEqual(cfg.filament_colour, ['#000000'])
  assert.deepEqual(cfg.filament_type, ['PLA'])
  assert.deepEqual(cfg.filament_diameter, ['1.75'])
})

test('modo ams: troca vira ToolChange com o palette inteiro declarado', () => {
  const o = { ...base(), swapMode: 'ams' as const }
  const { txt } = abrir(o)
  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  const layers = tags(cg, 'layer')

  assert.deepEqual(
    layers.map((l) => [Number(l.extruder), l.color, l.type, l.gcode]),
    o.colorChanges.map((c) => [c.extruder, c.color, '2', 'tool_change']),
  )
  layers.forEach((l, i) => assert.ok(Math.abs(Number(l.top_z) - o.colorChanges[i].topZ) < 1e-6))
  for (const l of layers) assert.equal(l.extra, '')
  // MultiAsSingle é condição necessária: fora dele o slicer ignora ToolChange
  assert.equal(tags(cg, 'mode')[0].value, 'MultiAsSingle')

  const cfg = JSON.parse(txt('Metadata/project_settings.config'))
  assert.deepEqual(cfg.filament_colour, ['#000000', '#FFFFFF', '#0F62FE'])
  assert.deepEqual(cfg.filament_type, ['PLA', 'PLA', 'PETG'])
})

test('todo valor do project_settings é string ou array de strings', () => {
  // número ou booleano cru cai no else do parser de config e a chave é
  // descartada em silêncio — layer_height viraria o default
  const cfg = JSON.parse(abrir(base()).txt('Metadata/project_settings.config'))
  for (const [k, v] of Object.entries(cfg)) {
    if (Array.isArray(v)) {
      for (const e of v) assert.equal(typeof e, 'string', `${k} tem elemento não-string`)
    } else {
      assert.equal(typeof v, 'string', `${k} não é string`)
    }
  }
  // e os arrays de filamento andam juntos: tamanhos diferentes desalinham slots
  const n = cfg.filament_colour.length
  for (const k of ['filament_type', 'filament_settings_id', 'filament_diameter']) {
    assert.equal(cfg[k].length, n, `${k} tem tamanho diferente de filament_colour`)
  }
})

test('nome de objeto com & e < sai escapado', () => {
  const o = base()
  o.objects = [{ name: 'peça <A> & "B" \'c\'', mesh: cubo() }]
  const { txt } = abrir(o)
  const esperado = 'peça &lt;A&gt; &amp; &quot;B&quot; &apos;c&apos;'

  for (const p of ['3D/3dmodel.model', 'Metadata/model_settings.config']) {
    const xml = txt(p)
    assert.ok(xml.includes(esperado), `${p} não escapou o nome`)
    assert.ok(!xml.includes('<A>'), `${p} deixou markup cru vazar`)
    const nome = tags(xml, p.endsWith('.model') ? 'object' : 'metadata').find((t) => t.name ?? t.value)
    assert.ok(nome)
  }
})

test('vários objetos viram ids sequenciais', () => {
  const o = base()
  o.objects = [
    { name: 'a', mesh: cubo() },
    { name: 'b', mesh: cubo() },
  ]
  const { txt } = abrir(o)
  const model = txt('3D/3dmodel.model')
  assert.deepEqual(
    tags(model, 'object').map((t) => t.id),
    ['1', '2'],
  )
  assert.deepEqual(
    tags(model, 'item').map((t) => t.objectid),
    ['1', '2'],
  )
  assert.equal(tags(model, 'vertex').length, 16)
})

test('malha inconsistente lança em vez de gerar 3mf corrompido', () => {
  const mal = (mesh: Mesh) => () => writeProject3MF({ ...base(), objects: [{ name: 'x', mesh }] })

  assert.throws(mal({ positions: new Float32Array(0), indices: new Uint32Array(0) }), /triângulos/)
  // 4 índices: o triângulo do fim sairia com v2/v3 = undefined
  assert.throws(
    mal({ positions: new Float32Array(9), indices: Uint32Array.from([0, 1, 2, 0]) }),
    /não é múltiplo de 3/,
  )
  assert.throws(
    mal({ positions: new Float32Array(8), indices: Uint32Array.from([0, 1, 2]) }),
    /positions.*múltiplo de 3/,
  )
  // índice além do fim: <vertex> inexistente, o slicer lê lixo
  assert.throws(
    mal({ positions: new Float32Array(9), indices: Uint32Array.from([0, 1, 3]) }),
    /índice 3 fora de 0\.\.2/,
  )
  assert.throws(
    mal({ positions: Float32Array.from([0, 0, 0, 1, NaN, 0, 1, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }),
    /não é finita/,
  )
  // e o caso bom passa mesmo
  assert.doesNotThrow(
    mal({ positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }),
  )
})

test('entradas inválidas lançam', () => {
  assert.throws(() => writeProject3MF({ ...base(), objects: [] }), /objetos vazia/)
  assert.throws(() => writeProject3MF({ ...base(), filaments: [] }), /filamento/)
  // extrusora 0-indexada é o erro clássico: os slots são 1-indexados
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: z(1), extruder: 0, color: '#000000' }] }),
    /1\.\.3/,
  )
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: z(1), extruder: 4, color: '#000000' }] }),
    /1\.\.3/,
  )
  assert.throws(
    () =>
      writeProject3MF({
        ...base(),
        colorChanges: [
          { topZ: z(5), extruder: 2, color: '#000000' },
          { topZ: z(2), extruder: 3, color: '#ffffff' },
        ],
      }),
    /top_z/,
  )
  // topo repetido também é inválido: duas trocas na mesma camada
  assert.throws(
    () =>
      writeProject3MF({
        ...base(),
        colorChanges: [
          { topZ: z(5), extruder: 2, color: '#000000' },
          { topZ: z(5), extruder: 3, color: '#ffffff' },
        ],
      }),
    /não é maior que o anterior/,
  )
  assert.throws(() => writeProject3MF({ ...base(), layerHeight: 0 }), /layerHeight/)
  assert.throws(() => writeProject3MF({ ...base(), firstLayerHeight: -0.2 }), /firstLayerHeight/)
})

test('cor que não é hex lança nos dois lados', () => {
  assert.throws(
    () => writeProject3MF({ ...base(), filaments: [{ color: 'branco', type: 'PLA' }] }),
    /cor de filamento "branco"/,
  )
  assert.throws(
    () => writeProject3MF({ ...base(), filaments: [{ color: '#FFF', type: 'PLA' }] }),
    /não é hex/,
  )
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: z(1), extruder: 1, color: '#GGGGGG' }] }),
    /cor "#GGGGGG"/,
  )
  // #RRGGBBAA é o que o Bambu escreve às vezes: tem que passar
  assert.doesNotThrow(() =>
    writeProject3MF({ ...base(), filaments: [{ color: '#0F62FEFF', type: 'PLA' }], colorChanges: [] }),
  )
})

test('top_z fora da grade de camadas lança, com o valor certo na mensagem', () => {
  const meio = () =>
    writeProject3MF({ ...base(), colorChanges: [{ topZ: z(3) + LAYER / 4, extruder: 2, color: '#FFFFFF' }] })
  // um quarto de camada acima: o slicer NÃO erra, ele encaixa na camada vizinha
  // e a troca sai no lugar errado — só se descobre com a peça na mão
  assert.throws(meio, /não cai em topo de camada/)
  assert.throws(meio, /mais próximo: 0\.56$/)

  // abaixo da primeira camada não existe topo nenhum — inclusive o "topo da
  // camada zero", que cai na grade mas não existe na peça
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: 0.1, extruder: 2, color: '#FFFFFF' }] }),
    /não cai em topo de camada/,
  )
  assert.throws(
    () => writeProject3MF({ ...base(), colorChanges: [{ topZ: FIRST - LAYER, extruder: 2, color: '#FFFFFF' }] }),
    /não cai em topo de camada/,
  )
  // exatamente a primeira camada é válido (trocar antes da camada 2)
  assert.doesNotThrow(() =>
    writeProject3MF({ ...base(), colorChanges: [{ topZ: FIRST, extruder: 2, color: '#FFFFFF' }] }),
  )
  // a grade acompanha os parâmetros: com outra primeira camada, z(3) sai dela
  assert.throws(
    () => writeProject3MF({ ...base(), firstLayerHeight: 0.25 }),
    /não cai em topo de camada/,
  )
})

test('sem trocas continua gerando um projeto válido', () => {
  const { txt } = abrir({ ...base(), colorChanges: [] })
  const cg = txt('Metadata/custom_gcode_per_layer.xml')
  assert.equal(tags(cg, 'layer').length, 0)
  assert.match(cg, /<custom_gcodes_per_layer>/)
  assert.equal(tags(cg, 'mode')[0].value, 'SingleExtruder')
})
