/**
 * Geração pesada fora da thread principal.
 *
 * O `generatePuzzle` roda aqui inteiro: ~2,5s e ~320MB de RSS numa placa de
 * 180mm não podem travar a aba. O resultado volta com os buffers TRANSFERIDOS
 * (`postMessage` com `transfer`) — copiar 5MB+ por valor custa caro e dobra o
 * RSS do instante.
 */
import { generatePuzzle } from '../generate.ts'
import type { MensagemGerar, MensagemDoWorker } from './client.ts'

// O `self` tipado como Window (lib DOM) trata `postMessage` como o do Window,
// com targetOrigin no segundo argumento — não aceita transferíveis. O cast
// abaixo explicita o contrato do worker.
const postar = (mensagem: MensagemDoWorker, transferíveis?: Transferable[]) => {
  ;(self as unknown as { postMessage(m: MensagemDoWorker, t?: Transferable[]): void }).postMessage(
    mensagem,
    transferíveis,
  )
}

// Um worker por geração (o client termina o anterior no `cancelar`), mas o
// guarda de propósito: se um segundo `gerar` chegar aqui, recusa em vez de
// corromper o resultado que está saindo.
let ocupado = false

self.onmessage = (e: MessageEvent<MensagemGerar>) => {
  const msg = e.data
  if (msg.tipo !== 'gerar') return
  if (ocupado) {
    postar({ tipo: 'erro', id: msg.id, mensagem: 'já existe uma geração em curso neste worker' })
    return
  }
  ocupado = true

  try {
    // ponytail: progresso em etapa grossa porque o generatePuzzle é uma chamada
    // síncrona só — o núcleo (M0–M3) não reporta fases, e mexer nele é proibido
    // nesta rodada. O degrau fica parado em 5% durante ~2,5s e salta a 100%.
    // Upgrade: rachar o generatePuzzle em fases (grade → cor → meshing → 3mf)
    // e emitir uma etapa por fase, com pct medido em tempo real.
    postar({ tipo: 'progresso', id: msg.id, etapa: 'gerando', pct: 5 })
    const resultado = generatePuzzle(msg.opts)
    postar({ tipo: 'progresso', id: msg.id, etapa: 'pronto', pct: 100 })

    const transferíveis = [
      resultado.threemf.buffer,
      resultado.stl.buffer,
      resultado.preview.data.buffer,
      resultado.mesh.positions.buffer,
      resultado.mesh.indices.buffer,
    ]
    postar({ tipo: 'resultado', id: msg.id, resultado }, transferíveis)
  } catch (err) {
    // a mensagem ORIGINAL do erro (a validação do núcleo escreve em português) —
    // nunca "erro desconhecido"
    postar({ tipo: 'erro', id: msg.id, mensagem: err instanceof Error ? err.message : String(err) })
  } finally {
    ocupado = false
  }
}