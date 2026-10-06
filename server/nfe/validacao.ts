/**
 * Validação dos XMLs contra os schemas oficiais (recursos/Schemas), antes de
 * qualquer coisa ir para a SEFAZ.
 *
 * O validador é o xmllint da libxml2 compilado para WebAssembly (xmllint-wasm):
 * roda dentro do Node, sem binário nativo nem programa externo, e funciona em
 * serverless. É o mesmo motor que o ACBr usa por baixo do SSL.Validar.
 *
 * O comportamento segue o ACBr (ACBrNFeNotasFiscais.Validar e
 * TNFeEnvEvento.DefinirDadosMsg):
 *   - a validação sempre roda e, se falhar, o envio é barrado;
 *   - "Exibir erro de schema" (config.geral.exibirErroSchema) só decide se a
 *     mensagem traz o detalhe do schema ou apenas o aviso curto;
 *   - evento é validado em duas etapas: o lote <envEvento> contra o schema
 *     genérico e cada <detEvento> contra o schema do seu código (e110111 etc.).
 */
import fs from 'fs';
import path from 'path';

// xmllint-wasm ainda não é dependência do printControl: carregado sob demanda. Sem ele a validação XSD
// é pulada (resultado com `pulada: true`) e a SEFAZ continua sendo a última barreira.
const XMLLINT = 'xmllint-wasm';
let validador: ((o: any) => Promise<any>) | null | undefined;
async function carregarValidador() {
  if (validador !== undefined) return validador;
  try {
    const m: any = await import(/* @vite-ignore */ XMLLINT);
    validador = m.validateXML ?? m.default?.validateXML ?? null;
  } catch {
    validador = null;
  }
  return validador;
}
import { arquivoRecurso } from './recursos.js';
import { NS_NFE, recortarElemento } from './xml.js';

export interface ErroSchema {
  /** Nome do elemento com problema, quando o validador informa */
  campo?: string;
  mensagem: string;
}

export interface ResultadoValidacao {
  valido: boolean;
  /** Validador XSD indisponível (dependência xmllint-wasm não instalada): nada foi conferido */
  pulada?: boolean;
  /** Arquivo .xsd usado, para o usuário saber contra o quê foi validado */
  schema: string;
  erros: ErroSchema[];
}

/** Erro de schema que barra o envio. As rotas devolvem `erros` para a tela listar. */
export class FalhaSchema extends Error {
  constructor(
    /** Aviso curto, sem o detalhe do schema */
    public readonly aviso: string,
    public readonly erros: ErroSchema[],
    public readonly schema: string,
    /** config.geral.exibirErroSchema: quando falso, o detalhe não sai do servidor */
    public readonly detalhar: boolean,
  ) {
    super(detalhar ? `${aviso}\n${descreverErros(erros)}` : aviso);
    this.name = 'FalhaSchema';
  }
}

// ---------------------------------------------------------------------------
// Conjunto de arquivos de cada schema
// ---------------------------------------------------------------------------

interface ArquivoSchema {
  fileName: string;
  contents: string;
}

const cacheConjuntos = new Map<string, { schema: ArquivoSchema; preload: ArquivoSchema[] }>();

/**
 * Lê o .xsd principal e, recursivamente, tudo o que ele inclui ou importa.
 * O xmllint roda num sistema de arquivos em memória: o que não for pré-carregado
 * simplesmente não existe para ele.
 */
function conjuntoDoSchema(principal: string) {
  const emCache = cacheConjuntos.get(principal);
  if (emCache) return emCache;

  const caminhoPrincipal = arquivoRecurso('Schemas', principal);
  if (!caminhoPrincipal) {
    throw new Error(`Schema "${principal}" não encontrado em server/nfe/recursos/Schemas.`);
  }
  const pasta = path.dirname(caminhoPrincipal);

  const lidos = new Map<string, string>();
  const pendentes = [principal];

  while (pendentes.length) {
    const nome = pendentes.pop()!;
    if (lidos.has(nome)) continue;

    const caminho = path.join(pasta, nome);
    if (!fs.existsSync(caminho)) {
      throw new Error(`O schema "${principal}" depende de "${nome}", que não está em recursos/Schemas.`);
    }

    const conteudo = fs.readFileSync(caminho, 'utf8');
    lidos.set(nome, conteudo);

    for (const m of conteudo.matchAll(/<xs:(?:include|import)\b[^>]*\bschemaLocation="([^"]+)"/g)) {
      pendentes.push(path.basename(m[1]));
    }
  }

  const conjunto = {
    schema: { fileName: principal, contents: lidos.get(principal)! },
    preload: [...lidos.entries()]
      .filter(([nome]) => nome !== principal)
      .map(([fileName, contents]) => ({ fileName, contents })),
  };

  cacheConjuntos.set(principal, conjunto);
  return conjunto;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

/**
 * As mensagens do xmllint vêm em inglês e com o namespace completo em cada
 * elemento. Aqui os casos que aparecem na prática viram português; o resto
 * passa só sem o namespace, que é o que atrapalha a leitura.
 */
function traduzir(bruta: string): ErroSchema {
  let texto = bruta
    .replace(/^.*?Schemas validity error\s*:\s*/i, '')
    .replace(/\{http:\/\/www\.portalfiscal\.inf\.br\/nfe\}/g, '')
    .replace(/\{http:\/\/www\.w3\.org\/2000\/09\/xmldsig#\}/g, '')
    .trim();

  // "Element 'infNFe', attribute 'Id': ..." aponta um atributo, não o conteúdo do elemento
  const alvo = texto.match(/^Element '([^']+)'(?:, attribute '([^']+)')?/);
  const campo = alvo ? (alvo[2] ? `${alvo[1]} (atributo ${alvo[2]})` : alvo[1]) : undefined;
  // "Element 'NCM': [facet 'pattern'] The value..." — a marcação de facet vem depois dos dois-pontos
  const resto = texto.replace(
    /^Element '[^']+'(?:, attribute '[^']+')?(?: \[[^\]]+\])?:\s*(?:\[facet '[^']+'\]\s*)?/,
    '',
  );

  const regras: [RegExp, (...g: string[]) => string][] = [
    [/^This element is not expected\. Expected is(?: one of)? \( (.+?) \)\.?$/,
      (esperado) => `elemento fora de ordem ou inesperado; era esperado: ${esperado}.`],
    [/^This element is not expected\.?$/,
      () => 'elemento não previsto nesta posição.'],
    [/^Missing child element\(s\)\. Expected is(?: one of)? \( (.+?) \)\.?$/,
      (esperado) => `falta elemento obrigatório: ${esperado}.`],
    [/^The value '(.*)' is not accepted by the pattern '(.+)'\.?$/,
      (valor, padrao) => `o valor '${valor}' não atende ao formato exigido (${padrao}).`],
    [/^The value '(.*)' has a length of '(\d+)'; this exceeds the allowed maximum length of '(\d+)'\.?$/,
      (_valor, tem, max) => `tamanho ${tem} excede o máximo de ${max} caracteres.`],
    [/^The value '(.*)' has a length of '(\d+)'; this underruns the allowed minimum length of '(\d+)'\.?$/,
      (_valor, tem, min) => `tamanho ${tem} abaixo do mínimo de ${min} caracteres.`],
    [/^The value '(.*)' is not an element of the set \{(.+)\}\.?$/,
      (valor, conjunto) => `o valor '${valor}' não é permitido; aceitos: ${conjunto}.`],
    [/^'(.*)' is not a valid value of the (?:local |atomic )?type '(.+)'\.?$/,
      (valor, tipo) => `o valor '${valor}' não é válido para o tipo ${tipo}.`],
  ];

  for (const [regex, montar] of regras) {
    const m = resto.match(regex);
    if (m) return { campo, mensagem: montar(...m.slice(1)) };
  }

  return { campo, mensagem: resto || texto };
}

/** Texto único para exceção e log: "NCM: o valor '8471301' não atende..." */
export function descreverErros(erros: ErroSchema[]): string {
  return erros.map((e) => (e.campo ? `${e.campo}: ${e.mensagem}` : e.mensagem)).join('\n');
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export async function validarContraSchema(xml: string, arquivoXsd: string): Promise<ResultadoValidacao> {
  const { schema, preload } = conjuntoDoSchema(arquivoXsd);
  const validateXML = await carregarValidador();
  if (!validateXML) return { valido: true, pulada: true, schema: arquivoXsd, erros: [] };

  const resultado = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [schema],
    preload,
  });

  return {
    valido: resultado.valid,
    schema: arquivoXsd,
    // O xmllint repete a mesma linha às vezes; duplicata só polui a lista
    erros: [...new Set<string>(resultado.errors.map((e: any) => String(e.rawMessage || e.message || "")))]
      .filter((m) => m && !/fails to validate$/i.test(m.trim()))
      .map(traduzir),
  };
}

/** NF-e avulsa (<NFe>) ou já com protocolo (<nfeProc>) */
export async function validarNFe(xml: string): Promise<ResultadoValidacao> {
  const temProtocolo = /<nfeProc[\s>]/.test(xml);
  return validarContraSchema(xml, temProtocolo ? 'procNFe_v4.00.xsd' : 'nfe_v4.00.xsd');
}

export async function validarInutilizacao(xml: string): Promise<ResultadoValidacao> {
  const comProtocolo = /<ProcInutNFe[\s>]/i.test(xml);
  return validarContraSchema(xml, comProtocolo ? 'procInutNFe_v4.00.xsd' : 'inutNFe_v4.00.xsd');
}

/**
 * Evento em duas etapas, como o TNFeEnvEvento: o lote <envEvento> contra o
 * schema genérico e o <detEvento> contra o schema específico do código.
 * Um tipo de evento sem schema próprio passa só pela primeira etapa.
 */
export async function validarEvento(envEvento: string, codigoEvento: string): Promise<ResultadoValidacao> {
  const lote = await validarContraSchema(envEvento, 'envEvento_v1.00.xsd');
  if (!lote.valido) return lote;

  const especifico = `e${codigoEvento}_v1.00.xsd`;
  if (!arquivoRecurso('Schemas', especifico)) return lote;

  const det = recortarElemento(envEvento, 'detEvento');
  if (!det) return { valido: false, schema: especifico, erros: [{ mensagem: 'O evento não tem <detEvento>.' }] };

  // O detEvento é validado sozinho, então precisa carregar o namespace consigo
  const detComNamespace = det.replace(/^<detEvento\b/, `<detEvento xmlns="${NS_NFE}"`);
  return validarContraSchema(detComNamespace, especifico);
}

/** Descobre o tipo do documento pela raiz — usado pelo botão "Validar XML" */
export async function validarQualquer(xml: string): Promise<ResultadoValidacao> {
  if (/<(?:nfeProc|NFe)[\s>]/.test(xml)) return validarNFe(xml);
  if (/<(?:ProcInutNFe|inutNFe)[\s>]/i.test(xml)) return validarInutilizacao(xml);
  if (/<envEvento[\s>]/.test(xml)) {
    return validarEvento(xml, (xml.match(/<tpEvento>(\d{6})<\/tpEvento>/) || [])[1] || '');
  }
  if (/<procEventoNFe[\s>]/.test(xml)) return validarContraSchema(xml, 'procEventoNFe_v1.00.xsd');
  throw new Error('Tipo de XML não reconhecido: esperado NF-e, evento ou inutilização.');
}

/**
 * Barra o envio quando o XML não passa no schema.
 * @param aviso         texto curto, no padrão do ACBr ("Falha na validação dos dados da nota: 12")
 * @param exibirDetalhe config.geral.exibirErroSchema — acrescenta a lista de erros à mensagem
 */
export function exigirValido(resultado: ResultadoValidacao, aviso: string, exibirDetalhe: boolean) {
  if (resultado.valido) return;
  throw new FalhaSchema(aviso, resultado.erros, resultado.schema, exibirDetalhe);
}
