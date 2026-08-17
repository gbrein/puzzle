import { triangleCount, type Mesh } from '../mesh/mesh.ts'
import { zipSync } from 'fflate'

export interface ThreeMFObject {
  name: string
  mesh: Mesh
}

/** Uma troca de filamento: a partir do topo da camada em `topZ`, imprime com `extruder` (1-indexado). */
export interface ColorChange {
  topZ: number
  extruder: number
  color: string
}

export interface ProjectOptions {
  objects: ThreeMFObject[]
  filaments: { color: string; type: string }[]
  colorChanges: ColorChange[]
  printerModel?: string
  layerHeight?: number
}

/**
 * Tolerância do dedupe de vértices, em mm. Duas coordenadas dentro dela viram
 * o mesmo vértice. 1e-5mm é ~1000x mais fino que o passo mecânico da impressora,
 * então só colapsa o que é a mesma esquina com ruído de ponto flutuante.
 */
const EPS = 1e-5

const escapeXML = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

/** Sem notação científica e sem cauda de zeros — slicers engasgam com "1e-7". */
function num(x: number): string {
  const s = x.toFixed(6)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * O 3MF quer malha indexada; a nossa `Mesh` é não-indexada (formato do STL).
 * Agrupa por coordenada quantizada e devolve vértices únicos + índices.
 */
function indexMesh(mesh: Mesh): { verts: number[]; tris: number[] } {
  const v = mesh.verts
  const seen = new Map<string, number>()
  const verts: number[] = []
  const tris: number[] = []
  for (let i = 0; i < v.length; i += 3) {
    const key = `${Math.round(v[i] / EPS)},${Math.round(v[i + 1] / EPS)},${Math.round(v[i + 2] / EPS)}`
    let idx = seen.get(key)
    if (idx === undefined) {
      idx = verts.length / 3
      seen.set(key, idx)
      verts.push(v[i], v[i + 1], v[i + 2])
    }
    tris.push(idx)
  }
  return { verts, tris }
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

function modelXML(objects: ThreeMFObject[]): string {
  const res: string[] = []
  const items: string[] = []
  objects.forEach((o, n) => {
    const id = n + 1
    const { verts, tris } = indexMesh(o.mesh)
    const vs: string[] = []
    for (let i = 0; i < verts.length; i += 3) {
      vs.push(`<vertex x="${num(verts[i])}" y="${num(verts[i + 1])}" z="${num(verts[i + 2])}"/>`)
    }
    const ts: string[] = []
    for (let i = 0; i < tris.length; i += 3) {
      ts.push(`<triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>`)
    }
    res.push(
      `  <object id="${id}" type="model" name="${escapeXML(o.name)}">\n` +
        `   <mesh>\n    <vertices>${vs.join('')}</vertices>\n` +
        `    <triangles>${ts.join('')}</triangles>\n   </mesh>\n  </object>`,
    )
    items.push(`  <item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`)
  })
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">puzzle</metadata>
 <resources>
${res.join('\n')}
 </resources>
 <build>
${items.join('\n')}
 </build>
</model>
`
}

function modelSettings(objects: ThreeMFObject[]): string {
  const objs = objects
    .map(
      (o, n) =>
        ` <object id="${n + 1}">\n` +
        `  <metadata key="name" value="${escapeXML(o.name)}"/>\n` +
        // extruder 1 pro objeto inteiro: a cor vem das trocas por camada, não do objeto.
        `  <metadata key="extruder" value="1"/>\n </object>`,
    )
    .join('\n')
  const instances = objects
    .map(
      (_, n) =>
        `  <model_instance>\n   <metadata key="object_id" value="${n + 1}"/>\n` +
        `   <metadata key="instance_id" value="0"/>\n  </model_instance>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objs}
 <plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="plater_name" value=""/>
${instances}
 </plate>
</config>
`
}

function customGcode(changes: ColorChange[]): string {
  const layers = changes
    .map(
      (c) =>
        `  <layer top_z="${num(c.topZ)}" type="1" extruder="${c.extruder}"` +
        ` color="${escapeXML(c.color)}" extra="" gcode="tool_change"/>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<custom_gcodes_per_layer>
 <plate>
  <plate_info id="1"/>
${layers}
 </plate>
</custom_gcodes_per_layer>
`
}

/** Escreve o .3mf de projeto: malha + filamentos + trocas por camada, pronto pro Bambu Studio / OrcaSlicer. */
export function writeProject3MF(o: ProjectOptions): Uint8Array {
  if (o.objects.length === 0) throw new Error('3mf: lista de objetos vazia')
  if (o.filaments.length === 0) throw new Error('3mf: nenhum filamento declarado')
  for (const obj of o.objects) {
    if (triangleCount(obj.mesh) === 0) throw new Error(`3mf: objeto "${obj.name}" não tem triângulos`)
  }
  let anterior = -Infinity
  for (const c of o.colorChanges) {
    if (!Number.isInteger(c.extruder) || c.extruder < 1 || c.extruder > o.filaments.length) {
      throw new Error(
        `3mf: extrusora ${c.extruder} fora do intervalo 1..${o.filaments.length} (slots são 1-indexados)`,
      )
    }
    if (!(c.topZ > anterior)) throw new Error(`3mf: top_z ${c.topZ} não é maior que o anterior ${anterior}`)
    anterior = c.topZ
  }

  const settings = {
    // filament_colour é 0-indexado e é a fonte de verdade da cor; o atributo
    // color do <layer> é decorativo e o slicer ignora.
    filament_colour: o.filaments.map((f) => f.color),
    filament_type: o.filaments.map((f) => f.type),
    filament_settings_id: o.filaments.map((f) => f.type),
    printer_model: o.printerModel ?? 'Bambu Lab P1S',
    layer_height: num(o.layerHeight ?? 0.08),
    from: 'puzzle',
  }

  const enc = new TextEncoder()
  return zipSync(
    {
      '[Content_Types].xml': enc.encode(CONTENT_TYPES),
      '_rels/.rels': enc.encode(RELS),
      '3D/3dmodel.model': enc.encode(modelXML(o.objects)),
      'Metadata/project_settings.config': enc.encode(JSON.stringify(settings, null, 4)),
      'Metadata/model_settings.config': enc.encode(modelSettings(o.objects)),
      'Metadata/custom_gcode_per_layer.xml': enc.encode(customGcode(o.colorChanges)),
    },
    { level: 6 },
  )
}
