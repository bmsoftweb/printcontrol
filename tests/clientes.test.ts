import { describe, expect, it } from 'vitest';
import { dataPorExtenso, formataCnpj, preencherContrato } from '../src/modulos/clientes/contrato';

describe('contrato do cliente', () => {
  it('formata CPF/CNPJ como o FormataCNPJ do Delphi', () => {
    expect(formataCnpj('12345678909')).toBe('123.456.789-09');
    expect(formataCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(formataCnpj('123')).toBe('');
    expect(formataCnpj(null)).toBe('');
  });

  it('escreve a data por extenso', () => {
    expect(dataPorExtenso('2026-10-05')).toBe('05 de outubro de 2026');
    expect(dataPorExtenso('2026-03-21')).toBe('21 de março de 2026');
  });

  it('troca todas as variáveis, inclusive repetidas, e lista os equipamentos com letras', () => {
    const html = preencherContrato(
      '<p>@cliente@ (@cnpj@) @cliente@ - @rua@ @bairro@ @cidade@/@uf@ @cep@ - @representante@ @cpf@ - @data@</p>@equipamentos@',
      {
        nome: 'A & B LTDA',
        cpf_cnpj: '11222333000181',
        endereco: 'RUA X',
        endereco_nr: '10',
        endereco_bairro: 'CENTRO',
        endereco_cidade: 'ITAJAI',
        endereco_uf: 'SC',
        endereco_cep: '88300000',
        representante_legal_nome: 'JOAO',
        representante_legal_cpf: '123',
      },
      [
        { marca_descricao: 'HP', modelo: 'M428', nr_serie: 'S1' },
        { marca_descricao: 'RICOH', modelo: '4510', nr_serie: 'S2' },
      ],
      '2026-10-05',
    );
    expect(html).toContain('<p>A &amp; B LTDA (11.222.333/0001-81) A &amp; B LTDA - RUA X 10 CENTRO ITAJAI/SC 88300000 - JOAO 123 - 05 de outubro de 2026</p>');
    expect(html).toContain('a) 01 IMPRESSORA MARCA: <b>HP</b> - Modelo: <b>M428</b> - Numero Serie: <b>S1</b><br>');
    expect(html).toContain('b) 01 IMPRESSORA MARCA: <b>RICOH</b>');
    expect(html).not.toContain('@');
  });
});
