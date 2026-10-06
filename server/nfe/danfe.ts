/**
 * DANFE (retrato) e impressão de evento (carta de correção / cancelamento) em HTML A4, convertidos em PDF
 * pelo gerarPdf (server/pdf.ts). O nfeWeb desenhava com pdfkit + bwip-js; aqui o código de barras CODE-128C
 * da chave é um SVG gerado no próprio módulo, sem dependência.
 */
import { recortarElemento, valorTag } from './xml.js';
import { paraBR } from './datas.js';

// ---------------------------------------------------------------------------
// CODE-128 (conjunto C: pares de dígitos)
// ---------------------------------------------------------------------------

/** Larguras barra/espaço de cada símbolo 0..105 (tabela padrão do CODE-128) e o STOP */
export const PADROES_128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232'
).split(' ');
const STOP_128 = '2331112';

/** Sequência de módulos (larguras alternando barra e espaço) do código CODE-128C de um número de tamanho par */
export function code128C(digitos: string): string {
  if (!/^(\d\d)+$/.test(digitos)) throw new Error('CODE-128C exige quantidade par de dígitos.');
  const valores = [105, ...(digitos.match(/\d\d/g) || []).map(Number)];
  const soma = valores.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0);
  return [...valores, soma % 103].map((v) => PADROES_128[v]).join('') + STOP_128;
}

function barrasSvg(digitos: string, altura = 40): string {
  const larguras = code128C(digitos);
  const total = [...larguras].reduce((s, c) => s + Number(c), 0) + 20;
  let x = 10;
  let rects = '';
  [...larguras].forEach((c, i) => {
    const w = Number(c);
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${altura}"/>`;
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${altura}" preserveAspectRatio="none" style="width:100%;height:${altura}px">${rects}</svg>`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function moeda(v: string | number, casas = 2) {
  const n = Number(v);
  return Number.isFinite(n) && String(v) !== '' ? n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) : '';
}

const cnpjCpf = (d: string) =>
  d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;

const ESTILO = `
  @page { size: A4; margin: 7mm 7mm 5mm 5mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8px; color: #000; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 0.6px solid #444; padding: 1px 3px; vertical-align: top; }
  .r { font-size: 5.5px; color: #333; text-transform: uppercase; display: block; }
  .v { font-size: 8px; font-weight: bold; min-height: 10px; display: block; }
  .t { font-size: 7px; font-weight: bold; margin: 4px 0 1px; text-transform: uppercase; }
  .dir { text-align: right; } .cen { text-align: center; }
  .itens th { font-size: 5.5px; background: #eee; }
  .itens td { font-size: 6.5px; border-top: none; border-bottom: none; }
  .itens { border-bottom: 0.6px solid #444; }
  .tarja { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 34px; color: rgba(200,0,0,.25); transform: rotate(-25deg); font-weight: bold; }
`;

const campo = (rotulo: string, valor: unknown, classe = '', colspan = 1) =>
  `<td${colspan > 1 ? ` colspan="${colspan}"` : ''}><span class="r">${esc(rotulo)}</span><span class="v ${classe}">${esc(valor)}</span></td>`;

function blocos(xml: string, nome: string): string[] {
  const r: string[] = [];
  const re = new RegExp(`<${nome}[\\s>][\\s\\S]*?</${nome}>`, 'g');
  for (const m of xml.matchAll(re)) r.push(m[0]);
  return r;
}

/**
 * @param xml nfeProc (com protocolo) ou a NFe assinada
 * @param situacao texto de tarja (ex.: "CANCELADA"); homologação já marca sozinha
 */
export function htmlDanfe(xml: string, situacao = ''): string {
  const inf = recortarElemento(xml, 'infNFe');
  if (!inf) throw new Error('O XML informado não contém uma NF-e.');
  const chave = (inf.match(/Id="NFe(\d{44})"/) || [])[1] || '';
  const ide = recortarElemento(inf, 'ide') || '';
  const emit = recortarElemento(inf, 'emit') || '';
  const dest = recortarElemento(inf, 'dest') || '';
  const tot = recortarElemento(inf, 'ICMSTot') || '';
  const transp = recortarElemento(inf, 'transp') || '';
  const cobr = recortarElemento(inf, 'cobr') || '';
  const adic = recortarElemento(inf, 'infAdic') || '';
  const prot = recortarElemento(xml, 'infProt') || '';
  const ee = recortarElemento(emit, 'enderEmit') || '';
  const ed = recortarElemento(dest, 'enderDest') || '';
  const v = (x: string, t: string) => valorTag(x, t);
  const homolog = v(ide, 'tpAmb') === '2';
  const nNF = v(ide, 'nNF').padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3');
  const serie = v(ide, 'serie').padStart(3, '0');
  const protocolo = v(prot, 'nProt') ? `${v(prot, 'nProt')} - ${paraBR(v(prot, 'dhRecbto'))}` : 'NF-e não autorizada';
  const tarja = situacao || (homolog ? 'SEM VALOR FISCAL' : !v(prot, 'nProt') ? 'NÃO AUTORIZADA' : '');

  const itens = blocos(inf, 'det')
    .map((d) => {
      const prod = recortarElemento(d, 'prod') || '';
      const icms = recortarElemento(d, 'ICMS') || '';
      const ipi = recortarElemento(d, 'IPI') || '';
      const cst = v(icms, 'orig') + (v(icms, 'CST') || v(icms, 'CSOSN'));
      return `<tr><td>${esc(v(prod, 'cProd'))}</td><td>${esc(v(prod, 'xProd'))}${v(d, 'infAdProd') ? `<br><i>${esc(v(d, 'infAdProd'))}</i>` : ''}</td>
        <td class="cen">${esc(v(prod, 'NCM'))}</td><td class="cen">${esc(cst)}</td><td class="cen">${esc(v(prod, 'CFOP'))}</td><td class="cen">${esc(v(prod, 'uCom'))}</td>
        <td class="dir">${moeda(v(prod, 'qCom'), 4)}</td><td class="dir">${moeda(v(prod, 'vUnCom'), 4)}</td><td class="dir">${moeda(v(prod, 'vProd'))}</td>
        <td class="dir">${moeda(v(prod, 'vDesc') || 0)}</td><td class="dir">${moeda(v(icms, 'vBC') || 0)}</td><td class="dir">${moeda(v(icms, 'vICMS') || 0)}</td>
        <td class="dir">${moeda(v(ipi, 'vIPI') || 0)}</td><td class="dir">${moeda(v(icms, 'pICMS') || 0)}</td><td class="dir">${moeda(v(ipi, 'pIPI') || 0)}</td></tr>`;
    })
    .join('');

  const dups = blocos(cobr, 'dup')
    .map((d) => `<td><span class="r">${esc(v(d, 'nDup'))}</span><span class="v">${paraBR(v(d, 'dVenc'), false)} &nbsp; ${moeda(v(d, 'vDup'))}</span></td>`)
    .join('');

  const docDest = cnpjCpf(v(dest, 'CNPJ') || v(dest, 'CPF'));
  const modFrete: Record<string, string> = { '0': '0-Emitente', '1': '1-Destinatário', '2': '2-Terceiros', '3': '3-Próprio rem.', '4': '4-Próprio dest.', '9': '9-Sem frete' };

  return `<!doctype html><html><head><meta charset="utf-8"><title>DANFE ${nNF}</title><style>${ESTILO}</style></head><body>
  ${tarja ? `<div class="tarja">${esc(tarja)}</div>` : ''}
  <table><tr>
    <td style="width:80%"><span class="r">Recebemos de ${esc(v(emit, 'xNome'))} os produtos/serviços constantes da nota fiscal indicada ao lado</span>
      <table style="margin-top:6px"><tr>${campo('Data de recebimento', '')}${campo('Identificação e assinatura do recebedor', '')}</tr></table></td>
    <td class="cen"><b style="font-size:11px">NF-e</b><br><b>Nº ${nNF}</b><br><b>SÉRIE ${serie}</b></td>
  </tr></table>
  <div style="border-top:1px dashed #444;margin:4px 0"></div>
  <table><tr>
    <td style="width:38%"><b style="font-size:10px">${esc(v(emit, 'xNome'))}</b><br>
      ${esc(v(ee, 'xLgr'))}, ${esc(v(ee, 'nro'))} ${esc(v(ee, 'xCpl'))}<br>${esc(v(ee, 'xBairro'))} - ${esc(v(ee, 'CEP'))}<br>${esc(v(ee, 'xMun'))} - ${esc(v(ee, 'UF'))} ${esc(v(ee, 'fone'))}</td>
    <td style="width:17%" class="cen"><b style="font-size:13px">DANFE</b><br><span style="font-size:6px">Documento Auxiliar da Nota Fiscal Eletrônica</span><br>
      <span style="font-size:7px">0 - ENTRADA<br>1 - SAÍDA</span> <b style="font-size:13px;border:1px solid #000;padding:0 4px">${esc(v(ide, 'tpNF'))}</b><br>
      <b>Nº ${nNF}<br>SÉRIE ${serie}</b><br>FOLHA 1/1</td>
    <td>${chave ? barrasSvg(chave) : ''}<span class="r">Chave de acesso</span><span class="v cen">${esc(chave.replace(/(\d{4})/g, '$1 ').trim())}</span>
      <span class="cen" style="display:block;font-size:7px">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora</span></td>
  </tr></table>
  <table><tr>${campo('Natureza da operação', v(ide, 'natOp'), '', 2)}${campo('Protocolo de autorização de uso', protocolo)}</tr>
    <tr>${campo('Inscrição estadual', v(emit, 'IE'))}${campo('Insc. est. do subst. trib.', v(emit, 'IEST'))}${campo('CNPJ', cnpjCpf(v(emit, 'CNPJ')))}</tr></table>
  <div class="t">Destinatário / remetente</div>
  <table><tr>${campo('Nome / razão social', v(dest, 'xNome'), '', 2)}${campo('CNPJ / CPF', docDest)}${campo('Data da emissão', paraBR(v(ide, 'dhEmi'), false))}</tr>
    <tr>${campo('Endereço', `${v(ed, 'xLgr')}, ${v(ed, 'nro')} ${v(ed, 'xCpl')}`)}${campo('Bairro / distrito', v(ed, 'xBairro'))}${campo('CEP', v(ed, 'CEP'))}${campo('Data da saída/entrada', paraBR(v(ide, 'dhSaiEnt'), false))}</tr>
    <tr>${campo('Município', v(ed, 'xMun'))}${campo('UF', v(ed, 'UF'))}${campo('Inscrição estadual', v(dest, 'IE'))}${campo('Hora da saída/entrada', (v(ide, 'dhSaiEnt').match(/T(\d\d:\d\d:\d\d)/) || [])[1] || '')}</tr></table>
  ${dups ? `<div class="t">Fatura / duplicatas</div><table><tr>${dups}</tr></table>` : ''}
  <div class="t">Cálculo do imposto</div>
  <table><tr>${campo('Base de cálc. do ICMS', moeda(v(tot, 'vBC')), 'dir')}${campo('Valor do ICMS', moeda(v(tot, 'vICMS')), 'dir')}${campo('Base cálc. ICMS ST', moeda(v(tot, 'vBCST')), 'dir')}${campo('Valor do ICMS ST', moeda(v(tot, 'vST')), 'dir')}${campo('V. total produtos', moeda(v(tot, 'vProd')), 'dir')}</tr>
    <tr>${campo('Valor do frete', moeda(v(tot, 'vFrete')), 'dir')}${campo('Valor do seguro', moeda(v(tot, 'vSeg')), 'dir')}${campo('Desconto', moeda(v(tot, 'vDesc')), 'dir')}${campo('Outras despesas', moeda(v(tot, 'vOutro')), 'dir')}${campo('Valor total da nota', moeda(v(tot, 'vNF')), 'dir')}</tr>
    <tr>${campo('Valor do IPI', moeda(v(tot, 'vIPI')), 'dir')}${campo('Valor do PIS', moeda(v(tot, 'vPIS')), 'dir')}${campo('Valor da COFINS', moeda(v(tot, 'vCOFINS')), 'dir')}${campo('Valor aprox. tributos', moeda(v(tot, 'vTotTrib') || 0), 'dir', 2)}</tr></table>
  <div class="t">Transportador / volumes transportados</div>
  <table><tr>${campo('Razão social', v(transp, 'xNome'), '', 2)}${campo('Frete por conta', modFrete[v(transp, 'modFrete')] || v(transp, 'modFrete'))}${campo('Placa', v(transp, 'placa'))}${campo('CNPJ / CPF', cnpjCpf(v(transp, 'CNPJ') || v(transp, 'CPF')))}</tr></table>
  <div class="t">Dados dos produtos / serviços</div>
  <table class="itens"><tr><th>Código</th><th>Descrição</th><th>NCM/SH</th><th>CST</th><th>CFOP</th><th>Un</th><th>Qtd</th><th>V. unit.</th><th>V. total</th><th>Desc.</th><th>BC ICMS</th><th>V. ICMS</th><th>V. IPI</th><th>% ICMS</th><th>% IPI</th></tr>${itens}</table>
  <div class="t">Dados adicionais</div>
  <table><tr><td style="height:60px;width:65%"><span class="r">Informações complementares</span>${esc(v(adic, 'infCpl'))}${v(adic, 'infAdFisco') ? `<br>${esc(v(adic, 'infAdFisco'))}` : ''}</td><td><span class="r">Reservado ao fisco</span></td></tr></table>
  </body></html>`;
}

/** Impressão de evento (carta de correção ou cancelamento) a partir do procEventoNFe ou do par pedido/retorno */
export function htmlEvento(pedido: string, retorno: string, dados: { emitente: string; numero: string; serie: string }): string {
  const inf = recortarElemento(pedido, 'infEvento') || '';
  const v = (x: string, t: string) => valorTag(x, t);
  const correcao = v(inf, 'xCorrecao');
  const titulo = v(inf, 'tpEvento') === '110110' ? 'CARTA DE CORREÇÃO ELETRÔNICA' : v(inf, 'descEvento').toUpperCase();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${ESTILO} body{font-size:10px} .v{font-size:10px}</style></head><body>
  <h2 style="text-align:center;margin:4px 0">${esc(titulo)}</h2>
  <table><tr>${campo('Emitente', dados.emitente, '', 2)}${campo('CNPJ', cnpjCpf(v(inf, 'CNPJ')))}</tr>
    <tr>${campo('Chave de acesso da NF-e', v(inf, 'chNFe'), '', 2)}${campo('NF-e / série', `${dados.numero} / ${dados.serie}`)}</tr>
    <tr>${campo('Evento', `${v(inf, 'tpEvento')} - ${v(inf, 'descEvento')}`)}${campo('Sequência', v(inf, 'nSeqEvento'))}${campo('Data do evento', paraBR(v(inf, 'dhEvento')))}</tr>
    <tr>${campo('Protocolo', v(retorno, 'nProt'))}${campo('Registrado em', paraBR(v(retorno, 'dhRegEvento')))}${campo('Situação', `${v(retorno, 'cStat')} - ${v(retorno, 'xMotivo')}`)}</tr></table>
  ${correcao ? `<div class="t">Correção a ser considerada</div><table><tr><td style="height:120px;font-size:11px">${esc(correcao)}</td></tr></table>` : ''}
  ${v(inf, 'xJust') ? `<div class="t">Justificativa</div><table><tr><td style="height:60px;font-size:11px">${esc(v(inf, 'xJust'))}</td></tr></table>` : ''}
  ${v(inf, 'xCondUso') ? `<div class="t">Condições de uso</div><table><tr><td style="font-size:8px">${esc(v(inf, 'xCondUso'))}</td></tr></table>` : ''}
  </body></html>`;
}
