/**
 * Operações com a SEFAZ: os botões das abas Consultas, Eventos, Inutilização,
 * Envios e Distribuição DF-e do exemplo Delphi.
 *
 * Cada função monta a mensagem XML do layout 4.00, assina quando é exigido,
 * transmite pelo SOAP e devolve um retorno já digerido (cStat, xMotivo, XML).
 */
import { Contexto, registrarLog } from './contexto.js';
import { assinar } from './assinatura.js';
import { enviarSoap } from './soap.js';
import { Ambiente, CODIGO_UF, NomeServico, resolverServico, VERSAO_LAYOUT, ufPorCodigo } from './servicos.js';
import { DECLARACAO, NS_NFE, limparTexto, recortarElemento, semDeclaracao, tag, valorTag } from './xml.js';
import { dataHoraDFe, agora } from './datas.js';
import { acharTipoEvento, COND_USO_CCE } from './eventos.js';
import { chaveValida, lerChave } from './chave.js';
import { exigirValido, validarEvento, validarInutilizacao, validarNFe } from './validacao.js';

export interface Retorno {
  sucesso: boolean;
  cStat: number;
  xMotivo: string;
  /** XML de resposta do serviço, já sem o envelope SOAP */
  xml: string;
  /** Envelope enviado, exibido na aba "Dados" */
  envio: string;
  /** Resposta HTTP completa, exibida na aba "Retorno Completo WS" */
  retornoCompleto: string;
  url: string;
  duracaoMs: number;
  /** Campos extras específicos de cada operação */
  dados?: Record<string, any>;
}

/** A forma de emissão redireciona para as SEFAZ virtuais (ACBrNFe.LerServicoDeParams) */
function ufDoServico(ctx: Contexto): string {
  switch (ctx.config.geral.formaEmissao) {
    case 6:
      return 'SVC-AN';
    case 7:
      return 'SVC-RS';
    default:
      return ctx.config.webservice.uf;
  }
}

async function transmitir(
  ctx: Contexto,
  operacao: string,
  servico: NomeServico,
  mensagem: string,
  opcoes: {
    uf?: string;
    chave?: string;
    elementoCorpo?: string;
    cabecalho?: { cUF: number; versaoDados: string };
    versaoServico?: string;
    ambienteNacional?: boolean;
  } = {},
): Promise<Retorno> {
  const ambiente = ctx.config.webservice.ambiente as Ambiente;
  const resolvido = opcoes.ambienteNacional
    ? resolverServico('NFe', 'AN', ambiente, servico, opcoes.versaoServico)
    : resolverServico(
        ctx.modelo,
        opcoes.uf || ufDoServico(ctx),
        ambiente,
        servico,
        opcoes.versaoServico,
      );

  const resposta = await enviarSoap({
    servico: resolvido,
    mensagem,
    certificado: ctx.certificado,
    elementoCorpo: opcoes.elementoCorpo,
    cabecalho: opcoes.cabecalho,
    timeoutMs: (ctx.config.webservice.timeout || 30) * 1000,
  });

  const cStat = Number(valorTag(resposta.retorno, 'cStat') || 0);
  const xMotivo = valorTag(resposta.retorno, 'xMotivo');

  const retorno: Retorno = {
    // Um cStat na faixa 100-199 é aceitação; o resto é rejeição ou aviso
    sucesso: cStat >= 100 && cStat < 200,
    cStat,
    xMotivo,
    xml: resposta.retorno,
    envio: resposta.envelope,
    retornoCompleto: resposta.retornoCompleto,
    url: resolvido.url,
    duracaoMs: resposta.duracaoMs,
  };

  await registrarLog(ctx, {
    operacao,
    url: resolvido.url,
    chave: opcoes.chave,
    sucesso: retorno.sucesso,
    codigoStatus: cStat,
    motivo: xMotivo,
    duracaoMs: resposta.duracaoMs,
    envio: resposta.envelope,
    retorno: resposta.retornoCompleto,
  });

  return retorno;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Status do serviço na SEFAZ da UF configurada */
export async function statusServico(ctx: Contexto): Promise<Retorno> {
  const uf = ufDoServico(ctx);
  const cUF = CODIGO_UF[uf.toUpperCase()] ?? CODIGO_UF[ctx.emitente.uf];

  const mensagem =
    `<consStatServ versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('cUF', cUF) +
    '<xServ>STATUS</xServ>' +
    '</consStatServ>';

  const ret = await transmitir(ctx, 'statusServico', 'NFeStatusServico', mensagem, { uf });

  ret.dados = {
    ambiente: Number(valorTag(ret.xml, 'tpAmb')),
    uf: ufPorCodigo(valorTag(ret.xml, 'cUF')),
    versaoAplicacao: valorTag(ret.xml, 'verAplic'),
    dataHoraRetorno: valorTag(ret.xml, 'dhRecbto'),
    tempoMedioResposta: valorTag(ret.xml, 'tMed'),
    dataHoraRetorno2: valorTag(ret.xml, 'dhRetorno'),
    observacao: valorTag(ret.xml, 'xObs'),
  };
  return ret;
}

/** Situação de uma NF-e pela chave de acesso */
export async function consultarChave(ctx: Contexto, chave: string): Promise<Retorno> {
  const limpa = chave.replace(/\D/g, '');
  if (!chaveValida(limpa)) throw new Error('Chave de acesso inválida (44 dígitos e dígito verificador).');

  const mensagem =
    `<consSitNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    '<xServ>CONSULTAR</xServ>' +
    tag('chNFe', limpa) +
    '</consSitNFe>';

  const ret = await transmitir(ctx, 'consultarChave', 'NFeConsultaProtocolo', mensagem, {
    chave: limpa,
    // A consulta vai para a UF que emitiu a nota, que pode não ser a configurada
    uf: ufPorCodigo(lerChave(limpa).cUF) || undefined,
  });

  ret.dados = {
    chave: limpa,
    protocolo: valorTag(ret.xml, 'nProt'),
    dataAutorizacao: valorTag(ret.xml, 'dhRecbto'),
    digestValue: valorTag(ret.xml, 'digVal'),
    protNFe: recortarElemento(ret.xml, 'protNFe'),
    eventos: recortarElemento(ret.xml, 'procEventoNFe'),
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Inutilização
// ---------------------------------------------------------------------------

export interface PedidoInutilizacao {
  ano: number;
  modelo: string;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
}

/** Monta e assina o <inutNFe>, sem transmitir. Separado para o autoteste validar o XML real. */
export function montarInutilizacao(ctx: Contexto, p: PedidoInutilizacao): { id: string; assinado: string } {
  const justificativa = limparTexto(p.justificativa);
  if (justificativa.length < 15) {
    throw new Error('A justificativa da inutilização precisa ter ao menos 15 caracteres.');
  }
  if (p.numeroFinal < p.numeroInicial) {
    throw new Error('O número final precisa ser maior ou igual ao inicial.');
  }

  const cUF = CODIGO_UF[ctx.config.webservice.uf.toUpperCase()];
  const id =
    'ID' +
    String(cUF).padStart(2, '0') +
    String(p.ano).slice(-2) +
    ctx.emitente.cnpj.padStart(14, '0') +
    String(p.modelo).padStart(2, '0') +
    String(p.serie).padStart(3, '0') +
    String(p.numeroInicial).padStart(9, '0') +
    String(p.numeroFinal).padStart(9, '0');

  const corpo =
    `<inutNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    `<infInut Id="${id}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    '<xServ>INUTILIZAR</xServ>' +
    tag('cUF', cUF) +
    tag('ano', String(p.ano).slice(-2)) +
    tag('CNPJ', ctx.emitente.cnpj) +
    tag('mod', p.modelo) +
    tag('serie', p.serie) +
    tag('nNFIni', p.numeroInicial) +
    tag('nNFFin', p.numeroFinal) +
    tag('xJust', justificativa) +
    '</infInut></inutNFe>';

  return { id, assinado: assinar(corpo, 'infInut', id, ctx.certificado) };
}

export async function inutilizar(ctx: Contexto, p: PedidoInutilizacao): Promise<Retorno> {
  const { id, assinado } = montarInutilizacao(ctx, p);

  exigirValido(
    await validarInutilizacao(assinado),
    'Falha na validação dos dados da inutilização.',
    ctx.config.geral.exibirErroSchema,
  );

  const ret = await transmitir(ctx, 'inutilizar', 'NfeInutilizacao', assinado);

  ret.dados = {
    id,
    protocolo: valorTag(ret.xml, 'nProt'),
    dataRecebimento: valorTag(ret.xml, 'dhRecbto'),
    xmlEnvio: assinado,
    /** Arquivo de distribuição, que é o que se guarda */
    procInutNFe:
      ret.cStat === 102
        ? `${DECLARACAO}<ProcInutNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
          `${semDeclaracao(assinado)}${recortarElemento(ret.xml, 'retInutNFe') || ''}</ProcInutNFe>`
        : null,
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface PedidoEvento {
  chave: string;
  tipoEvento: string;
  sequencia?: number;
  justificativa?: string;
  protocolo?: string;
  correcao?: string;
  /** Campos livres de eventos que não têm campo dedicado (ex.: ator interessado) */
  extras?: Record<string, string>;
}

function montarDetEvento(tipo: ReturnType<typeof acharTipoEvento>, p: PedidoEvento): string {
  const partes: string[] = [tag('descEvento', tipo.descEvento)];

  if (tipo.exigeProtocolo) {
    if (!p.protocolo) throw new Error('Informe o número do protocolo de autorização da NF-e.');
    partes.push(tag('nProt', p.protocolo));
  }

  if (tipo.exigeCorrecao) {
    const correcao = limparTexto(p.correcao || '');
    if (correcao.length < 15) throw new Error('O texto da correção precisa ter ao menos 15 caracteres.');
    partes.push(tag('xCorrecao', correcao), tag('xCondUso', COND_USO_CCE));
  }

  if (tipo.exigeJustificativa && !tipo.exigeCorrecao) {
    const justificativa = limparTexto(p.justificativa || '');
    if (justificativa.length < 15) throw new Error('A justificativa precisa ter ao menos 15 caracteres.');
    partes.push(tag('xJust', justificativa));
  }

  for (const [nome, valor] of Object.entries(p.extras || {})) {
    partes.push(tag(nome, limparTexto(valor)));
  }

  return `<detEvento versao="1.00">${partes.join('')}</detEvento>`;
}

/** Monta e assina o lote <envEvento>, sem transmitir. Separado para o autoteste validar o XML real. */
export function montarEvento(ctx: Contexto, p: PedidoEvento) {
  const chave = p.chave.replace(/\D/g, '');
  if (!chaveValida(chave)) throw new Error('Chave de acesso inválida.');

  const tipo = acharTipoEvento(p.tipoEvento);
  const sequencia = p.sequencia || 1;
  const id = `ID${tipo.codigo}${chave}${String(sequencia).padStart(2, '0')}`;
  const cOrgao = tipo.orgaoNacional ? 91 : lerChave(chave).cUF;

  const infEvento =
    `<infEvento Id="${id}">` +
    tag('cOrgao', cOrgao) +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('CNPJ', ctx.emitente.cnpj) +
    tag('chNFe', chave) +
    tag('dhEvento', dataHoraDFe()) +
    tag('tpEvento', tipo.codigo) +
    tag('nSeqEvento', sequencia) +
    '<verEvento>1.00</verEvento>' +
    montarDetEvento(tipo, p) +
    '</infEvento>';

  const evento = `<evento versao="1.00" xmlns="${NS_NFE}">${infEvento}</evento>`;
  const eventoAssinado = assinar(evento, 'infEvento', id, ctx.certificado);

  const mensagem =
    `<envEvento versao="1.00" xmlns="${NS_NFE}">` +
    tag('idLote', '1') +
    semDeclaracao(eventoAssinado).replace(` xmlns="${NS_NFE}"`, '') +
    '</envEvento>';

  return { chave, tipo, sequencia, id, cOrgao, eventoAssinado, mensagem };
}

export async function enviarEvento(ctx: Contexto, p: PedidoEvento): Promise<Retorno> {
  const { chave, tipo, sequencia, id, cOrgao, eventoAssinado, mensagem } = montarEvento(ctx, p);

  exigirValido(
    await validarEvento(mensagem, tipo.codigo),
    `Falha na validação dos dados do evento (${tipo.descricao}).`,
    ctx.config.geral.exibirErroSchema,
  );

  const ret = await transmitir(ctx, `evento_${tipo.codigo}`, 'RecepcaoEvento', mensagem, {
    chave,
    uf: tipo.orgaoNacional ? 'AN' : ufPorCodigo(cOrgao) || undefined,
    ambienteNacional: tipo.orgaoNacional,
  });

  const retEvento = recortarElemento(ret.xml, 'retEvento') || '';
  const cStatEvento = Number(valorTag(retEvento, 'cStat') || ret.cStat);

  // O lote pode ser aceito (128) com o evento dentro rejeitado: vale o de dentro
  ret.cStat = cStatEvento || ret.cStat;
  ret.xMotivo = valorTag(retEvento, 'xMotivo') || ret.xMotivo;
  ret.sucesso = [135, 136, 155].includes(ret.cStat);

  ret.dados = {
    id,
    tipoEvento: tipo.codigo,
    descricao: tipo.descricao,
    sequencia,
    protocolo: valorTag(retEvento, 'nProt'),
    dataRegistro: valorTag(retEvento, 'dhRegEvento'),
    xmlEnvio: eventoAssinado,
    procEventoNFe: ret.sucesso
      ? `${DECLARACAO}<procEventoNFe versao="1.00" xmlns="${NS_NFE}">` +
        `${semDeclaracao(eventoAssinado).replace(` xmlns="${NS_NFE}"`, '')}${retEvento}</procEventoNFe>`
      : null,
  };
  return ret;
}

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

/**
 * Envia a NF-e já assinada. Em modo síncrono (indSinc=1) o protocolo vem na
 * mesma resposta; em assíncrono a SEFAZ devolve um recibo a consultar depois.
 */
export async function autorizar(
  ctx: Contexto,
  xmlNFe: string,
  opcoes: { idLote?: string; sincrono?: boolean } = {},
): Promise<Retorno> {
  const sincrono = opcoes.sincrono !== false;
  const chave = (xmlNFe.match(/Id="NFe(\d{44})"/) || [])[1];

  // Também cobre XML importado ou editado fora do sistema: nada sai sem passar no schema
  exigirValido(
    await validarNFe(xmlNFe),
    `Falha na validação dos dados da nota: ${Number(valorTag(xmlNFe, 'nNF')) || ''}`.trim(),
    ctx.config.geral.exibirErroSchema,
  );

  const mensagem =
    `<enviNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('idLote', opcoes.idLote || String(Date.now()).slice(-15)) +
    tag('indSinc', sincrono ? 1 : 0) +
    semDeclaracao(xmlNFe).replace(` xmlns="${NS_NFE}"`, ` xmlns="${NS_NFE}"`) +
    '</enviNFe>';

  const ret = await transmitir(ctx, 'autorizar', 'NFeAutorizacao', mensagem, { chave });

  const protNFe = recortarElemento(ret.xml, 'protNFe');
  const cStatNota = protNFe ? Number(valorTag(protNFe, 'cStat')) : 0;

  ret.dados = {
    chave,
    recibo: valorTag(ret.xml, 'nRec'),
    // 103 = lote recebido (assíncrono); 104 = lote processado (síncrono)
    loteProcessado: ret.cStat === 104,
    cStatNota,
    motivoNota: protNFe ? valorTag(protNFe, 'xMotivo') : '',
    protocolo: protNFe ? valorTag(protNFe, 'nProt') : '',
    protNFe,
    autorizada: cStatNota === 100 || cStatNota === 150,
  };
  return ret;
}

/** Consulta o recibo de um lote enviado em modo assíncrono */
export async function consultarRecibo(ctx: Contexto, recibo: string): Promise<Retorno> {
  const mensagem =
    `<consReciNFe versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    tag('tpAmb', ctx.config.webservice.ambiente) +
    tag('nRec', recibo.replace(/\D/g, '')) +
    '</consReciNFe>';

  const ret = await transmitir(ctx, 'consultarRecibo', 'NFeRetAutorizacao', mensagem);

  const protNFe = recortarElemento(ret.xml, 'protNFe');
  ret.dados = {
    recibo,
    // 105 = lote em processamento; vale tentar de novo
    emProcessamento: ret.cStat === 105,
    protNFe,
    cStatNota: protNFe ? Number(valorTag(protNFe, 'cStat')) : 0,
    motivoNota: protNFe ? valorTag(protNFe, 'xMotivo') : '',
    protocolo: protNFe ? valorTag(protNFe, 'nProt') : '',
    chave: protNFe ? valorTag(protNFe, 'chNFe') : '',
  };
  return ret;
}

/** Junta a NF-e assinada ao protocolo de autorização: é o XML que vale como documento */
export function montarProcNFe(xmlNFe: string, protNFe: string): string {
  return (
    `${DECLARACAO}<nfeProc versao="${VERSAO_LAYOUT}" xmlns="${NS_NFE}">` +
    semDeclaracao(xmlNFe).replace(` xmlns="${NS_NFE}"`, ` xmlns="${NS_NFE}"`) +
    protNFe +
    '</nfeProc>'
  );
}

/** Data/hora atual no formato do layout — reexportada para as rotas */
export { dataHoraDFe, agora };
