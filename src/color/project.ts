import type { LayerPlan } from './types.ts'
import { heightOf } from './types.ts'
import type { ColorChange } from '../export/threemf.ts'

/**
 * Ponte entre o motor de cor e o exportador: um `LayerPlan` vira o par
 * (slots de filamento, trocas por camada) que `writeProject3MF` consome.
 */

/**
 * `Filament` não carrega o tipo de material, e `ProjectOptions.filaments` exige.
 * ponytail: material fixo em PLA, o único que o resto do projeto assume (td medido
 * em PLA, temperaturas do perfil P1S). Upgrade: subir `type` para `Filament` em
 * types.ts — é contrato compartilhado, muda com todos os consumidores juntos.
 */
const TIPO_PADRAO = 'PLA'

export function planToProject(plan: LayerPlan): {
  filaments: { color: string; type: string }[]
  colorChanges: ColorChange[]
} {
  if (!(plan.layerHeight > 0) || !Number.isFinite(plan.layerHeight)) {
    throw new Error(`plano: altura de camada inválida: ${plan.layerHeight}`)
  }
  if (!Number.isInteger(plan.baseLayers) || plan.baseLayers < 0) {
    throw new Error(`plano: baseLayers inválido: ${plan.baseLayers}`)
  }

  // Um id = um rolo na impressora. O mesmo filamento em duas faixas separadas
  // ocupa o MESMO slot, senão o slicer pediria dois rolos iguais no AMS.
  const slot = new Map<string, number>()
  const filaments: { color: string; type: string }[] = []
  for (const f of [plan.base, ...plan.schedule]) {
    if (slot.has(f.id)) continue
    slot.set(f.id, filaments.length + 1) // extruder é 1-indexado
    filaments.push({ color: f.hex, type: TIPO_PADRAO })
  }

  const colorChanges: ColorChange[] = []
  // A base é um rolo como outro qualquer: sair dela para schedule[0] é troca.
  let atual = plan.base
  for (let i = 0; i < plan.schedule.length; i++) {
    const f = plan.schedule[i]
    if (f.id === atual.id) continue // faixas adjacentes iguais não são troca
    // A troca tem que valer JÁ na camada de cor `i`, e o topo dessa camada é
    // heightOf(plan, i + 1) — heightOf(plan, i) é o topo da camada ANTERIOR
    // (com i = 0, o topo da base). Usar `i` desloca todas as cores uma camada
    // para baixo e come a última faixa.
    colorChanges.push({ topZ: heightOf(plan, i + 1), extruder: slot.get(f.id)!, color: f.hex })
    atual = f
  }

  return { filaments, colorChanges }
}
