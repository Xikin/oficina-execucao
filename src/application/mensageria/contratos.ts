import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  COMANDOS,
  MensagemInvalidaError,
  SERVICO_EXECUCAO,
  type Mensagem,
  type MensagemSaida,
  type TipoEvento,
} from '../../domain/mensageria/mensagem';
import type { IRastreamento } from '../../domain/services/rastreamento.interface';

const envelopeSchema = z.object({
  id: z.string().min(1),
  tipo: z.string().min(1),
  versao: z.literal(1),
  sagaId: z.string().min(1),
  ordemId: z.string().uuid(),
  causadaPor: z.string().nullable(),
  origem: z.string().min(1),
  ocorridaEm: z.string().datetime(),
  dados: z.record(z.unknown()),
});

const numeroOS = z.number().int().positive();

const dadosPorComando = {
  [COMANDOS.ABRIR_DIAGNOSTICO]: z.object({
    numeroOS,
    descricao: z.string().nullish(),
    veiculo: z.object({
      placa: z.string(),
      marca: z.string(),
      modelo: z.string(),
      ano: z.number().int(),
    }),
  }),
  [COMANDOS.LIBERAR_EXECUCAO]: z.object({ numeroOS }),
  [COMANDOS.CANCELAR]: z.object({ numeroOS, motivo: z.string().min(1) }),
} as const;

export type Comando =
  | ({ tipo: typeof COMANDOS.ABRIR_DIAGNOSTICO } & z.infer<
      (typeof dadosPorComando)[typeof COMANDOS.ABRIR_DIAGNOSTICO]
    >)
  | ({ tipo: typeof COMANDOS.LIBERAR_EXECUCAO } & z.infer<
      (typeof dadosPorComando)[typeof COMANDOS.LIBERAR_EXECUCAO]
    >)
  | ({ tipo: typeof COMANDOS.CANCELAR } & z.infer<
      (typeof dadosPorComando)[typeof COMANDOS.CANCELAR]
    >);

export function lerEnvelope(bruto: unknown): Mensagem {
  const resultado = envelopeSchema.safeParse(bruto);
  if (!resultado.success)
    throw new MensagemInvalidaError(`Envelope inválido: ${resultado.error.issues[0]?.message}`);
  return resultado.data as Mensagem;
}

export function interpretarComando(mensagem: Mensagem): Comando {
  const schema = dadosPorComando[mensagem.tipo as keyof typeof dadosPorComando];
  if (!schema) throw new MensagemInvalidaError(`Comando desconhecido: ${mensagem.tipo}`);
  const dados = schema.safeParse(mensagem.dados);
  if (!dados.success)
    throw new MensagemInvalidaError(
      `Dados inválidos em ${mensagem.tipo}: ${dados.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  return { tipo: mensagem.tipo, ...dados.data } as Comando;
}

export function novoEvento(
  tipo: TipoEvento,
  execucao: { sagaId: string; ordemId: string; numeroOS: number },
  dados: Record<string, unknown>,
  causadaPor: string | null,
  rastreamento: IRastreamento,
): MensagemSaida {
  return {
    mensagem: {
      id: randomUUID(),
      tipo,
      versao: 1,
      sagaId: execucao.sagaId,
      ordemId: execucao.ordemId,
      causadaPor,
      origem: SERVICO_EXECUCAO,
      ocorridaEm: new Date().toISOString(),
      dados: { numeroOS: execucao.numeroOS, ...dados },
    },
    cabecalhos: rastreamento.cabecalhosDePropagacao(),
  };
}
