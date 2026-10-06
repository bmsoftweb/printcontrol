import { describe, expect, it } from 'vitest';
import { formatarEtiquetaVoid, recalcularKardex } from '../src/modulos/cadastros/calculos';

describe('etiquetas VOID', () => {
  const hoje = { mes: 10, ano: 2026 };
  it('preenche [N…] com zeros no tamanho do token', () => {
    expect(formatarEtiquetaVoid('[NNNNNN]', 42, hoje)).toBe('000042');
    expect(formatarEtiquetaVoid('V[NNN]-[N]', 7, hoje)).toBe('V007-7');
  });
  it('número maior que o token mantém os dígitos da direita', () => {
    expect(formatarEtiquetaVoid('[NNN]', 12345, hoje)).toBe('345');
  });
  it('troca [MM] e [AAAA] pela data', () => {
    expect(formatarEtiquetaVoid('[AAAA][MM]-[NNNN]', 5, { mes: 3, ano: 2026 })).toBe('202603-0005');
  });
  it('texto sem tokens fica igual (repetidos são ignorados no servidor)', () => {
    expect(formatarEtiquetaVoid('FIXO', 1, hoje)).toBe('FIXO');
  });
});

describe('kardex: custo médio móvel', () => {
  it('entradas refazem o custo médio e saídas baixam por ele', () => {
    const r = recalcularKardex([
      { id: 1, ES: 'E', qtdade_mov: 10, valor_total_mov: 100 },
      { id: 2, ES: 'E', qtdade_mov: 10, valor_total_mov: 200 },
      { id: 3, ES: 'S', qtdade_mov: 5, valor_total_mov: 0 },
    ]);
    expect(r[0]).toMatchObject({ qtdade_saldo: 10, valor_custo_medio_unit: 10, valor_total_estoque: 100, valor_unit_mov: 10 });
    expect(r[1]).toMatchObject({ qtdade_saldo: 20, valor_custo_medio_unit: 15, valor_total_estoque: 300 });
    expect(r[2]).toMatchObject({ qtdade_saldo: 15, valor_total_mov: 75, valor_total_estoque: 225, valor_custo_medio_unit: 15 });
  });
  it('saldo zerado não divide por zero', () => {
    const r = recalcularKardex([
      { id: 1, ES: 'S', qtdade_mov: 1, valor_total_mov: 0 },
      { id: 2, ES: 'E', qtdade_mov: 1, valor_total_mov: 10 },
    ]);
    expect(r[1]).toMatchObject({ qtdade_saldo: 0, valor_custo_medio_unit: 0 });
  });
});
