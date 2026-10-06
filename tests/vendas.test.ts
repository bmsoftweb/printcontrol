import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { avancarIntervalo, dividirMoeda, gerarParcelas, getNumeroVale, refazerParcelas, seriesAceitas, simularCondicoes, totalizarVenda, type Condicao } from '../server/vendas';
import { canonicalizar, assinar, conferirAssinatura } from '../server/nfe/assinatura';
import { gerarNFe } from '../server/nfe/gerarNFe';
import { configDaEmpresa } from '../server/nfe/contexto';
import { montarDocumento } from '../server/nfe/documento';
import { PADROES_128, code128C, htmlDanfe } from '../server/nfe/danfe';
import { chaveValida } from '../server/nfe/chave';
import { montarEvento } from '../server/nfe/operacoes';

const cond = (x: Partial<Condicao>): Condicao => ({ id: 1, apelido: 'X', nr_parcelas: 1, entrada: 'N', intervalo: 30, juros_mes: 0, id_banco: 2, ...x });

describe('parcelas do fechamento (§7)', () => {
  it('3x sem entrada a cada 30 dias, 1ª acerta a diferença', () => {
    const p = gerarParcelas(100, cond({ nr_parcelas: 3 }), '2026-01-31', 'BB');
    expect(p.map((x) => x.vencimento)).toEqual(['2026-02-28', '2026-03-28', '2026-04-28']);
    expect(p.map((x) => x.valor)).toEqual([33.34, 33.33, 33.33]);
    expect(p[0]).toMatchObject({ nr: 1, id_banco: 2, banco: 'BB', status: 'A' });
  });

  it('com entrada: 1ª hoje e parcelas inteiras; intervalo 15 = 14 dias', () => {
    const p = gerarParcelas(100, cond({ nr_parcelas: 3, entrada: 'S', intervalo: 15 }), '2026-10-05', '');
    expect(p.map((x) => x.vencimento)).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
    expect(p.map((x) => x.valor)).toEqual([34, 33, 33]);
  });

  it('refazer: digitadas ficam e a última acerta; sem digitadas, a 1ª', () => {
    const base = gerarParcelas(100, cond({ nr_parcelas: 3 }), '2026-10-05', '');
    const comDigitada = refazerParcelas([{ ...base[0], valor: 50, status: 'D' }, base[1], base[2]], 100, cond({ nr_parcelas: 3 }), 'X');
    expect(comDigitada.map((x) => x.valor)).toEqual([50, 25, 25]);
    const r = refazerParcelas([{ ...base[0], valor: 10, status: 'D' }, base[1], base[2]], 100, cond({ nr_parcelas: 3 }), 'X');
    expect(r.map((x) => x.valor)).toEqual([10, 45, 45]);
    const tres = refazerParcelas([{ ...base[0], valor: 20, status: 'D' }, { ...base[1], valor: 20, status: 'D' }, base[2]], 100.01, cond({ nr_parcelas: 3 }), 'X');
    expect(tres.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(100.01);
    expect(refazerParcelas(base, 100, cond({ nr_parcelas: 3 }), 'X').map((x) => x.valor)).toEqual([33.34, 33.33, 33.33]);
  });

  it('intervalos e DividirMoeda', () => {
    expect(avancarIntervalo('2026-10-05', 7)).toBe('2026-10-12');
    expect(avancarIntervalo('2026-10-05', 21)).toBe('2026-10-26');
    expect(avancarIntervalo('2026-10-05', 10)).toBe('2026-10-15');
    expect(avancarIntervalo('2028-01-31', 30)).toBe('2028-02-29');
    expect(dividirMoeda(100, 3)).toBe(33.33);
    expect(dividirMoeda(100, 3, 0)).toBe(33);
    expect(dividirMoeda(100, 0)).toBe(0);
  });
});

describe('Totalizar (§4)', () => {
  const itens = [
    { id: 1, valor_total_bruto: 10, valor_desconto: 0, valor_acrescimo: 0, valor_total_liquido: 10 },
    { id: 2, valor_total_bruto: 10, valor_desconto: 0, valor_acrescimo: 0, valor_total_liquido: 10 },
    { id: 3, valor_total_bruto: 11, valor_desconto: 1, valor_acrescimo: 0, valor_total_liquido: 10 },
  ];

  it('rateio arredondado com a diferença no último item: Σ itens = total da venda', () => {
    const t = totalizarVenda({ valor_desconto_digitado: 1, valor_acrescimo_digitado: 0 }, itens, 5);
    expect(t.venda).toMatchObject({
      valor_total_bruto: 31,
      valor_desconto_itens: 1,
      valor_total_liquido_antes_desconto_nf: 30,
      perc_acrescimo_plano: 5,
      valor_acrescimo_plano: 1.5,
      perc_desconto_digitado: 3.33,
      valor_desconto_total: 2,
      valor_acrescimo_total: 1.5,
      valor_total_liquido: 30.5,
    });
    expect(t.itens.map((i) => i.valor_desconto_rateio_digitado)).toEqual([0.33, 0.33, 0.34]);
    expect(t.itens.map((i) => i.item)).toEqual([1, 2, 3]);
    expect(t.itens.reduce((s, i) => s + i.valor_total_liquido_final, 0)).toBeCloseTo(30.5, 10);
  });

  it('juros negativo vira desconto do plano; venda vazia zera', () => {
    const t = totalizarVenda({ valor_desconto_digitado: 0, valor_acrescimo_digitado: 0 }, itens, -10);
    expect(t.venda).toMatchObject({ perc_desconto_plano: 10, valor_desconto_plano: 3, valor_total_liquido: 27 });
    expect(totalizarVenda({ valor_desconto_digitado: 5, valor_acrescimo_digitado: 0 }, [], 0).venda.perc_desconto_digitado).toBe(0);
  });

  it('painel de condições e séries aceitas', () => {
    expect(simularCondicoes(100, [cond({ nr_parcelas: 3, entrada: 'S', juros_mes: 3 })])[0]).toMatchObject({ nr_vezes: '1+2', parcela: 34.33 });
    expect(seriesAceitas('01; 02;')).toEqual(['01', '02']);
  });
});

describe('getNumeroVale', () => {
  it('12 dígitos, DV pelos dígitos 3, 6 e 9 e sem laço infinito com zeros', () => {
    expect(getNumeroVale('123456789')).toBe('123456789' + String(369 - 103).padStart(3, '0'));
    expect(getNumeroVale('120450780')).toBe('120450780' + '153'); // x=0 → 1 → 256 → DV 153
    expect(getNumeroVale()).toMatch(/^\d{12}$/);
  });
});

// ------------------------------------------------------------------ NF-e

const EMPRESA = { id: 1, uf: 'SC', nfe_ambiente: 'H', cnpj: '11222333000181', ie: '254123456', razao_social: 'EMPRESA TESTE LTDA', nome_comercial: 'TESTE', endereco: 'Rua A', numero: '10', bairro: 'Centro', cod_cidade: '4205407', cidade: 'Florianopolis', cep: '88000000', simples_normal: 'S' };

function dadosVenda(devolucao = false) {
  return {
    venda: { id: 9, serie: '1', numero: '123', data_venda: '2026-10-05', data_saida: '2026-10-05', hora_saida: '10:30', es: devolucao ? 'E' : 'S', valor_total_liquido: 30.5, obs_fiscal: 'Obs "fiscal" & teste' },
    operacao: { codigo: devolucao ? 'DEV' : 'VEN', tipo: devolucao ? 'D' : 'V', descricao: devolucao ? 'DEVOLUCAO DE VENDA' : 'VENDA DE MERCADORIA', es: 'S' },
    cliente: { nome: 'CLIENTE TESTE', cpf_cnpj: '11.222.333/0001-81', rg: '254999999', endereco: 'Rua B', endereco_nr: '5', endereco_bairro: 'Centro', endereco_cidade_ibge: '4205407', endereco_cidade: 'Florianopolis', endereco_uf: 'SC', endereco_cep: '88000000', email: 'cli@teste.com' },
    itens: [
      { id: 101, item: 1, id_produto: 7, descricao: 'TONER XPTO', ncm: '84439933', un_venda: 'UN', qtdade: 2, preco_venda: 10, valor_total_bruto: 20, valor_desconto_total: 0.5, valor_acrescimo_total: 1, cfop: '5102' },
      { id: 102, item: 2, id_produto: 8, descricao: 'PAPEL A4', ncm: '48025610', un_venda: 'CX', qtdade: 1, preco_venda: 10, valor_total_bruto: 10, valor_desconto_total: 0, valor_acrescimo_total: 0, cfop: '5102' },
    ],
    impostos: {
      101: { cfop: devolucao ? '1202' : '5102', icms_orig: '0', icms_CSOSN: '102', pis_CST: '07', cofins_CST: '07' },
      102: { cfop: devolucao ? '1202' : '5102', icms_orig: '0', icms_CSOSN: '102', pis_CST: '07', cofins_CST: '07' },
    },
    parcelas: devolucao ? [] : [{ data_vencimento: '2026-11-05', valor_areceber: 15.25 }, { data_vencimento: '2026-12-05', valor_areceber: 15.25 }],
    referencias: devolucao ? ['42261011222333000181550010000001231000000010'] : [],
    apelidoPlano: '2X',
  };
}

describe('NF-e: documento, XML e assinatura', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = { chavePrivadaPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), certificadoPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' };
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('C14N: namespace herdado, atributos ordenados e aspas literais no texto', () => {
    expect(canonicalizar('<infNFe versao="4.00" Id="NFe1"><a>x &quot;y&quot; &amp; z</a><b/></infNFe>', 'urn:x')).toBe(
      '<infNFe xmlns="urn:x" Id="NFe1" versao="4.00"><a>x "y" &amp; z</a><b></b></infNFe>',
    );
  });

  it('venda vira NF-e 55 com totais, duplicatas, ambiente/UF da empresa e assinatura válida', () => {
    const doc = montarDocumento(dadosVenda() as any);
    expect(doc.destinatario).toMatchObject({ cnpj: '11222333000181', indIEDest: 1, inscricaoEstadual: '254999999' });
    const ger = gerarNFe(configDaEmpresa(EMPRESA), doc);
    expect(chaveValida(ger.chave)).toBe(true);
    expect(ger.chave.slice(0, 2)).toBe('42'); // SC, vindo da empresa
    expect(ger.xml).toContain('<tpAmb>2</tpAmb>');
    expect(ger.xml).toContain('<vNF>30.50</vNF>');
    expect(ger.xml).toContain('<dup><nDup>002</nDup><dVenc>2026-12-05</dVenc><vDup>15.25</vDup></dup>');
    expect(ger.xml).toContain('NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO');
    const assinado = assinar(ger.xml, 'infNFe', `NFe${ger.chave}`, cert);
    expect(assinado).toMatch(/<\/infNFe><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">.*<\/Signature><\/NFe>$/);
    expect(conferirAssinatura(assinado, 'infNFe', pub)).toEqual({ valida: true, erros: [] });
    // Qualquer mudança no conteúdo invalida o digest
    expect(conferirAssinatura(assinado.replace('<vNF>30.50</vNF>', '<vNF>30.51</vNF>'), 'infNFe', pub).valida).toBe(false);
    const html = htmlDanfe(assinado);
    expect(html).toContain('DANFE');
    expect(html).toContain('TONER XPTO');
  });

  it('devolução: finalidade 4, NFref com a chave de origem e sem cobrança', () => {
    const ger = gerarNFe(configDaEmpresa({ ...EMPRESA, nfe_ambiente: 'P' }), montarDocumento(dadosVenda(true) as any));
    expect(ger.xml).toContain('<finNFe>4</finNFe>');
    expect(ger.xml).toContain('<NFref><refNFe>42261011222333000181550010000001231000000010</refNFe></NFref>');
    expect(ger.xml).toContain('<tpAmb>1</tpAmb>');
    expect(ger.xml).not.toContain('<cobr>');
    expect(ger.xml).toContain('<tPag>90</tPag>');
  });

  it('evento de carta de correção assinado', () => {
    const { config, emitente } = configDaEmpresa(EMPRESA);
    const chave = gerarNFe({ config, emitente }, montarDocumento(dadosVenda() as any)).chave;
    const ev = montarEvento({ config, emitente, certificado: cert as any, empresaId: 1, grupoId: 1, modelo: 'NFe' }, { chave, tipoEvento: '110110', sequencia: 2, correcao: 'Correcao do endereco de entrega' });
    expect(ev.mensagem).toContain('<nSeqEvento>2</nSeqEvento>');
    expect(conferirAssinatura(ev.eventoAssinado, 'infEvento', pub).valida).toBe(true);
  });

  it('CODE-128: tabela com 11 módulos por símbolo e dígito verificador', () => {
    expect(PADROES_128).toHaveLength(106);
    for (const p of PADROES_128) expect([...p].reduce((s, c) => s + Number(c), 0)).toBe(11);
    // 105 + 12·1 + 34·2 + 56·3 + 78·4 = 665 ≡ 47 (mod 103)
    expect(code128C('12345678')).toBe(PADROES_128[105] + PADROES_128[12] + PADROES_128[34] + PADROES_128[56] + PADROES_128[78] + PADROES_128[47] + '2331112');
  });
});
