import type { Filament } from '../color/types.ts'

/**
 * Catálogo semente de filamentos.
 *
 * **Procedência dos números.** Os PLA da Prusa vêm da tabela oficial de TD e hex
 * publicada pela Prusa (Knowledge Base, "HueForge filament transparency values
 * and HexCodes", help.prusa3d.com/article/…_762314) — TD e cor copiados verbatim,
 * por isso não levam `estimated`.
 *
 * Os três Bambu Lab vêm de relatos da comunidade sobre o guia de HueForge da
 * Bambu (TD: Black 0.6, Jade White 5, Green 8). O TD é reportado, mas o hex eu
 * não achei publicado junto — os dois campos vão como `estimated: true`, porque
 * a entrada inteira é menos confiável que as da Prusa.
 *
 * Regra do arquivo: número sem fonte concreta é `estimated: true`. Nada aqui é
 * medição nossa; a medição real do usuário entra por `calibrate.ts`.
 */
export const FILAMENTS: Filament[] = [
  // --- brancos e claros (TD alto: a luz atravessa muitas camadas) ---
  { id: 'prusament-pla-vanilla-white', name: 'Prusament PLA Vanilla White', hex: '#D9D4C4', td: 7.1 },
  { id: 'prusament-pla-pearl-white', name: 'Prusament PLA Blend Pearl White', hex: '#D0D7D6', td: 5.4 },
  { id: 'prusament-pla-pristine-white', name: 'Prusament PLA Pristine White', hex: '#E6EAED', td: 5.1 },
  { id: 'prusament-rpla-risotto', name: 'Prusament rPLA Risotto Pigment', hex: '#CCC9BF', td: 11.0 },

  // --- cinzas e neutros ---
  { id: 'prusament-pla-galaxy-silver', name: 'Prusament PLA Galaxy Silver', hex: '#999A9F', td: 6.4 },
  { id: 'prusament-pla-marble-grey', name: 'Prusament PLA Marble Grey', hex: '#B0B4B4', td: 3.5 },
  { id: 'prusament-pla-pearl-mouse', name: 'Prusament PLA Pearl Mouse', hex: '#A49D8D', td: 2.3 },
  { id: 'prusament-pla-my-silverness', name: 'Prusament PLA Blend My Silverness', hex: '#AEB8C0', td: 1.0 },
  { id: 'prusament-pla-gravity-grey', name: 'Prusament PLA Gravity Grey', hex: '#9FA4A7', td: 0.7 },
  { id: 'prusament-pla-gentlemans-grey', name: "Prusament PLA Gentleman's Grey", hex: '#354046', td: 0.3 },

  // --- pretos (TD baixo: uma ou duas camadas já fecham a cor) ---
  { id: 'prusament-pla-jet-black', name: 'Prusament PLA Jet Black', hex: '#24292A', td: 0.3 },
  { id: 'prusament-pla-galaxy-black', name: 'Prusament PLA Prusa Galaxy Black', hex: '#3D3E3C', td: 0.2 },

  // --- primários e saturados ---
  { id: 'prusament-pla-lipstick-red', name: 'Prusament PLA Lipstick Red', hex: '#D03036', td: 3.3 },
  { id: 'prusament-pla-azure-blue', name: 'Prusament PLA Azure Blue', hex: '#0682AC', td: 6.6 },
  { id: 'prusament-pla-royal-blue', name: 'Prusament PLA Blend Royal Blue', hex: '#04518E', td: 0.8 },
  { id: 'prusament-pla-pineapple-yellow', name: 'Prusament PLA Pineapple Yellow', hex: '#EFD006', td: 7.6 },
  { id: 'prusament-pla-prusa-orange', name: 'Prusament PLA Prusa Orange', hex: '#FE6E31', td: 6.6 },
  { id: 'prusament-pla-simply-green', name: 'Prusament PLA Simply Green', hex: '#70A640', td: 3.0 },
  { id: 'prusament-pla-lime-green', name: 'Prusament PLA Blend Lime Green', hex: '#A7B852', td: 3.5 },
  { id: 'prusament-pla-opal-green', name: 'Prusament PLA Opal Green', hex: '#075B49', td: 4.0 },
  { id: 'prusament-pla-galaxy-green', name: 'Prusament PLA Galaxy Green', hex: '#426639', td: 3.2 },
  { id: 'prusament-pla-army-green', name: 'Prusament PLA Army Green', hex: '#5E6344', td: 0.4 },
  { id: 'prusament-pla-mystic-green', name: 'Prusament PLA Premium Mystic Green', hex: '#555845', td: 1.0 },
  { id: 'prusament-pla-galaxy-purple', name: 'Prusament PLA Galaxy Purple', hex: '#0F0939', td: 4.7 },
  { id: 'prusament-pla-ms-pink', name: 'Prusament PLA Blend Ms. Pink', hex: '#E34A93', td: 4.1 },
  { id: 'prusament-pla-oh-my-gold', name: 'Prusament PLA Blend Oh My Gold', hex: '#CE9F2D', td: 4.1 },
  { id: 'prusament-pla-viva-la-bronze', name: 'Prusament PLA Blend Viva La Bronze', hex: '#B38E3E', td: 1.9 },
  { id: 'prusament-pla-mystic-brown', name: 'Prusament PLA Premium Mystic Brown', hex: '#482E31', td: 1.8 },
  { id: 'prusament-rpla-algae', name: 'Prusament rPLA Algae Pigment', hex: '#674B41', td: 4.2 },
  { id: 'prusament-rpla-wine', name: 'Prusament rPLA Wine Pigment', hex: '#5E493F', td: 2.8 },
  { id: 'prusament-rpla-corn', name: 'Prusament rPLA Corn Pigment', hex: '#B37B46', td: 6.2 },

  // --- Bambu Lab: TD relatado pela comunidade, hex aproximado por mim ---
  { id: 'bambu-pla-basic-jade-white', name: 'Bambu Lab PLA Basic Jade White', hex: '#FFFFFF', td: 5.0, estimated: true },
  { id: 'bambu-pla-basic-black', name: 'Bambu Lab PLA Basic Black', hex: '#000000', td: 0.6, estimated: true },
  { id: 'bambu-pla-basic-green', name: 'Bambu Lab PLA Basic Green', hex: '#00AE42', td: 8.0, estimated: true },
]

/**
 * ponytail: busca linear num catálogo de dezenas de itens. Se o catálogo virar
 * milhares (importar a base do HueForge inteira), trocar por um Map montado uma
 * vez no módulo.
 */
export function findFilament(id: string): Filament | undefined {
  return FILAMENTS.find((f) => f.id === id)
}
