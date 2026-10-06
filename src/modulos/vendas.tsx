import type { Tela } from './tipos';
import { TelaVendas } from './vendas/TelaVendas';

/** Telas do módulo vendas (ids das opções do menu em src/utils/menu.ts) */
export const TELAS_VENDAS: Record<string, Tela> = {
  vendas: { componente: TelaVendas },
};
