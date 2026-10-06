import type { Tela } from './tipos';
import { TELA_INICIO } from './inicio';
import { TELAS_ACESSO } from './acesso';
import { TELAS_CLIENTES } from './clientes';
import { TELAS_CADASTROS } from './cadastros';
import { TELAS_LOCACOES } from './locacoes';
import { TELAS_FATURAMENTO } from './faturamento';
import { TELAS_OS } from './os';
import { TELAS_VENDAS } from './vendas';

/**
 * O que cada opção do menu (src/utils/menu.ts) abre. Um arquivo por módulo do PrintControl;
 * cada módulo exporta as suas telas e entra aqui.
 */
export const TELAS: Record<string, Tela> = {
  ...TELA_INICIO,
  ...TELAS_ACESSO,
  ...TELAS_CLIENTES,
  ...TELAS_CADASTROS,
  ...TELAS_LOCACOES,
  ...TELAS_FATURAMENTO,
  ...TELAS_OS,
  ...TELAS_VENDAS,
};
