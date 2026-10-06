import { describe, it, expect } from 'vitest';
import { montarEnvio, htmlMinhasImpressoras, type ContratoCliente } from '../server/areaCliente';

const c = (id: number, extra: Partial<ContratoCliente> = {}): ContratoCliente => ({
  id, id_grupo: 1, id_empresa: 1, id_cliente: 7, id_equip: id * 10, marca_descricao: 'HP', modelo: 'M428', nr_serie: `NS${id}`, setor: 'FIN', rede_usb: 'R', ...extra,
});

describe('Área do Cliente: montarEnvio', () => {
  const contratos = [c(1), c(2)];

  it('pedido: grava só cilindro (bug do Delphi) e ignora linha zerada e contrato alheio', () => {
    const { os } = montarEnvio('pedido', contratos, [
      { contratoId: 1, qtdade: 0, qtdadeCil: 2, nome: 'Ana' },
      { contratoId: 2, qtdade: 0, qtdadeCil: 0 },
      { contratoId: 99, qtdade: 5 },
    ], '12.345.678/0001-95');
    expect(os).toHaveLength(1);
    expect(os[0]).toMatchObject({ tipo_os: 'R', qtdade: 0, qtdade_cil: 2, id_contrato: 1, id_equip: 10, cnpj_cliente: '12345678000195', equip_descricao: 'HP M428 FIN', status: 'A' });
  });

  it('pedido: quantidades negativas viram 0 e acima de 99 viram 99', () => {
    const { os } = montarEnvio('pedido', contratos, [{ contratoId: 1, qtdade: 500, qtdadeCil: -3 }], '');
    expect(os[0]).toMatchObject({ qtdade: 99, qtdade_cil: 0 });
  });

  it('reparo: só com problema, tipo C e qtdade 1', () => {
    const { os } = montarEnvio('reparo', contratos, [{ contratoId: 1, obs: '  ' }, { contratoId: 2, obs: 'Atolando papel', nome: 'Rui' }], '');
    expect(os).toEqual([expect.objectContaining({ tipo_os: 'C', qtdade: 1, obs: 'Atolando papel', nome_req: 'Rui', id_contrato: 2 })]);
  });

  it('leituras: soma P/B + Color > 0', () => {
    const { leituras, os } = montarEnvio('leituras', contratos, [{ contratoId: 1, leituraPb: 1500 }, { contratoId: 2, leituraPb: 0, leituraColor: 0 }], '');
    expect(os).toHaveLength(0);
    expect(leituras).toEqual([{ id_equip: 10, leitura_pb: 1500, leitura_color: 0 }]);
  });
});

it('htmlMinhasImpressoras escapa o texto e traz as colunas do .fr3', () => {
  const html = htmlMinhasImpressoras([c(1, { setor: '<b>X</b>' })], 'Locadora', '05/10/2026 - 10:00:00');
  expect(html).toContain('IMPRESSORAS LOCADAS');
  expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
  expect(html).toContain('NR. SÉRIE');
});
