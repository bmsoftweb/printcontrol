import { describe, expect, it } from 'vitest';
import { colunasImposto, contido, escolherFormula, executarScript, lerVariaveis, prepararScript, variaveisIniciais, type FormulaImposto } from '../server/formulas';

describe('interpretador das fórmulas de imposto', () => {
  it('roda o exemplo do Delphi (prg.txt) com IF/ELSE e atribuições sem ponto e vírgula', () => {
    const script = `
      // cfop pela operação
      IF operacao.es="S" THEN {
       produto.cfop:="5102"
      } ELSE {
       produto.cfop:="1102"
      }
      IF operacao.codigo="DEV" THEN { produto.cfop:="1202" }
      icms.cst := "00"; /* comentário */
      icms.pICMS:=17;
      icms.vBC:=produto.valorLiquido;
      icms.vICMS:=produto.valorLiquido * (icms.pICMS/100);
      end.
      icms.cst:="99";`;
    const r = executarScript(script, { 'operacao.es': 'S', 'operacao.codigo': 'VEN', 'produto.valorLiquido': 200, 'produto.cfop': '', 'icms.cst': '' });
    expect(r.erro).toBeUndefined();
    expect(r.variaveis['produto.cfop']).toBe('5102');
    expect(r.variaveis['icms.cst']).toBe('00'); // depois do END. nada roda
    expect(r.variaveis['icms.vICMS']).toBeCloseTo(34);
  });

  it('traduz o Portugol', () => {
    const r = executarScript('<SE> cliente.uf <> empresa.uf <ENTAO> produto.cfop:="6102" <SENAO> produto.cfop:="5102" <FIM> <fimscript>', {
      'cliente.uf': 'PR',
      'empresa.uf': 'SC',
      'produto.cfop': '',
    });
    expect(r.erro).toBeUndefined();
    expect(r.variaveis['produto.cfop']).toBe('6102');
    expect(prepararScript('<SE> a <ENTAO> b := 1 <FIM>')).toBe('IF a THEN { b:=1 }');
  });

  it('operadores, funções, IN, WHILE, PROCEDURE/EXEC', () => {
    const r = executarScript(
      `PROCEDURE dobra { x:=x*2 }
       x:=1; n:=0;
       WHILE n < 5 DO { n:=n+1; EXEC dobra; IF n = 3 THEN { BREAK } }
       ok := n in [1,3,5] AND NOT (x = 0);
       t := upper("abc") || copy("12345", 2, 2);
       r := round(10/3, 2) + 7 mod 4 + 7 div 2;
       p := iff(x > 4, "sim", "nao");`,
      {},
    );
    expect(r.erro).toBeUndefined();
    expect(r.variaveis).toMatchObject({ x: 8, n: 3, ok: 1, t: 'ABC23', p: 'sim' });
    expect(r.variaveis.r).toBeCloseTo(3.33 + 3 + 3);
  });

  it('erros não derrubam: devolvem a mensagem', () => {
    expect(executarScript('x := y + 1', {}).erro).toMatch(/Variável desconhecida: y/);
    expect(executarScript('IF 1 THEN { x:=1', {}).erro).toMatch(/chaves/);
    expect(executarScript('WHILE 1 DO { x:=1 }', {}).erro).toMatch(/WHILE/);
    expect(executarScript('x := 1/0', {}).erro).toMatch(/Divisão por zero/);
  });

  it('lê variaveis.txt e devolve as colunas de nfe_impostos_produtos', () => {
    const v = lerVariaveis('/*empresa*/\nempresa.uf="SC"\n// x\nproduto.quantidade=2.5\nicms.cst=""');
    expect(v).toEqual({ 'empresa.uf': 'SC', 'produto.quantidade': 2.5, 'icms.cst': '' });
    const ini = variaveisIniciais({
      empresa: { cnpj: '1', regime: '1', uf: 'SC' },
      operacao: { id: 1, es: 'S', codigo: 'VEN', tipo: 'V', apelido: 'VENDA' },
      cliente: { uf: 'SC', tipo: 'A' },
      produto: { id: 5, ean: '', un: 'UN', tipo: 'A', ncm: '84433299', cest: '', origem: '0', quantidade: 1, valorBruto: 10, acrescimo: 0, desconto: 0, valorLiquido: 10 },
    });
    const r = executarScript('icms.csosn:="102"; pis.CST:="07"; icms.vBC:=10/3', ini);
    const c = colunasImposto(r.variaveis);
    expect(c.icms_CSOSN).toBe('102');
    expect(c.pis_CST).toBe('07');
    expect(c.icms_CST).toBeNull();
    expect(c.icms_vBC).toBe(3.3333);
  });
});

describe('escolha da fórmula (7 níveis)', () => {
  const f = (id: number, x: Partial<FormulaImposto>): FormulaImposto => ({
    id,
    uf: null,
    operacao_codigo: null,
    ncm: null,
    id_produto: null,
    id_cliente: null,
    tipo_imposto_produto: null,
    tipo_imposto_cliente: null,
    script_calculo: '',
    ...x,
  });
  const dados = { uf: 'SC', operacao: 'VEN', ncm: '84433299', idProduto: 5, idCliente: 7, tipoProduto: 'A', tipoCliente: 'B' };

  it('compara por elemento da lista (id 5 não casa com "15")', () => {
    expect(contido(5, '15;25')).toBe(false);
    expect(contido(5, '15; 5')).toBe(true);
    expect(contido('', null)).toBe(true);
    expect(contido('SC', null)).toBe(false);
  });

  it('prefere o nível mais específico e, no mesmo nível, o menor id', () => {
    const lista = [
      f(1, { uf: 'SC;PR' }),
      f(2, { uf: 'SC', operacao_codigo: 'VEN' }),
      f(3, { uf: 'SC', operacao_codigo: 'VEN', ncm: '84433299', id_produto: '15' }),
      f(4, { uf: 'SC', operacao_codigo: 'VEN', ncm: '84433299' }),
    ];
    // nível 5 (UF+operação+NCM) ignora o produto: casa 3 e 4, vale o menor id, como o Delphi
    expect(escolherFormula(lista, dados)?.id).toBe(3);
    expect(escolherFormula([lista[3], lista[2]], { ...dados, idProduto: 15 })?.id).toBe(3);
    expect(escolherFormula(lista, { ...dados, ncm: '1' })?.id).toBe(2);
    expect(escolherFormula(lista, { ...dados, operacao: 'DEV' })?.id).toBe(1);
    expect(escolherFormula(lista, { ...dados, uf: 'SP' })).toBeNull();
  });
});
