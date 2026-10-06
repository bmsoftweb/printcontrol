import type { Router } from 'express';
import { createAcessoRouter } from './acesso.js';
import { createClientesRouter } from './clientes.js';
import { createCadastrosRouter } from './cadastros.js';
import { createLocacoesRouter } from './locacoes.js';
import { createFaturamentoRouter } from './faturamento.js';
import { createOsRouter } from './os.js';
import { createVendasRouter } from './vendas.js';
import { createAreaClienteRouter } from './areaCliente.js';

/**
 * Routers de cada módulo (um arquivo server/<módulo>.ts por grupo de telas do PrintControl).
 * Importar o módulo também registra as regras do CRUD genérico dele (registrarRegras).
 */

/** Rotas internas: exigem usuário logado (res.locals: usuario, grupoId, empresaId) */
export const ROTAS_MODULOS: (() => Router)[] = [
  createAcessoRouter,
  createClientesRouter,
  createCadastrosRouter,
  createLocacoesRouter,
  createFaturamentoRouter,
  createOsRouter,
  createVendasRouter,
];

/** Rotas da Área do Cliente, montadas em /api/cliente (res.locals.cliente, grupoId) */
export const ROTAS_CLIENTE: (() => Router)[] = [createAreaClienteRouter];

/** Rotas sem login (ex.: cron) */
export const ROTAS_PUBLICAS: (() => Router)[] = [];
