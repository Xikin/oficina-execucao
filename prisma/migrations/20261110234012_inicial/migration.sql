-- CreateEnum
CREATE TYPE "StatusExecucao" AS ENUM ('NA_FILA', 'EM_DIAGNOSTICO', 'DIAGNOSTICADA', 'AGUARDANDO_REPARO', 'EM_REPARO', 'FINALIZADA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusReserva" AS ENUM ('RESERVADA', 'CONSUMIDA', 'LIBERADA');

-- CreateTable
CREATE TABLE "servicos" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(10,2) NOT NULL,
    "tempo_previsto" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pecas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(10,2) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "estoque_min" INTEGER NOT NULL DEFAULT 0,
    "unidade" TEXT NOT NULL DEFAULT 'un',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pecas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execucoes" (
    "id" TEXT NOT NULL,
    "ordem_id" TEXT NOT NULL,
    "saga_id" TEXT NOT NULL,
    "numero_os" INTEGER NOT NULL,
    "status" "StatusExecucao" NOT NULL,
    "descricao" TEXT,
    "veiculo_placa" TEXT,
    "veiculo_marca" TEXT,
    "veiculo_modelo" TEXT,
    "veiculo_ano" INTEGER,
    "observacao_diagnostico" TEXT,
    "motivo_encerramento" TEXT,
    "tempo_real_min" INTEGER,
    "diagnostico_iniciado_em" TIMESTAMP(3),
    "diagnosticada_em" TIMESTAMP(3),
    "liberada_em" TIMESTAMP(3),
    "reparo_iniciado_em" TIMESTAMP(3),
    "finalizada_em" TIMESTAMP(3),
    "encerrada_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execucoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_servico_execucao" (
    "id" TEXT NOT NULL,
    "execucao_id" TEXT NOT NULL,
    "servico_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL,
    "tempo_real" INTEGER,

    CONSTRAINT "itens_servico_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservas_peca" (
    "id" TEXT NOT NULL,
    "execucao_id" TEXT NOT NULL,
    "peca_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,
    "status" "StatusReserva" NOT NULL DEFAULT 'RESERVADA',

    CONSTRAINT "reservas_peca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_execucao" (
    "id" TEXT NOT NULL,
    "execucao_id" TEXT NOT NULL,
    "status_anterior" "StatusExecucao",
    "status_novo" "StatusExecucao" NOT NULL,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_execucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "cabecalhos" JSONB NOT NULL DEFAULT '{}',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicado_em" TIMESTAMP(3),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_processadas" (
    "id" TEXT NOT NULL,
    "consumidor" TEXT NOT NULL,
    "processada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_processadas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servicos_ativo_idx" ON "servicos"("ativo");

-- CreateIndex
CREATE INDEX "pecas_ativo_idx" ON "pecas"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "execucoes_ordem_id_key" ON "execucoes"("ordem_id");

-- CreateIndex
CREATE INDEX "execucoes_status_criado_em_idx" ON "execucoes"("status", "criado_em");

-- CreateIndex
CREATE INDEX "itens_servico_execucao_execucao_id_idx" ON "itens_servico_execucao"("execucao_id");

-- CreateIndex
CREATE INDEX "itens_servico_execucao_servico_id_idx" ON "itens_servico_execucao"("servico_id");

-- CreateIndex
CREATE INDEX "reservas_peca_execucao_id_idx" ON "reservas_peca"("execucao_id");

-- CreateIndex
CREATE INDEX "reservas_peca_peca_id_status_idx" ON "reservas_peca"("peca_id", "status");

-- CreateIndex
CREATE INDEX "historico_execucao_execucao_id_criado_em_idx" ON "historico_execucao"("execucao_id", "criado_em");

-- CreateIndex
CREATE INDEX "outbox_publicado_em_criado_em_idx" ON "outbox"("publicado_em", "criado_em");

-- AddForeignKey
ALTER TABLE "itens_servico_execucao" ADD CONSTRAINT "itens_servico_execucao_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "execucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_servico_execucao" ADD CONSTRAINT "itens_servico_execucao_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_peca" ADD CONSTRAINT "reservas_peca_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "execucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservas_peca" ADD CONSTRAINT "reservas_peca_peca_id_fkey" FOREIGN KEY ("peca_id") REFERENCES "pecas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_execucao" ADD CONSTRAINT "historico_execucao_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "execucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
