import { describe, expect, it } from 'vitest';
import {
  acertarGrupo,
  arredonda,
  calcularLeitura,
  contadoresDaColeta,
  contadoresALancar,
  derivarValoresContrato,
  recalcularLeitura,
  trunca,
  validarContrato,
  vencimentoEsperado,
  vencimentoLeitura,
  type LeituraGrupo,
} from '../src/modulos/locacoes/calculos';

const base = {
  leitura_anterior: 10000,
  leitura_atual: 11250,
  nr_copiar_total_anterior: 50000,
  nr_copias_total: 0,
  nr_copias_contrato: 1000,
  nr_copias_excedente: 0,
  valor_copia_unit: '0.20000',
  valor_copia_unit_excedente: '0.15000',
  valor_total_geral: 0,
};

describe('Trunca / Arredonda', () => {
  it('trunca nos centavos sem arredondar', () => {
    expect(trunca(333, '0.01999')).toBe(6.65); // 6,65667
    expect(trunca(250, '0.15')).toBe(37.5);
    expect(trunca(-333, '0.01999')).toBe(-6.65);
  });
  it('arredonda meio para o par', () => {
    expect(arredonda(1, '0.00500')).toBe(0); // 0,005 → 0,00
    expect(arredonda(3, '0.00500')).toBe(0.02); // 0,015 → 0,02
    expect(arredonda(333, '0.01999')).toBe(6.66);
  });
});

describe('Contrato', () => {
  const c = { nr_copias: 1000, valor_contrato: '200.00', valor_copia: 0, valor_excedente: 0, dia_leitura: 10, dia_vencimento: 20, serie_nf: '1' };
  it('valida na ordem do Delphi', () => {
    expect(validarContrato({ ...c, nr_copias: -1 })).toBe('Número de cópias inválido!');
    expect(validarContrato({ ...c, valor_contrato: 0 })).toBe('Digite o valor do contrato! (nr. cópias > 0)');
    expect(validarContrato({ ...c, nr_copias: 0, valor_contrato: 0 })).toBe('Escolha um valor de contrato ou valor de cópia!');
    expect(validarContrato({ ...c, dia_leitura: 0 })).toBe('Digite o dia da leitura!');
    expect(validarContrato({ ...c, serie_nf: '' })).toBe('Digite uma série para a nota fiscal!');
    expect(validarContrato(c)).toBeNull();
  });
  it('deriva valor da cópia e do excedente', () => {
    expect(derivarValoresContrato(c)).toEqual({ valor_copia: '0.20000', valor_excedente: '0.20000' });
    expect(derivarValoresContrato({ ...c, nr_copias: 3, valor_contrato: '100.00', valor_excedente: '0.5' })).toEqual({ valor_copia: '33.33333', valor_excedente: '0.50000' });
    expect(derivarValoresContrato({ ...c, nr_copias: 0, valor_contrato: 0, valor_copia: '0.06' })).toEqual({ valor_copia: '0.06000', valor_excedente: '0.06000' });
  });
});

describe('Leitura', () => {
  it('exemplo da spec: franquia 1.000 / R$ 200, excedente 0,15', () => {
    expect(calcularLeitura(base, '200.00', true)).toEqual({
      nr_copias_mes: 1250,
      nr_copias_total: 51250,
      nr_copias_excedente: 250,
      valor_copia_total: 200,
      valor_copia_total_excedente: 37.5,
      valor_total_geral: 237.5,
    });
  });
  it('livre: cópias × valor (truncado)', () => {
    const r = calcularLeitura({ ...base, nr_copias_contrato: 0, valor_copia_unit: '0.06333' }, 0, true);
    expect(r.valor_copia_total).toBe(79.16); // 1250 × 0,06333 = 79,1625
    expect(r.valor_total_geral).toBe(79.16);
  });
  it('mantém total digitado, excedente manual e total geral quando a leitura não mudou', () => {
    const r = calcularLeitura({ ...base, leitura_atual: 10500, nr_copias_total: 777, nr_copias_excedente: 40, valor_total_geral: 300 }, '200.00', false);
    expect(r.nr_copias_total).toBe(777);
    expect(r.nr_copias_excedente).toBe(40); // não estourou: override manual fica
    expect(r.valor_copia_total_excedente).toBe(6);
    expect(r.valor_total_geral).toBe(300);
  });
  it('recalcular zera excedente e acerto', () => {
    const r = recalcularLeitura(base, { id_cliente: 5, nr_serie: 'X', nr_copias: 2000, valor_contrato: '300.00', valor_copia: '0.15', valor_excedente: '0.1', codigo_grupo: 'G1' });
    expect(r.nr_copias_excedente).toBe(0);
    expect(r.valor_total_geral).toBe(300);
    expect(r.grupo_acertado).toBe('N');
  });
  it('vencimento da nova leitura', () => {
    expect(vencimentoLeitura('2026-10-05', 20)).toBe('2026-10-20');
    expect(vencimentoLeitura('2026-10-25', 20)).toBe('2026-11-20');
    expect(vencimentoLeitura('2026-10-31', 30)).toBe('2026-11-30');
    expect(vencimentoLeitura('2026-01-15', 31)).toBe('2026-01-31');
    expect(vencimentoLeitura('2026-02-05', 31)).toBe('2026-02-28');
    expect(vencimentoLeitura('2026-12-25', 10)).toBe('2027-01-10');
  });
  it('vencimento esperado da conferência', () => {
    expect(vencimentoEsperado(2026, 10, 10, 20)).toBe('2026-10-20');
    expect(vencimentoEsperado(2026, 10, 25, 5)).toBe('2026-11-05');
    expect(vencimentoEsperado(2026, 12, 25, 5)).toBe('2027-01-05');
    expect(vencimentoEsperado(2026, 10, 25, 0)).toBeNull();
  });
});

describe('Acertar valores do grupo', () => {
  const l = (id: number, mes: number, franquia: number, exc: number, total: number, extra: Partial<LeituraGrupo> = {}): LeituraGrupo => ({
    id,
    grupo_acertado: 'N',
    nr_copias_mes: mes,
    nr_copias_contrato: franquia,
    nr_copias_excedente: exc,
    valor_copia_total: 100,
    valor_copia_total_excedente: total - 100,
    valor_copia_unit_excedente: '0.10000',
    valor_total_geral: total,
    valor_contrato: 100,
    ...extra,
  });
  it('grupo não excedeu: zera excedentes', () => {
    const r = acertarGrupo([l(1, 1200, 1000, 200, 120), l(2, 500, 1000, 0, 100)]);
    expect(r.alteracoes).toHaveLength(2);
    expect(r.alteracoes[0]).toMatchObject({ valor_total_geral: 100, nr_copias_excedente: 0, nr_copias_excedente_original: 200, valor_copia_total_excedente_original: 20, grupo_acertado: 'S' });
  });
  it('grupo excedeu: excedente do grupo na de maior diferença', () => {
    const r = acertarGrupo([l(1, 900, 1000, 0, 100), l(2, 1505, 1000, 505, 150.5), l(3, 1100, 1000, 100, 110)]);
    expect(r.alteracoes[1]).toMatchObject({ nr_copias_excedente: 505, valor_copia_total_excedente: 50.5, valor_total_geral: 150.5 });
    expect(r.alteracoes[2]).toMatchObject({ nr_copias_excedente: 0, valor_total_geral: 100 });
  });
  it('excedeu sem nenhuma leitura acima da própria franquia: usa a maior diferença mesmo negativa', () => {
    const r = acertarGrupo([l(1, 900, 1000, 0, 100), l(2, 950, 0, 0, 100)]);
    expect(r.alteracoes[1]).toMatchObject({ nr_copias_excedente: 850 });
  });
  it('recusa grupo já acertado', () => {
    expect(acertarGrupo([l(1, 900, 1000, 0, 100, { grupo_acertado: 'S' })]).erro).toBe('Já existe uma leitura acertada!');
  });
  it('sem franquia: valor mínimo', () => {
    const r = acertarGrupo([l(1, 100, 0, 0, 30, { valor_contrato: 50 }), l(2, 100, 0, 0, 10, { valor_contrato: 50 })]);
    expect(r.alteracoes).toEqual([
      { id: 1, valor_total_geral: 50, grupo_acertado: 'S' },
      { id: 2, valor_total_geral: 50, grupo_acertado: 'S' },
    ]);
    expect(acertarGrupo([l(1, 100, 0, 0, 300, { valor_contrato: 50 })]).alteracoes).toEqual([]);
  });
});

describe('Lançar pré-leituras', () => {
  const item = { leitura_pb: 5000, leitura_pb_anterior: 4000, leitura_color: 800, leitura_color_anterior: 700 };
  it('colorida com dois contratos lança os dois contadores', () => {
    expect(contadoresALancar(item, ['N', 'S'])).toEqual([
      { color: 'N', anterior: 4000, atual: 5000 },
      { color: 'S', anterior: 700, atual: 800 },
    ]);
  });
  it('mono lança só P&B; contrato colorido sem contador colorido não lança', () => {
    expect(contadoresALancar({ ...item, leitura_color: 0 }, ['N', 'S'])).toEqual([{ color: 'N', anterior: 4000, atual: 5000 }]);
    expect(contadoresALancar({ ...item, leitura_color: 0 }, ['S'])).toEqual([]);
  });
});

describe('contadoresDaColeta (Scan Impressoras SNMP)', () => {
  it('monocromática usa o contador de vida, mesmo com split preto/cor errado (Brother)', () => {
    expect(contadoresDaColeta({ paginas: 274185, paginas_preto: 5, paginas_color: 5, colorida: 0 })).toEqual({ pb: 274185, cor: 0 });
  });
  it('colorida separa preto e cor', () => {
    expect(contadoresDaColeta({ paginas: 1500, paginas_preto: 1000, paginas_color: 500, colorida: 1 })).toEqual({ pb: 1000, cor: 500 });
  });
  it('colorida sem split: total como P&B', () => {
    expect(contadoresDaColeta({ paginas: 1500, paginas_preto: null, paginas_color: null, colorida: 1 })).toEqual({ pb: 1500, cor: 0 });
  });
  it('sem contador exposto: zero', () => {
    expect(contadoresDaColeta({ paginas: null, colorida: 0 })).toEqual({ pb: 0, cor: 0 });
  });
});
