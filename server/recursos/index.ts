import type { ResourceDef } from '../schema.js';
import { RECURSOS_ACESSO } from './acesso.js';
import { RECURSOS_CLIENTES } from './clientes.js';
import { RECURSOS_CADASTROS } from './cadastros.js';
import { RECURSOS_LOCACOES } from './locacoes.js';
import { RECURSOS_FATURAMENTO } from './faturamento.js';
import { RECURSOS_OS } from './os.js';
import { RECURSOS_VENDAS } from './vendas.js';

/**
 * Todos os recursos do CRUD genérico, um arquivo por módulo do PrintControl.
 * A ordem aqui é a ordem em que aparecem nos metadados (o menu tem ordem própria em src/utils/menu.ts).
 */
export const RECURSOS_MODULOS: ResourceDef[] = [
  ...RECURSOS_ACESSO,
  ...RECURSOS_CLIENTES,
  ...RECURSOS_CADASTROS,
  ...RECURSOS_LOCACOES,
  ...RECURSOS_FATURAMENTO,
  ...RECURSOS_OS,
  ...RECURSOS_VENDAS,
];
