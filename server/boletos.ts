/**
 * Boletos bancários (uBancosBoletos.pas do PrintControl Delphi) — funções puras, sem banco de dados.
 * Usado pelo Faturamento (notas de débito), pelos boletos de parcelas (areceber) e pelo módulo Vendas.
 *
 * Bancos: 001 Banco do Brasil (convênio 7 dígitos), 033 Santander, 085 Ailos/Viacred.
 * Correções em relação ao Delphi: fator de vencimento pela regra nova da FEBRABAN (a partir de 22/02/2025
 * volta a 1000), DV "0" no nosso número do BB (o Delphi deixava vazio), valor arredondado em centavos inteiros.
 */

// ---------------------------------------------------------------- utilitários

/** strzero do Delphi: tira espaços, completa com zeros à esquerda e fica com os `n` últimos caracteres */
export function strzero(v: unknown, n: number): string {
  const s = String(v ?? '').trim();
  return s.padStart(n, '0').slice(-n);
}

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Texto com tamanho fixo: corta ou completa com espaços à direita */
export const ajusta = (v: unknown, n: number) => String(v ?? '').slice(0, n).padEnd(n, ' ');

/** Valor em centavos inteiros (arredondado), aceita número ou texto "1467.45" */
export function centavos(v: unknown): number {
  const n = Number(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Módulo 10 (DV dos campos da linha digitável): pesos 2,1,2,1... da direita */
export function modulo10(s: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    let p = Number(s[i]) * peso;
    if (p > 9) p -= 9;
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  const r = soma % 10;
  return r === 0 ? '0' : String(10 - r);
}

/** Soma ponderada com pesos 2..base cíclicos da direita para a esquerda */
function somaPesos(s: string, base = 9): number {
  let soma = 0;
  let peso = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    soma += Number(s[i]) * peso;
    peso = peso >= base ? 2 : peso + 1;
  }
  return soma;
}

/** Módulo 11 genérico (pesos 2..base); resultado acima de 9 vira 0 */
export function modulo11(s: string, base = 9): string {
  const d = 11 - (somaPesos(s, base) % 11);
  return d > 9 ? '0' : String(d);
}

/** DV geral do código de barras (posição 5): módulo 11; 0, 10 e 11 viram 1 */
export function dvCodigoBarras(s43: string): string {
  const d = 11 - (somaPesos(s43) % 11);
  return d === 0 || d > 9 ? '1' : String(d);
}

const DIA = 86_400_000;
const utc = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10); // ms em UTC puro: só a data, sem fuso

/**
 * Fator de vencimento (FEBRABAN): dias desde 07/10/1997; ao passar de 9999 (22/02/2025) recomeça em 1000.
 * O Delphi cortava para os 4 últimos dígitos (22/02/2025 → 0000) no BB e Santander.
 */
export function fatorVencimento(vencimento: string): string {
  const dias = Math.round((utc(vencimento) - Date.UTC(1997, 9, 7)) / DIA);
  if (dias < 0) throw new Error('Vencimento anterior a 07/10/1997.');
  return strzero(dias <= 9999 ? dias : ((dias - 10000) % 9000) + 1000, 4);
}

// ---------------------------------------------------------------- boletos

export interface DadosBancoBoleto {
  cod_banco: string;
  cod_agencia?: string | null;
  cod_agencia_dig?: string | null;
  cod_conta?: string | null;
  cod_conta_dig?: string | null;
  cod_cedente?: string | null;
  cod_cedente_dig?: string | null;
  cod_carteira?: string | null;
  cod_convenio?: string | null;
}

export interface TituloBoleto {
  /** Sequencial do nosso número (bancos.ultimo_nosso_numero já incrementado) */
  nossoNumero: number | string;
  /** aaaa-mm-dd */
  vencimento: string;
  valor: number | string;
}

export interface Boleto {
  codigoBarras: string;
  linhaDigitavel: string;
  /** Gravado em boleto_nosso_numero (BB 17, Santander 12, Ailos 17 dígitos) */
  nossoNumero: string;
  /** Gravado em boleto_nosso_numero_dig (Ailos: vazio) */
  nossoNumeroDig: string;
}

export const BANCOS_BOLETO = ['001', '033', '085'] as const;
export const bancoEmiteBoleto = (cod: unknown) => (BANCOS_BOLETO as readonly string[]).includes(strzero(cod, 3));

/** Linha digitável: 3 campos com DV módulo 10, DV geral e fator+valor */
function linhaDigitavel(campo1: string, campo2: string, campo3: string, codigoBarras: string): string {
  const fmt = (c: string, corte: number) => `${c.slice(0, corte)}.${c.slice(corte)}${modulo10(c)}`;
  return `${fmt(campo1, 5)} ${fmt(campo2, 5)} ${fmt(campo3, 5)} ${codigoBarras[4]} ${codigoBarras.slice(5, 19)}`;
}

/** Código de barras com o DV geral na posição 5 */
function montarCodigo(banco: string, fator: string, valor: string, campoLivre: string): string {
  if (campoLivre.length !== 25) throw new Error(`Campo livre do boleto com ${campoLivre.length} dígitos (esperado 25): confira o cadastro do banco.`);
  const sem = `${banco}9${fator}${valor}${campoLivre}`;
  return `${banco}9${dvCodigoBarras(sem)}${fator}${valor}${campoLivre}`;
}

/** DV do nosso número do BB (módulo 11, pesos 2..9): 10 → X, 11 → 0 */
export function dvNossoNumeroBB(s: string): string {
  const d = 11 - (somaPesos(s) % 11);
  return d === 10 ? 'X' : d === 11 ? '0' : String(d);
}

function exigir(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Gera código de barras, linha digitável e nosso número do título no banco indicado */
export function gerarBoleto(banco: DadosBancoBoleto, titulo: TituloBoleto): Boleto {
  const cod = strzero(banco.cod_banco, 3);
  const fator = fatorVencimento(titulo.vencimento);
  const cent = centavos(titulo.valor);
  exigir(cent > 0, 'Valor do boleto precisa ser maior que zero.');
  exigir(cent <= 99_999_999_99, 'Valor acima do limite do boleto.');
  const valor = strzero(cent, 10);
  const seq = soDigitos(titulo.nossoNumero);
  exigir(seq !== '', 'Nosso número não informado.');

  switch (cod) {
    case '001': {
      const convenio = soDigitos(banco.cod_convenio);
      exigir(convenio.length > 0 && convenio.length <= 7, 'Banco do Brasil: convênio de até 7 dígitos não informado no cadastro do banco.');
      const nosso = strzero(convenio, 7) + strzero(seq, 10);
      const codigo = montarCodigo('001', fator, valor, '000000' + nosso + strzero(banco.cod_carteira, 2));
      return {
        codigoBarras: codigo,
        linhaDigitavel: linhaDigitavel('0019' + codigo.slice(19, 24), codigo.slice(24, 34), codigo.slice(34, 44), codigo),
        nossoNumero: nosso,
        nossoNumeroDig: dvNossoNumeroBB(nosso),
      };
    }
    case '033': {
      const cedente = soDigitos(banco.cod_cedente);
      exigir(cedente.length === 7, 'Santander: o código do beneficiário (cedente) precisa ter 7 dígitos no cadastro do banco.');
      const carteira = strzero(banco.cod_carteira || '101', 3);
      const nosso = strzero(seq, 12);
      const dv = modulo11(nosso);
      const codigo = montarCodigo('033', fator, valor, '9' + cedente + nosso + dv + '0' + carteira);
      return {
        codigoBarras: codigo,
        linhaDigitavel: linhaDigitavel('03399' + cedente.slice(0, 4), cedente.slice(4, 7) + nosso.slice(0, 7), nosso.slice(7, 12) + dv + '0' + carteira, codigo),
        nossoNumero: nosso,
        nossoNumeroDig: dv,
      };
    }
    case '085': {
      const cedente = soDigitos(banco.cod_cedente);
      exigir(cedente.length === 8, 'Ailos: o código do beneficiário (conta + DV, 8 dígitos) não está no cadastro do banco.');
      const convenio = strzero(soDigitos(banco.cod_convenio), 6);
      const carteira = strzero(banco.cod_carteira, 2);
      const seq9 = strzero(seq, 9);
      const nosso = cedente + seq9;
      const codigo = montarCodigo('085', fator, valor, convenio + nosso + carteira);
      return {
        codigoBarras: codigo,
        linhaDigitavel: linhaDigitavel('0859' + convenio.slice(0, 5), convenio[5] + cedente + seq9[0], seq9.slice(1) + carteira, codigo),
        nossoNumero: nosso,
        nossoNumeroDig: '',
      };
    }
    default:
      throw new Error(`O banco ${cod} não emite boleto neste sistema (só 001 Banco do Brasil, 033 Santander e 085 Ailos).`);
  }
}

/** Confere código de barras (DV geral) — útil para validar boletos já gravados */
export const codigoBarrasValido = (c: string) => /^\d{44}$/.test(c) && dvCodigoBarras(c.slice(0, 4) + c.slice(5)) === c[4];

// ---------------------------------------------------------------- código de barras impresso (I2of5)

const I25 = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

/**
 * Código de barras Interleaved 2 of 5 dos 44 dígitos, em SVG (103 × 13 mm, razão larga/estreita 3:1, padrão FEBRABAN).
 */
export function codigoBarrasSvg(codigo: string, larguraMm = 103, alturaMm = 13): string {
  const d = soDigitos(codigo);
  if (!d || d.length % 2) return '';
  const larg = (c: string) => (c === 'w' ? 3 : 1);
  const barras: number[] = [1, 1, 1, 1]; // início: barra, espaço, barra, espaço estreitos
  for (let i = 0; i < d.length; i += 2) {
    const b = I25[Number(d[i])];
    const e = I25[Number(d[i + 1])];
    for (let k = 0; k < 5; k++) barras.push(larg(b[k]), larg(e[k]));
  }
  barras.push(3, 1, 1); // fim: barra larga, espaço, barra estreita
  let x = 0;
  const rects: string[] = [];
  barras.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="1"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${larguraMm}mm" height="${alturaMm}mm" viewBox="0 0 ${x} 1" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="#000">${rects.join('')}</g></svg>`;
}

// ---------------------------------------------------------------- dias úteis (data de juros/multa da remessa)

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) */
function pascoa(ano: number): number {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}

/**
 * Feriados bancários nacionais do ano (aaaa-mm-dd): fixos + Carnaval (seg/ter), Sexta-feira Santa e Corpus Christi.
 * O Delphi usava uma lista fixa com as datas móveis de um único ano.
 * ponytail: sem feriados municipais/estaduais; se precisar, passar uma lista extra em `extras`.
 */
export function feriados(ano: number, extras: string[] = []): Set<string> {
  const p = pascoa(ano);
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25', ...(ano >= 2024 ? ['11-20'] : [])].map((md) => `${ano}-${md}`);
  const moveis = [-48, -47, -2, 60].map((dd) => isoDe(p + dd * DIA));
  return new Set([...fixos, ...moveis, ...extras]);
}

const naoUtil = (ms: number, extras: string[]) => {
  const dow = new Date(ms).getUTCDay();
  const iso = isoDe(ms);
  return dow === 0 || dow === 6 || feriados(Number(iso.slice(0, 4)), extras).has(iso);
};

/** ProximoDiaUtil(d, n) do Delphi: ajusta para dia útil e avança `n` dias úteis */
export function proximoDiaUtil(data: string, n = 1, extras: string[] = []): string {
  let ms = utc(data);
  while (naoUtil(ms, extras)) ms += DIA;
  for (let i = 0; i < n; i++) {
    ms += DIA;
    while (naoUtil(ms, extras)) ms += DIA;
  }
  return isoDe(ms);
}

// ---------------------------------------------------------------- valor por extenso (uExtenso.pas)

const CENTENAS = ['', 'CEM', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];
const DEZENAS = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
const DEZ = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const UNIDADES = ['', 'UM', 'DOIS', 'TRES', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];

function ext3(p: string): string {
  const [c, d, u] = p.split('').map(Number);
  let base = c === 1 && p > '100' ? 'CENTO' : CENTENAS[c];
  if (d === 1) return (base ? base + ' E ' : '') + DEZ[u];
  if (base && d > 0) base += ' E ';
  if (d > 1) base += DEZENAS[d];
  if (u > 0) base += (base && !base.endsWith(' E ') ? ' E ' : '') + UNIDADES[u];
  return base;
}

/** Valor por extenso em maiúsculas sem acento, como o GetExtenso do Delphi (ex.: "UM MIL, DUZENTOS E ... REAIS E ... CENTAVOS") */
export function extenso(valor: number | string): string {
  const cent = Math.abs(centavos(valor));
  if (cent === 0) return 'ZERO';
  const txt = String(cent).padStart(14, '0').slice(-14); // 12 dígitos inteiros + 2 centavos
  const inteiro = Math.floor(cent / 100);
  const temCentavos = cent % 100 !== 0;
  let r = '';
  const bi = ext3(txt.slice(0, 3));
  if (bi) r = bi + (txt.slice(0, 3) === '001' ? ' BILHAO' : ' BILHOES');
  const mi = ext3(txt.slice(3, 6));
  if (mi) r += (r ? ', ' : '') + mi + (txt.slice(3, 6) === '001' ? ' MILHAO' : ' MILHOES');
  const mil = ext3(txt.slice(6, 9));
  if (mil) r += (r ? ', ' : '') + mil + ' MIL';
  const un = ext3(txt.slice(9, 12));
  if (un) r += (r ? (temCentavos ? ', ' : ' E ') : '') + un;
  if (inteiro > 0) r += txt.slice(6, 12) === '000000' ? ' DE REAIS' : inteiro === 1 ? ' REAL' : ' REAIS';
  else r = '';
  const c = ext3('0' + txt.slice(12));
  if (c) r += (r ? ' E ' : '') + c + (c === 'UM' ? ' CENTAVO' : ' CENTAVOS');
  return r;
}

// ---------------------------------------------------------------- ficha de compensação (HTML)

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const dataBr = (iso: unknown) => {
  const s = String(iso ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
};
export const moedaBr = (v: unknown) => (centavos(v) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const mascaraDoc = (v: unknown) => {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return String(v ?? '');
};

/** DV do código do banco impresso na ficha quando o cadastro não traz (bancos.cod_banco_dig) */
const DV_BANCO: Record<string, string> = { '001': '9', '033': '7', '085': '1' };
const LOCAL_PAGAMENTO: Record<string, string> = {
  '001': 'PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO',
  '033': 'Pagar preferencialmente no Grupo Santander - GC',
  '085': 'Pagar preferencialmente nas cooperativas do Sistema AILOS',
};

export interface DadosFicha {
  banco: DadosBancoBoleto & { cod_banco_dig?: string | null };
  beneficiario: { nome: string; documento?: string | null; endereco?: string | null };
  pagador: { nome: string; documento?: string | null; endereco?: string | null; cidadeUf?: string | null; cep?: string | null };
  numeroDocumento: string;
  dataDocumento: string;
  dataProcessamento?: string;
  vencimento: string;
  valor: number | string;
  nossoNumero: string;
  nossoNumeroDig?: string | null;
  codigoBarras: string;
  linhaDigitavel: string;
  instrucoes?: string[];
  especieDoc?: string;
}

/** "agência-dv / código-dv" do beneficiário */
function agenciaCodigo(b: DadosBancoBoleto): string {
  const comDv = (n?: string | null, dv?: string | null) => (n ? `${n}${dv ? `-${dv}` : ''}` : '');
  const codigo = b.cod_cedente ? comDv(b.cod_cedente, b.cod_cedente_dig) : comDv(b.cod_conta, b.cod_conta_dig);
  return [comDv(b.cod_agencia, b.cod_agencia_dig), codigo].filter(Boolean).join(' / ');
}

/** CSS das fichas (incluir uma vez no <style> da página) */
export const CSS_FICHA = `
.ficha{font-family:Arial,Helvetica,sans-serif;font-size:7.5pt;color:#000;width:190mm}
.ficha table{width:100%;border-collapse:collapse}
.ficha td{border:0.6pt solid #000;padding:0.6mm 1.2mm;vertical-align:top}
.ficha .r{font-size:5.5pt;color:#222;display:block;line-height:1.1}
.ficha .v{font-size:8pt;font-weight:bold;display:block;min-height:3.2mm}
.ficha .dir{text-align:right}
.ficha .topo td{border:none;border-bottom:1.2pt solid #000;vertical-align:bottom}
.ficha .bco{font-size:13pt;font-weight:bold;border-left:1.2pt solid #000 !important;border-right:1.2pt solid #000 !important;text-align:center;width:22mm}
.ficha .linha{font-size:10.5pt;font-weight:bold;text-align:right;letter-spacing:0.2mm}
.ficha .corte{border-top:0.6pt dashed #000;margin:4mm 0 2mm;font-size:6pt;text-align:right}
.ficha .barras{padding:2mm 0 0 1mm}
`;

/** Recibo do pagador + ficha de compensação com código de barras (rodapé do nf_modelo1 / boleto_santander.fr3) */
export function fichaCompensacaoHtml(f: DadosFicha): string {
  const cod = strzero(f.banco.cod_banco, 3);
  const bco = `${cod}-${f.banco.cod_banco_dig || DV_BANCO[cod] || ''}`;
  // BB com convênio de 7 dígitos: o nosso número (17) não tem DV impresso
  const nosso = `${f.nossoNumero}${f.nossoNumeroDig && cod !== '001' ? `-${f.nossoNumeroDig}` : ''}`;
  const ag = agenciaCodigo(f.banco);
  const cel = (rotulo: string, valor: unknown, extra = '') => `<td ${extra}><span class="r">${rotulo}</span><span class="v">${esc(valor)}</span></td>`;
  const benef = `${f.beneficiario.nome}${f.beneficiario.documento ? ` - CNPJ ${mascaraDoc(f.beneficiario.documento)}` : ''}`;
  const pagador = [
    `${esc(f.pagador.nome)}${f.pagador.documento ? ` &nbsp; CPF/CNPJ: ${esc(mascaraDoc(f.pagador.documento))}` : ''}`,
    esc(f.pagador.endereco),
    esc([f.pagador.cidadeUf, f.pagador.cep ? `CEP ${f.pagador.cep}` : ''].filter(Boolean).join(' - ')),
  ].join('<br>');
  const topo = (direita: string) =>
    `<table class="topo"><tr><td style="width:40mm;font-weight:bold;font-size:10pt">${esc(cod === '001' ? 'Banco do Brasil' : cod === '033' ? 'Santander' : cod === '085' ? 'AILOS' : '')}</td><td class="bco">${bco}</td><td class="linha">${direita}</td></tr></table>`;
  return `<div class="ficha">
${topo('Recibo do Pagador')}
<table>
<tr>${cel('Beneficiário', benef, 'colspan="3"')}${cel('Agência / Código do Beneficiário', ag)}${cel('Vencimento', dataBr(f.vencimento), 'class="dir"')}</tr>
<tr>${cel('Pagador', f.pagador.nome, 'colspan="2"')}${cel('Nº do Documento', f.numeroDocumento)}${cel('Nosso Número', nosso)}${cel('(=) Valor do Documento', moedaBr(f.valor), 'class="dir"')}</tr>
</table>
<div class="corte">Autenticação mecânica - corte aqui</div>
${topo(esc(f.linhaDigitavel))}
<table>
<tr>${cel('Local de Pagamento', LOCAL_PAGAMENTO[cod] || 'PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO', 'colspan="5"')}${cel('Vencimento', dataBr(f.vencimento), 'class="dir" style="width:40mm"')}</tr>
<tr>${cel('Beneficiário', benef, 'colspan="5"')}${cel('Agência / Código do Beneficiário', ag, 'class="dir"')}</tr>
<tr>${cel('Data do Documento', dataBr(f.dataDocumento))}${cel('Nº do Documento', f.numeroDocumento)}${cel('Espécie Doc.', f.especieDoc || 'DM')}${cel('Aceite', 'N')}${cel('Data Processamento', dataBr(f.dataProcessamento || f.dataDocumento))}${cel('Nosso Número', nosso, 'class="dir"')}</tr>
<tr>${cel('Uso do Banco', '')}${cel('Carteira', f.banco.cod_carteira || '')}${cel('Espécie', 'R$')}${cel('Quantidade', '')}${cel('Valor', '')}${cel('(=) Valor do Documento', moedaBr(f.valor), 'class="dir"')}</tr>
<tr><td colspan="5" rowspan="4"><span class="r">Instruções (texto de responsabilidade do beneficiário)</span><span class="v" style="font-weight:normal">${(f.instrucoes || []).map(esc).join('<br>')}</span></td>${cel('(-) Desconto / Abatimento', '', 'class="dir"')}</tr>
<tr>${cel('(+) Mora / Multa', '', 'class="dir"')}</tr>
<tr>${cel('(+) Outros Acréscimos', '', 'class="dir"')}</tr>
<tr>${cel('(=) Valor Cobrado', '', 'class="dir"')}</tr>
<tr><td colspan="6"><span class="r">Pagador</span><span class="v" style="font-weight:normal">${pagador}</span></td></tr>
</table>
<div style="display:flex;justify-content:space-between"><div class="barras">${codigoBarrasSvg(f.codigoBarras)}</div><div style="font-size:6pt;padding-top:1mm">Autenticação mecânica - Ficha de Compensação</div></div>
</div>`;
}
