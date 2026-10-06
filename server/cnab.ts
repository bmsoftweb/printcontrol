/**
 * Remessa e retorno CNAB 240 (cobrança) — funções puras.
 *
 * O Delphi lia modelos "layout_cnab240_banco<cod>.txt" da pasta cfg da empresa e trocava letras (DDDDDDDD,
 * NNNNNN...) por texto, o que corrompia a linha quando o dado tinha as mesmas letras. Aqui cada registro é
 * montado por POSIÇÃO, com os mesmos campos fixos dos modelos reais (BB, Ailos e Santander) e os dados do
 * beneficiário vindos do cadastro (empresa + bancos) em vez de fixos no arquivo.
 *
 * Correções: sequencial do arquivo = bancos.ultima_remessa incrementado para todos os bancos (BB/Santander
 * usavam 1 fixo); trailer de lote com a quantidade de títulos e o valor total (variável não inicializada no
 * Delphi); valor nominal do retorno lido do segmento T (o Delphi lia a posição do valor pago).
 */
import { ajusta, centavos, proximoDiaUtil, soDigitos, strzero } from './boletos.js';

export interface CedenteCnab {
  cod_banco: string;
  cod_agencia?: string | null;
  cod_agencia_dig?: string | null;
  cod_conta?: string | null;
  cod_conta_dig?: string | null;
  cod_cedente?: string | null;
  cod_carteira?: string | null;
  cod_convenio?: string | null;
  /** Nome do banco no header (bancos.nome) */
  nome?: string | null;
  /**
   * bancos.codigos_remessa: parâmetros "chave=valor", um por linha (o Delphi não usava a coluna).
   * variacao_carteira (BB, ex. 027), codigo_transmissao (Santander, 15 dígitos), nome_banco.
   */
  codigos_remessa?: string | null;
  /** Empresa beneficiária */
  cnpj: string;
  razao_social: string;
}

export interface TituloCnab {
  id: number;
  serie: string;
  numero: number;
  nossoNumero: string;
  nossoNumeroDig?: string | null;
  /** aaaa-mm-dd */
  vencimento: string;
  emissao: string;
  valor: number | string;
  cpfCnpj: string;
  nome: string;
  endereco: string;
  bairro: string;
  cep: string;
  cidade: string;
  uf: string;
}

export interface OpcoesRemessa {
  /** Sequencial do arquivo (bancos.ultima_remessa já incrementado) */
  sequencial: number;
  /** Data e hora da geração (aaaa-mm-dd, hhmmss) no horário de Brasília */
  data: string;
  hora: string;
  /** config.areceber_juros_mes (% ao mês) e config.areceber_multa (%) */
  jurosMes: number;
  multaPerc: number;
}

export const BANCOS_CNAB = ['001', '033', '085'];

/** "chave=valor" por linha → objeto (chaves em minúsculas) */
export function parametros(texto: string | null | undefined): Record<string, string> {
  const r: Record<string, string> = {};
  for (const l of String(texto ?? '').split(/\r?\n/)) {
    const i = l.indexOf('=');
    if (i > 0) r[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return r;
}

/** Texto sem acentos e só com caracteres seguros para o arquivo do banco */
const limpo = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ');

const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** Registro de 240 posições montado por (posição 1-based, texto) */
function registro(campos: [number, string][]): string {
  const r = Array(240).fill(' ');
  for (const [pos, txt] of campos) {
    for (let i = 0; i < txt.length; i++) {
      if (pos - 1 + i >= 240) throw new Error(`CNAB: campo na posição ${pos} passa de 240 colunas.`);
      r[pos - 1 + i] = txt[i];
    }
  }
  return r.join('');
}

const zeros = (n: number) => '0'.repeat(n);

/** Gera o arquivo de remessa (linhas CRLF). Lança erro se o banco não tiver layout */
export function gerarRemessa(c: CedenteCnab, titulos: TituloCnab[], o: OpcoesRemessa): string {
  const cod = strzero(c.cod_banco, 3);
  if (!BANCOS_CNAB.includes(cod)) throw new Error(`Não há layout de remessa CNAB 240 para o banco ${cod}.`);
  const p = parametros(c.codigos_remessa);
  const cnpj = soDigitos(c.cnpj);
  const tipoInsc = cnpj.length === 11 ? '1' : '2';
  const nome30 = ajusta(limpo(c.razao_social).toUpperCase(), 30);
  const ag5 = strzero(soDigitos(c.cod_agencia), 5);
  const agDv = ajusta(c.cod_agencia_dig ?? '', 1);
  const conta12 = strzero(soDigitos(c.cod_conta), 12);
  const contaDv = ajusta(c.cod_conta_dig ?? '', 1);
  const data = ddmmaaaa(o.data);
  const linhas: string[] = [];
  const lote = (s: string) => `${cod}0001${s}`;

  // ------------------------------------------------ headers
  if (cod === '001') {
    const conv = [strzero(soDigitos(c.cod_convenio), 9), '0014', strzero(c.cod_carteira, 2), strzero(p.variacao_carteira || '', 3)].join('');
    linhas.push(registro([[1, '00100000'], [9, '     000 '], [18, tipoInsc], [19, strzero(cnpj, 14)], [33, conv], [53, ag5], [58, agDv], [59, conta12], [71, contaDv], [73, nome30], [103, ajusta(p.nome_banco || 'BANCO DO BRASIL S.A.', 30)], [143, '1'], [144, data], [152, '000000'], [158, strzero(o.sequencial, 6)], [164, '000']]));
    linhas.push(registro([[1, '00100011R01'], [14, '000'], [18, tipoInsc], [19, strzero(cnpj, 15)], [34, conv], [54, ag5], [59, agDv], [60, conta12], [72, contaDv], [74, nome30], [184, strzero(o.sequencial, 8)], [192, data]]));
  } else if (cod === '085') {
    const conv20 = ajusta(soDigitos(c.cod_convenio), 20);
    linhas.push(registro([[1, '08500000'], [18, tipoInsc], [19, strzero(cnpj, 14)], [33, conv20], [53, ag5], [58, agDv], [59, conta12], [71, contaDv], [73, nome30], [103, ajusta(limpo(p.nome_banco || c.nome || 'AILOS').toUpperCase(), 30)], [143, '1'], [144, data], [152, o.hora], [158, strzero(o.sequencial, 6)], [164, '08401600']]));
    linhas.push(registro([[1, '08500011R01'], [14, '043'], [18, tipoInsc], [19, strzero(cnpj, 15)], [34, conv20], [54, ag5], [59, agDv], [60, conta12], [72, contaDv], [74, nome30], [184, strzero(o.sequencial, 8)], [192, data], [200, zeros(8)]]));
  } else {
    // Santander: código de transmissão = agência(4) + 0000 + código do beneficiário(7), salvo se informado
    const transm = strzero(p.codigo_transmissao || strzero(soDigitos(c.cod_agencia), 4) + '0000' + strzero(soDigitos(c.cod_cedente), 7), 15);
    linhas.push(registro([[1, '03300000'], [17, tipoInsc], [18, strzero(cnpj, 15)], [33, transm], [73, nome30], [103, ajusta(p.nome_banco || 'BANCO SANTANDER', 30)], [143, '1'], [144, data], [158, strzero(o.sequencial, 6)], [164, '040']]));
    linhas.push(registro([[1, '03300011R01'], [14, '030'], [18, tipoInsc], [19, strzero(cnpj, 15)], [54, transm], [74, nome30], [184, strzero(o.sequencial, 8)], [192, data]]));
  }

  // ------------------------------------------------ detalhes (P, Q, R)
  let seq = 0;
  let total = 0;
  for (const t of titulos) {
    const valor = centavos(t.valor);
    const jurosDia = Math.round((valor * Number(o.jurosMes || 0)) / 3000); // valor × juros%/30/100, em centavos
    const multa = Math.round(Number(o.multaPerc || 0) * 100);
    const dataJM = ddmmaaaa(proximoDiaUtil(t.vencimento, 1));
    const tipoJuros = jurosDia === 0 ? '3' : '1';
    const venc = ddmmaaaa(t.vencimento);
    const uso = strzero(t.serie, 2) + strzero(t.numero, 8) + strzero(t.id, 15);
    total += valor;

    // Segmento P (posições comuns; conta/nosso número/códigos da carteira variam por banco)
    const comum: [number, string][] = [[1, lote('3')], [9, strzero(++seq, 5)], [14, 'P'], [16, '01'], [63, strzero(t.id, 15)], [78, venc], [86, strzero(valor, 15)], [101, '00000'], [107, '02N'], [110, ddmmaaaa(t.emissao)], [118, tipoJuros], [119, venc], [127, strzero(jurosDia, 15)], [142, zeros(54)], [196, uso]];
    if (cod === '033') {
      const ag4 = strzero(soDigitos(c.cod_agencia), 4);
      const conta9 = strzero(soDigitos(c.cod_conta), 9);
      linhas.push(registro([...comum, [18, ag4], [22, agDv], [23, conta9], [32, contaDv], [33, conta9], [42, contaDv], [45, strzero(soDigitos(t.nossoNumero) + soDigitos(t.nossoNumeroDig), 13)], [58, '512'], [221, '000200000']]));
    } else {
      linhas.push(registro([...comum, [18, ag5], [23, agDv], [24, conta12], [36, contaDv], [38, strzero(soDigitos(t.nossoNumero), 17)], [58, cod === '001' ? '202' : '11122'], [221, cod === '001' ? '3000000090000000000' : '3002000090000000000']]));
    }

    // Segmento Q (pagador)
    const doc = soDigitos(t.cpfCnpj);
    linhas.push(registro([[1, lote('3')], [9, strzero(++seq, 5)], [14, 'Q'], [16, '01'], [18, doc.length < 14 ? '1' : '2'], [19, strzero(doc, 15)], [34, ajusta(limpo(t.nome), 40)], [74, ajusta(limpo(t.endereco), 40)], [114, ajusta(limpo(t.bairro), 15)], [129, strzero(soDigitos(t.cep), 8)], [137, ajusta(limpo(t.cidade), 15)], [152, ajusta(limpo(t.uf), 2)], [154, zeros(16)], [210, cod === '085' ? '000' : zeros(12)]]));

    // Segmento R (multa) — o layout do Santander não tinha R (o Delphi gravava uma linha vazia)
    if (cod !== '033') {
      const extra: [number, string][] = cod === '085' ? [[200, zeros(16)], [217, zeros(12)], [231, '0']] : [];
      linhas.push(registro([[1, lote('3')], [9, strzero(++seq, 5)], [14, 'R'], [16, '01'], [18, zeros(48)], [66, '2'], [67, dataJM], [75, strzero(multa, 15)], ...extra]));
    }
  }

  // ------------------------------------------------ trailers
  const qtdLote = strzero(seq + 2, 6);
  linhas.push(
    registro(cod === '085' ? [[1, lote('5')], [18, qtdLote], [24, strzero(titulos.length, 6)], [30, strzero(total, 17)], [47, zeros(69)]] : [[1, lote('5')], [18, qtdLote]]),
  );
  linhas.push(registro([[1, `${cod}99999`], [18, '000001'], [24, strzero(seq + 4, 6)], ...(cod === '085' ? ([[30, '000000']] as [number, string][]) : [])]));
  return linhas.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- retorno

export interface RegistroRetorno {
  ident: string;
  /** fatur_notas.id lido da identificação do título na empresa (série 2 + número 8 + id 15) */
  idNota: number | null;
  ocorrencia: string;
  ocorrenciaDescricao: string;
  nomePagador: string;
  tipoCliente: string;
  cnpj: string;
  nossoNumero: string;
  dataVencimento: string | null;
  dataOcorrencia: string | null;
  dataCredito: string | null;
  valorNominal: number;
  valorJuros: number;
  valorDescontos: number;
  valorAbatimento: number;
  valorPago: number;
  valorCreditado: number;
  valorOutrasDespesas: number;
  valorOutrosCreditos: number;
  /** S = baixar, E = erro, N = só atualizar */
  baixar: 'S' | 'E' | 'N';
  obs: string;
  erros: { codigo: string; descricao: string }[];
}

const pega = (s: string, pos: number, n: number) => s.substr(pos - 1, n);
const valorRet = (s: string) => Number(soDigitos(s) || 0) / 100;

/** ddmmaaaa → aaaa-mm-dd; inválida → 1980-01-01 (como o Delphi) */
function dataRet(s: string): string | null {
  const d = soDigitos(s);
  if (d.length !== 8 || d === '00000000') return '1980-01-01';
  const iso = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  const t = new Date(`${iso}T12:00:00Z`);
  return isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? '1980-01-01' : iso;
}

/** Lê os pares de segmentos T/U do arquivo de retorno. codigos = bancos.codigos_retorno / codigos_retorno_erros */
export function lerRetorno(texto: string, codigosRetorno?: string | null, codigosErros?: string | null): RegistroRetorno[] {
  const ocorr = parametros(codigosRetorno);
  const erros = parametros(codigosErros);
  const linhas = texto.split(/\r?\n/).filter((l) => l[13] === 'T' || l[13] === 'U');
  const r: RegistroRetorno[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const t = linhas[i];
    if (t[13] !== 'T') continue;
    const u = linhas[i + 1]?.[13] === 'U' ? linhas[++i] : '';
    const ident = pega(t, 106, 25);
    const idTxt = /^\d{25}$/.test(ident) ? ident.slice(10) : '';
    const tipo = pega(t, 133, 1);
    const doc = pega(t, 134, 15);
    const ocorrencia = pega(t, 16, 2);
    const desc = ocorr[ocorrencia.toLowerCase()] ?? '';
    const reg: RegistroRetorno = {
      ident: ident.trim(),
      idNota: idTxt ? Number(idTxt) || null : null,
      ocorrencia,
      ocorrenciaDescricao: desc,
      nomePagador: pega(t, 149, 40).trim(),
      tipoCliente: tipo,
      cnpj: tipo === '1' ? pega(doc, 5, 11) : tipo === '2' ? pega(doc, 2, 14) : doc.trim(),
      nossoNumero: pega(t, 38, 17).trim(),
      dataVencimento: dataRet(pega(t, 74, 8)),
      dataOcorrencia: u ? dataRet(pega(u, 138, 8)) : null,
      dataCredito: u ? dataRet(pega(u, 146, 8)) : null,
      valorNominal: valorRet(pega(t, 82, 15)),
      valorJuros: valorRet(pega(u, 18, 15)),
      valorDescontos: valorRet(pega(u, 33, 15)),
      valorAbatimento: valorRet(pega(u, 48, 15)),
      valorPago: valorRet(pega(u, 78, 15)),
      valorCreditado: valorRet(pega(u, 93, 15)),
      valorOutrasDespesas: valorRet(pega(u, 108, 15)),
      valorOutrosCreditos: valorRet(pega(u, 123, 15)),
      baixar: 'N',
      obs: '',
      erros: [],
    };
    if (desc.includes('(B)')) {
      reg.baixar = 'S';
      reg.obs = 'BAIXAR TITULO!';
    } else if (desc.includes('(E)')) {
      reg.baixar = 'E';
      reg.erros = [209, 211, 213, 215, 217]
        .map((p) => pega(t, p, 2))
        .filter((c) => c.trim() && c !== '00')
        .map((codigo) => ({ codigo, descricao: erros[codigo.toLowerCase()] ?? '' }));
      reg.obs = reg.erros[0]?.descricao || 'ERRO';
    }
    r.push(reg);
  }
  return r;
}
