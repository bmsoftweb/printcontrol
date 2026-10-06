import { describe, expect, it } from 'vitest';
import {
  aplicarVariaveis,
  dividirComandos,
  formatarColuna,
  formatarNumero,
  iconeTipoOs,
  montarPivot,
  motivoRecusa,
  parseParametros,
  parseTitulos,
  prepararSql,
  tituloAba,
  validarPeca,
  valorParametro,
} from '../src/modulos/os/regras';

describe('peças da OS', () => {
  it('aplica as regras do BeforePost na ordem', () => {
    expect(() => validarPeca({ qtdade: 0, qtdade_entregue: 0, valor_unit: 1 }, 0, 'A')).toThrow('Digite uma quantidade');
    expect(() => validarPeca({ qtdade: 3, qtdade_entregue: 0, valor_unit: 1 }, 2, 'A')).toThrow('igual a solicitada!');
    expect(() => validarPeca({ qtdade: 2, qtdade_entregue: 3, valor_unit: 1 }, 0, 'A')).toThrow('entregue inválida');
    expect(() => validarPeca({ qtdade: 2, qtdade_entregue: 1, valor_unit: 1 }, 0, 'T')).toThrow('entregue deve ser igual');
    expect(validarPeca({ qtdade: 2, qtdade_entregue: 1, valor_unit: 10.555 }, 0, 'A')).toBe(10.56);
    expect(validarPeca({ qtdade: 2, qtdade_entregue: 2, valor_unit: 1.5 }, 2, 'T')).toBe(3);
  });

  it('ícone do tipo', () => {
    expect(iconeTipoOs('R', '2 Cartucho(s)')).toBe('cartucho');
    expect(iconeTipoOs('R', '1 CILINDRO(s)')).toBe('cilindro');
    expect(iconeTipoOs('R', '')).toBe('requisicao');
    expect(iconeTipoOs('G', '')).toBe('recarga');
    expect(iconeTipoOs('C', 'cartucho')).toBe('servico');
  });

  it('variáveis do e-mail sem diferenciar maiúsculas', () => {
    expect(aplicarVariaveis(' Olá @NOME_CLIENTE, OS @nr_os ', { '@nome_cliente': 'ACME', '@nr_os': '00012' })).toBe('Olá ACME, OS 00012');
  });
});

describe('consultas', () => {
  it('lê os parâmetros (primeira ocorrência da chave vale)', () => {
    const p = parseParametros('par1=Data Inicial;d1;D;01/01/1980;\npar3=Cliente;id_cliente;P;2743;SELECT ID,NOME FROM PESSOAS ORDER BY NOME\npar3=Outro;x;T;;\npar2=Situação;p1;L;A;A-Aberto,R-Recebido');
    expect(p.map((x) => x.nome)).toEqual(['d1', 'p1', 'id_cliente']);
    expect(p[2].extra).toBe('SELECT ID,NOME FROM PESSOAS ORDER BY NOME');
    expect(valorParametro(p[0], '31/12/2024')).toBe('2024-12-31');
    expect(valorParametro(p[1], 'R-Recebido')).toBe('R');
    expect(valorParametro(p[2], '')).toBe('2743');
  });

  it('troca só tokens inteiros por ? (sem montar texto)', () => {
    const r = prepararSql(
      "SELECT * FROM x /* :d1 */ WHERE a = :id_grupo AND d BETWEEN ':d1' AND ':d10' AND n LIKE '%:nome%' AND h = '10:30' AND :id = 1 AND @v:=2",
      { id_grupo: 1, d1: '2024-01-01', d10: '2024-12-31', nome: "O'Brien", id: 7 },
    );
    expect(r.sql).toBe("SELECT * FROM x /* :d1 */ WHERE a = ? AND d BETWEEN ? AND ? AND n LIKE CONCAT('%', ?, '%') AND h = '10:30' AND ? = 1 AND @v:=2");
    expect(r.params).toEqual([1, '2024-01-01', '2024-12-31', "O'Brien", 7]);
  });

  it('aceita só leitura', () => {
    expect(motivoRecusa('/* t: Clientes */ SELECT REPLACE(nome, "a", "b") FROM pessoas')).toBeNull();
    expect(motivoRecusa('WITH c AS (SELECT 1) SELECT * FROM c')).toBeNull();
    expect(motivoRecusa("SELECT 'delete from x' AS texto")).toBeNull();
    expect(motivoRecusa('DELETE FROM pessoas')).not.toBeNull();
    expect(motivoRecusa('WITH c AS (SELECT 1) DELETE FROM pessoas')).not.toBeNull();
    expect(motivoRecusa('SELECT * FROM pessoas INTO OUTFILE "/tmp/x"')).not.toBeNull();
    expect(motivoRecusa('SELECT SLEEP(100)')).not.toBeNull();
    expect(motivoRecusa('CREATE TEMPORARY TABLE t SELECT 1')).not.toBeNull();
    expect(motivoRecusa('SELECT 1 /*! , (SELECT 2) */')).not.toBeNull();
  });

  it('divide comandos fora de textos e comentários', () => {
    expect(dividirComandos("SELECT ';' a; /* ; */ SELECT 2;\n")).toEqual(["SELECT ';' a", ' /* ; */ SELECT 2']);
  });

  it('títulos, colunas e formatos', () => {
    expect(tituloAba('/* t:  Vendas por mês */ SELECT 1', 1)).toBe('Vendas por mês');
    expect(tituloAba('SELECT 1', 2)).toBe('Consulta (2)');
    const t = parseTitulos('valor=Valor R$;90;,0.000\nnome=Cliente');
    expect(formatarColuna('VALOR', 'dec', 15, t)).toEqual({ campo: 'VALOR', titulo: 'Valor R$', largura: 120, tipo: 'dec', formato: ',0.000' });
    // a coluna seguinte não herda formato/largura da anterior (bug do Delphi)
    expect(formatarColuna('data_venc', 'date', 10, t)).toMatchObject({ titulo: 'Data Venc', largura: 150, formato: undefined });
    expect(formatarColuna('nome', 'str', 100, t).largura).toBe(400);
    expect(formatarNumero(1467.456, ',0.00')).toBe('1.467,46');
    expect(formatarNumero(5, '000')).toBe('005');
    expect(formatarNumero(2.5, '0.###')).toBe('2,5');
  });

  it('cubo soma por linhas e colunas', () => {
    const rows = [
      { cli: 'A', mes: '01', v: 10 },
      { cli: 'A', mes: '02', v: 5 },
      { cli: 'B', mes: '01', v: 1 },
      { cli: 'A', mes: '01', v: 2 },
    ];
    const p = montarPivot(rows, ['cli'], ['mes'], ['v']);
    expect(p.colunas).toEqual([['01'], ['02']]);
    expect(p.linhas).toEqual([
      { chaves: ['A'], valores: [[12], [5], [17]] },
      { chaves: ['B'], valores: [[1], [0], [1]] },
    ]);
    expect(p.totais).toEqual([[13], [5], [18]]);
  });
});
