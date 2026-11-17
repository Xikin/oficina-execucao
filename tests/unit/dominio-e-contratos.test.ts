import { describe, it, expect } from 'vitest';
import {
  dividirTempo,
  marcosDoStatus,
  permite,
  proximoStatus,
  TransicaoInvalidaError,
  type StatusExecucao,
} from '../../src/domain/execucao/execucao';
import {
  interpretarComando,
  lerEnvelope,
  novoEvento,
} from '../../src/application/mensageria/contratos';
import { COMANDOS, EVENTOS, MensagemInvalidaError } from '../../src/domain/mensageria/mensagem';
import { mensagem, rastreamento } from '../fixtures';

describe('máquina de estados da execução', () => {
  it.each([
    ['iniciarDiagnostico', 'NA_FILA', 'EM_DIAGNOSTICO'],
    ['concluirDiagnostico', 'EM_DIAGNOSTICO', 'DIAGNOSTICADA'],
    ['liberar', 'DIAGNOSTICADA', 'AGUARDANDO_REPARO'],
    ['iniciarReparo', 'AGUARDANDO_REPARO', 'EM_REPARO'],
    ['finalizar', 'EM_REPARO', 'FINALIZADA'],
    ['falhar', 'EM_REPARO', 'FALHOU'],
    ['falhar', 'AGUARDANDO_REPARO', 'FALHOU'],
    ['cancelar', 'DIAGNOSTICADA', 'CANCELADA'],
  ] as const)('%s: %s → %s', (acao, de, para) => {
    expect(proximoStatus(acao, de)).toBe(para);
  });

  it('não deixa iniciar reparo antes do pagamento liberar', () => {
    expect(() => proximoStatus('iniciarReparo', 'DIAGNOSTICADA')).toThrow(
      'Não é possível iniciar o reparo com a execução "Diagnosticada, aguardando aprovação e pagamento"',
    );
  });

  it.each(['FINALIZADA', 'FALHOU', 'CANCELADA'] as StatusExecucao[])(
    'execução %s não pode mais ser cancelada',
    (status) => {
      expect(permite('cancelar', status)).toBe(false);
      expect(() => proximoStatus('cancelar', status)).toThrow(TransicaoInvalidaError);
    },
  );

  it('registra o marco de data de cada status', () => {
    const agora = new Date('2026-11-10T10:00:00Z');
    expect(marcosDoStatus('EM_DIAGNOSTICO', agora)).toEqual({ diagnosticoIniciadoEm: agora });
    expect(marcosDoStatus('DIAGNOSTICADA', agora)).toEqual({ diagnosticadaEm: agora });
    expect(marcosDoStatus('AGUARDANDO_REPARO', agora)).toEqual({ liberadaEm: agora });
    expect(marcosDoStatus('EM_REPARO', agora)).toEqual({ reparoIniciadoEm: agora });
    expect(marcosDoStatus('FINALIZADA', agora)).toEqual({ finalizadaEm: agora });
    expect(marcosDoStatus('FALHOU', agora)).toEqual({ encerradaEm: agora });
    expect(marcosDoStatus('CANCELADA', agora)).toEqual({ encerradaEm: agora });
    expect(marcosDoStatus('NA_FILA', agora)).toEqual({});
  });

  it('divide o tempo real entre os serviços, com mínimo de 1 minuto', () => {
    expect(dividirTempo(90, 2)).toBe(45);
    expect(dividirTempo(1, 3)).toBe(1);
    expect(dividirTempo(30, 0)).toBeNull();
  });
});

describe('contratos de mensagem', () => {
  const abrir = {
    numeroOS: 7,
    descricao: 'x',
    veiculo: { placa: 'P', marca: 'M', modelo: 'X', ano: 2020 },
  };

  it('aceita o envelope e interpreta abrir diagnóstico', () => {
    const lido = lerEnvelope(mensagem(COMANDOS.ABRIR_DIAGNOSTICO, abrir));
    expect(interpretarComando(lido)).toMatchObject({
      tipo: COMANDOS.ABRIR_DIAGNOSTICO,
      numeroOS: 7,
    });
  });

  it('interpreta liberar e cancelar', () => {
    expect(interpretarComando(mensagem(COMANDOS.LIBERAR_EXECUCAO, { numeroOS: 7 })).tipo).toBe(
      COMANDOS.LIBERAR_EXECUCAO,
    );
    expect(
      interpretarComando(mensagem(COMANDOS.CANCELAR, { numeroOS: 7, motivo: 'x' })),
    ).toMatchObject({ motivo: 'x' });
  });

  it('rejeita envelope sem versão', () => {
    expect(() => lerEnvelope({ ...mensagem('x', {}), versao: 2 })).toThrow(MensagemInvalidaError);
  });

  it('rejeita comando desconhecido e dados inválidos', () => {
    expect(() => interpretarComando(mensagem('execucao.comando.voar', {}))).toThrow(/desconhecido/);
    expect(() => interpretarComando(mensagem(COMANDOS.CANCELAR, { numeroOS: 7 }))).toThrow(
      /motivo/,
    );
  });

  it('monta evento com origem, número da OS e rastreamento', () => {
    const saida = novoEvento(
      EVENTOS.EXECUCAO_INICIADA,
      { sagaId: 's', ordemId: 'o', numeroOS: 9 },
      { a: 1 },
      'causa',
      rastreamento,
    );
    expect(saida.mensagem).toMatchObject({
      tipo: EVENTOS.EXECUCAO_INICIADA,
      origem: 'oficina-execucao',
      causadaPor: 'causa',
      dados: { numeroOS: 9, a: 1 },
    });
    expect(saida.cabecalhos).toEqual({ traceparent: 'tp' });
  });
});
