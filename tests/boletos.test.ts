import { describe, expect, it } from 'vitest';
import {
  codigoBarrasSvg,
  codigoBarrasValido,
  dvNossoNumeroBB,
  extenso,
  fatorVencimento,
  feriados,
  gerarBoleto,
  modulo10,
  modulo11,
  proximoDiaUtil,
  strzero,
} from '../server/boletos';
import { gerarRemessa, lerRetorno, parametros, type CedenteCnab, type TituloCnab } from '../server/cnab';

describe('utilitários', () => {
  it('strzero corta à direita como o Delphi', () => {
    expect(strzero('123', 5)).toBe('00123');
    expect(strzero('1234567', 4)).toBe('4567');
  });
  it('módulos 10 e 11', () => {
    expect(modulo10('001900000')).toBe('9');
    expect(modulo11('000000000237')).toBe('2');
  });
});

describe('fator de vencimento (regra nova FEBRABAN)', () => {
  it('antes de 22/02/2025', () => {
    expect(fatorVencimento('1997-10-07')).toBe('0000');
    expect(fatorVencimento('2022-03-22')).toBe('8932');
    expect(fatorVencimento('2025-02-21')).toBe('9999');
  });
  it('a partir de 22/02/2025 recomeça em 1000 (o Delphi gerava 0000)', () => {
    expect(fatorVencimento('2025-02-22')).toBe('1000');
    expect(fatorVencimento('2025-02-23')).toBe('1001');
    expect(fatorVencimento('2026-10-05')).toBe(String(1000 + 590));
  });
});

describe('boletos — exemplos reais do PrintControl antigo', () => {
  it('Santander 033 (boleto.log)', () => {
    const b = gerarBoleto({ cod_banco: '033', cod_cedente: '0065622', cod_carteira: '101' }, { nossoNumero: 237, vencimento: '2022-03-22', valor: 174.7 });
    expect(b.codigoBarras).toBe('03393893200000174709006562200000000023720101');
    expect(b.linhaDigitavel).toBe('03399.00656 62200.000008 00237.201017 3 89320000017470');
    expect(b.nossoNumero).toBe('000000000237');
    expect(b.nossoNumeroDig).toBe('2');
  });
  it('Banco do Brasil 001 (exportação de contas a receber)', () => {
    const b = gerarBoleto({ cod_banco: '001', cod_convenio: '3432568', cod_carteira: '17' }, { nossoNumero: 10035, vencimento: '2022-11-15', valor: '147.80' });
    expect(b.codigoBarras).toBe('00191917000000147800000003432568000001003517');
    expect(b.linhaDigitavel).toBe('00190.00009 03432.568008 00010.035178 1 91700000014780');
    expect(b.nossoNumero).toBe('34325680000010035');
  });
  it('Banco do Brasil: outro título real', () => {
    const b = gerarBoleto({ cod_banco: '001', cod_convenio: '3432568', cod_carteira: '17' }, { nossoNumero: 10029, vencimento: '2022-11-22', valor: 100 });
    expect(b.codigoBarras).toBe('00191917700000100000000003432568000001002917');
    expect(b.linhaDigitavel).toBe('00190.00009 03432.568008 00010.029171 1 91770000010000');
  });
  it('DV do nosso número BB: resto 0 vira "0" (o Delphi deixava vazio) e 10 vira X', () => {
    const casos = Array.from({ length: 200 }, (_, i) => dvNossoNumeroBB('3432568' + strzero(i, 10)));
    expect(casos.every((d) => /^[0-9X]$/.test(d))).toBe(true);
    expect(casos).toContain('X');
    expect(casos).toContain('0');
  });
  it('Ailos 085: estrutura, fator novo e DVs', () => {
    const b = gerarBoleto(
      { cod_banco: '085', cod_convenio: '115004', cod_cedente: '01052462', cod_carteira: '01' },
      { nossoNumero: 2255, vencimento: '2025-07-30', valor: '600.40' },
    );
    expect(b.codigoBarras).toHaveLength(44);
    expect(codigoBarrasValido(b.codigoBarras)).toBe(true);
    expect(b.codigoBarras.slice(5, 9)).toBe(fatorVencimento('2025-07-30'));
    expect(b.codigoBarras.slice(9, 19)).toBe('0000060040');
    expect(b.codigoBarras.slice(19)).toBe('115004' + '01052462000002255' + '01');
    expect(b.nossoNumero).toBe('01052462000002255');
    expect(b.nossoNumeroDig).toBe('');
    const [c1, c2, c3, dv, fv] = b.linhaDigitavel.split(' ');
    expect(c1).toBe('08591.1500' + modulo10('085911500'));
    expect(c2.replace('.', '')).toBe('4010524620' + modulo10('4010524620'));
    expect(c3.replace('.', '')).toBe('0000225501' + modulo10('0000225501'));
    expect(dv).toBe(b.codigoBarras[4]);
    expect(fv).toBe(b.codigoBarras.slice(5, 19));
  });
  it('banco sem layout e cadastro incompleto dão erro claro', () => {
    expect(() => gerarBoleto({ cod_banco: '341' }, { nossoNumero: 1, vencimento: '2026-01-10', valor: 10 })).toThrow(/não emite boleto/);
    expect(() => gerarBoleto({ cod_banco: '033', cod_cedente: '65622' }, { nossoNumero: 1, vencimento: '2026-01-10', valor: 10 })).toThrow(/7 dígitos/);
  });
  it('SVG I2of5 com o número certo de barras', () => {
    const svg = codigoBarrasSvg('03393893200000174709006562200000000023720101');
    expect(svg).toContain('<svg');
    expect((svg.match(/<rect/g) || []).length).toBe(2 + 22 * 5 + 2); // início 2 barras + 5 por par de dígitos + fim 2
  });
});

describe('código de barras I2of5', () => {
  it('as barras decodificam de volta os 44 dígitos', () => {
    const codigo = '00191917000000147800000003432568000001003517';
    const svg = codigoBarrasSvg(codigo);
    const rects = [...svg.matchAll(/x="(\d+)" y="0" width="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // larguras alternadas barra/espaço a partir das posições
    const larg: number[] = [];
    rects.forEach(([x, w], i) => {
      if (i) larg.push(x - (rects[i - 1][0] + rects[i - 1][1]));
      larg.push(w);
    });
    const corpo = larg.slice(4, -3); // sem início (4) e fim (3)
    const tab = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
    let lido = '';
    for (let i = 0; i < corpo.length; i += 10) {
      const p = corpo.slice(i, i + 10).map((w) => (w === 3 ? 'w' : 'n'));
      lido += tab.indexOf(p.filter((_, k) => k % 2 === 0).join('')) + '' + tab.indexOf(p.filter((_, k) => k % 2 === 1).join(''));
    }
    expect(lido).toBe(codigo);
  });
});

describe('extenso', () => {
  it('como o GetExtenso', () => {
    expect(extenso(1234.56)).toBe('UM MIL, DUZENTOS E TRINTA E QUATRO REAIS E CINQUENTA E SEIS CENTAVOS');
    expect(extenso(1)).toBe('UM REAL');
    expect(extenso(100)).toBe('CEM REAIS');
    expect(extenso(101.01)).toBe('CENTO E UM REAIS E UM CENTAVO');
    expect(extenso(1000000)).toBe('UM MILHAO DE REAIS');
    expect(extenso(2015)).toBe('DOIS MIL E QUINZE REAIS');
    expect(extenso(0.5)).toBe('CINQUENTA CENTAVOS');
    expect(extenso(0)).toBe('ZERO');
  });
});

describe('dias úteis', () => {
  it('feriados móveis', () => {
    const f = feriados(2026);
    expect(f.has('2026-04-03')).toBe(true); // Sexta-feira Santa
    expect(f.has('2026-02-16') && f.has('2026-02-17')).toBe(true); // Carnaval
    expect(f.has('2026-06-04')).toBe(true); // Corpus Christi
  });
  it('próximo dia útil', () => {
    expect(proximoDiaUtil('2026-10-05', 1)).toBe('2026-10-06'); // segunda → terça
    expect(proximoDiaUtil('2026-10-09', 1)).toBe('2026-10-13'); // sexta → (12/10 feriado) terça
    expect(proximoDiaUtil('2026-10-10', 1)).toBe('2026-10-14'); // sábado: ajusta p/ 13 e avança
  });
});

const cedente = (cod: string): CedenteCnab => ({
  cod_banco: cod,
  cod_agencia: cod === '033' ? '3059' : cod === '085' ? '115' : '8126',
  cod_agencia_dig: cod === '033' ? '7' : cod === '085' ? '5' : '4',
  cod_conta: cod === '033' ? '13082059' : cod === '085' ? '105246' : '166',
  cod_conta_dig: cod === '033' ? '1' : cod === '085' ? '2' : 'X',
  cod_cedente: cod === '033' ? '0065622' : '01052462',
  cod_convenio: cod === '001' ? '3432568' : '115004',
  cod_carteira: cod === '001' ? '17' : cod === '085' ? '01' : '101',
  nome: 'VIACRED ALTO VALE',
  codigos_remessa: cod === '001' ? 'variacao_carteira=027' : '',
  cnpj: '37339190000186',
  razao_social: 'Móveis Exemplo Ltda',
});
const titulo = (id: number, valor: string): TituloCnab => ({
  id,
  serie: '01',
  numero: 13890 + id,
  nossoNumero: '01052462000014235',
  nossoNumeroDig: '',
  vencimento: '2025-07-04', // sexta → juros/multa a partir de segunda 07/07
  emissao: '2025-06-25',
  valor,
  cpfCnpj: '12.345.678/0001-95',
  nome: 'Cliente Ação Teste UU B',
  endereco: 'Rua Um, 10',
  bairro: 'Centro',
  cep: '89160-000',
  cidade: 'Rio do Sul',
  uf: 'SC',
});
const opcoes = { sequencial: 12, data: '2025-06-25', hora: '162330', jurosMes: 6, multaPerc: 2 };

describe('remessa CNAB 240', () => {
  it('Ailos: todas as linhas com 240 posições, seq, trailer com títulos e total', () => {
    const linhas = gerarRemessa(cedente('085'), [titulo(4001, '1958.30'), titulo(4002, '1.49')], opcoes).split('\r\n').slice(0, -1);
    expect(linhas.every((l) => l.length === 240)).toBe(true);
    expect(linhas).toHaveLength(2 + 2 * 3 + 2);
    const [ha, hl, p, q, r] = linhas;
    expect(ha.slice(0, 8)).toBe('08500000');
    expect(ha.slice(18, 32)).toBe('37339190000186');
    expect(ha.slice(52, 72)).toBe('001155000000105246' + '2 ');
    expect(ha.slice(143, 171)).toBe('25062025162330000012' + '08401600');
    expect(hl.slice(183, 199)).toBe('0000001225062025');
    expect(p.slice(8, 14)).toBe('00001P');
    expect(p.slice(37, 54)).toBe('01052462000014235');
    expect(p.slice(62, 77)).toBe('000000000004001');
    expect(p.slice(85, 100)).toBe('000000000195830');
    expect(p.slice(117, 141)).toBe('1' + '04072025' + '000000000000392'); // 1958,30 × 6%/30 = 3,9166 → 3,92
    expect(p.slice(195, 220)).toBe('0100017891000000000004001');
    expect(q.slice(17, 33)).toBe('2' + '012345678000195');
    expect(q.slice(33, 73)).toBe('Cliente Acao Teste UU B'.padEnd(40)); // sem acento, "UU"/"B" intactos
    expect(q.slice(151, 153)).toBe('SC');
    expect(r.slice(65, 89)).toBe('2' + '07072025' + '000000000000200');
    const tl = linhas[8];
    expect(tl.slice(17, 46)).toBe('000008' + '000002' + '00000000000195979');
    expect(linhas[9].slice(17, 35)).toBe('000001000010000000');
  });
  it('BB: convênio/variação do cadastro e sem juros → tipo 3', () => {
    const linhas = gerarRemessa(cedente('001'), [titulo(1, '100.00')], { ...opcoes, jurosMes: 0 }).split('\r\n').slice(0, -1);
    expect(linhas.every((l) => l.length === 240)).toBe(true);
    expect(linhas[0].slice(32, 71)).toBe('003432568001417027  081264000000000166X');
    expect(linhas[2].slice(117, 118)).toBe('3');
    expect(linhas[0].slice(157, 163)).toBe('000012'); // sequencial do cadastro (o Delphi usava 1 fixo)
  });
  it('Santander: sem segmento R, nosso número com DV em 13', () => {
    const t = { ...titulo(7, '50.00'), nossoNumero: '000000000237', nossoNumeroDig: '2' };
    const linhas = gerarRemessa(cedente('033'), [t], opcoes).split('\r\n').slice(0, -1);
    expect(linhas).toHaveLength(2 + 2 + 2);
    expect(linhas[0].slice(32, 47)).toBe('305900000065622');
    expect(linhas[2].slice(17, 44)).toBe('3059701308205910130820591  ');
    expect(linhas[2].slice(44, 57)).toBe('0000000002372');
    expect(linhas[4].slice(17, 23)).toBe('000004');
  });
});

describe('retorno CNAB 240', () => {
  const codigos = '06=LIQUIDACAO (B)\n02=ENTRADA CONFIRMADA\n03=ENTRADA REJEITADA (E)';
  const erros = 'A4=PAGADOR DDA\n08=NOSSO NUMERO INVALIDO';
  const linhaT = (oc: string, ident: string, nominal: string, err = '') => {
    const r = Array(240).fill(' ');
    const put = (p: number, s: string) => s.split('').forEach((c, i) => (r[p - 1 + i] = c));
    put(1, '0850000300001T ');
    put(16, oc);
    put(38, '01052462000014235');
    put(74, '04072025');
    put(82, nominal);
    put(106, ident);
    put(133, '2');
    put(134, '012345678000195');
    put(149, 'CLIENTE TESTE');
    put(209, err);
    return r.join('');
  };
  const linhaU = (pago: string) => {
    const r = Array(240).fill('0');
    const put = (p: number, s: string) => s.split('').forEach((c, i) => (r[p - 1 + i] = c));
    put(1, '0850000300002U ');
    put(18, '000000000000150');
    put(78, pago);
    put(138, '08072025');
    put(146, '09072025');
    return r.join('');
  };
  it('lê T/U: valor nominal do T (não do pago), id da nota, datas, baixa', () => {
    const txt = ['header', linhaT('06', '0100017891000000000004001', '000000000195830'), linhaU('000000000195980'), 'trailer'].join('\r\n');
    const [r] = lerRetorno(txt, codigos, erros);
    expect(r.idNota).toBe(4001);
    expect(r.valorNominal).toBe(1958.3);
    expect(r.valorPago).toBe(1959.8);
    expect(r.valorJuros).toBe(1.5);
    expect(r.dataOcorrencia).toBe('2025-07-08');
    expect(r.dataCredito).toBe('2025-07-09');
    expect(r.baixar).toBe('S');
    expect(r.cnpj).toBe('12345678000195');
  });
  it('ocorrência de erro traz as descrições; ident fora do padrão não vira id', () => {
    const txt = [linhaT('03', '1 006075020000014323', '000000000001000', 'A408'), linhaU('000000000000000')].join('\n');
    const [r] = lerRetorno(txt, codigos, erros);
    expect(r.baixar).toBe('E');
    expect(r.idNota).toBeNull();
    expect(r.erros).toEqual([
      { codigo: 'A4', descricao: 'PAGADOR DDA' },
      { codigo: '08', descricao: 'NOSSO NUMERO INVALIDO' },
    ]);
    expect(r.obs).toBe('PAGADOR DDA');
  });
  it('parâmetros chave=valor', () => {
    expect(parametros('a=1\r\nB = dois\nlixo')).toEqual({ a: '1', b: 'dois' });
  });
});
