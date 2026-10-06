/**
 * Assinatura XMLDSig no perfil da NF-e (RSA-SHA1, digest SHA-1, C14N 1.0 inclusiva, enveloped),
 * com o crypto do próprio Node.
 *
 * O nfeWeb usa xml-crypto; aqui não precisa: o XML assinado é sempre o que o próprio sistema monta
 * (gerarNFe, evento, inutilização) — sem espaços entre tags, sem comentários, aspas duplas nos
 * atributos e sem elementos vazios <x/> —, e para esse XML a canonicalização se resume a:
 *   - declarar no elemento assinado o namespace herdado do pai (C14N inclusiva);
 *   - ordenar os atributos (xmlns primeiro, depois por nome);
 *   - no texto, &quot; e &apos; viram o próprio caractere (o C14N só escapa & < > e CR).
 * A assinatura entra como último filho do pai do elemento assinado (<NFe>, <evento>, <inutNFe>).
 */
import crypto from 'crypto';

const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

export interface DadosAssinatura {
  chavePrivadaPem: string;
  certificadoPem: string;
}

function atributos(texto: string): [string, string][] {
  return [...texto.matchAll(/([^\s=]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]);
}

/** C14N de um elemento do XML gerado pelo sistema; `ns` = namespace padrão herdado do pai */
export function canonicalizar(elemento: string, ns: string): string {
  const pilhaNs: string[] = [];
  let r = '';
  for (const m of elemento.matchAll(/<\/[^>]+>|<\?[^>]*\?>|<[^>]+>|[^<]+/g)) {
    const t = m[0];
    if (t.startsWith('<?')) continue;
    if (t.startsWith('</')) {
      pilhaNs.pop();
      r += t.replace(/\s+>/, '>');
      continue;
    }
    if (t.startsWith('<')) {
      const auto = t.endsWith('/>');
      const corpo = t.slice(1, auto ? -2 : -1).trim();
      const nome = corpo.split(/\s/)[0];
      const attrs = atributos(corpo.slice(nome.length));
      const herdado = pilhaNs.length ? pilhaNs[pilhaNs.length - 1] : ns;
      let proprio = attrs.find(([k]) => k === 'xmlns')?.[1];
      const outros = attrs.filter(([k]) => k !== 'xmlns').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      // No elemento raiz do recorte o namespace herdado aparece; nos filhos, só se mudar
      const declarar = pilhaNs.length === 0 ? (proprio ?? ns) : proprio !== undefined && proprio !== herdado ? proprio : undefined;
      proprio = proprio ?? herdado;
      r += `<${nome}${declarar ? ` xmlns="${declarar}"` : ''}${outros.map(([k, v]) => ` ${k}="${v}"`).join('')}>`;
      if (auto) r += `</${nome}>`;
      else pilhaNs.push(proprio);
      continue;
    }
    r += t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\r/g, '&#xD;');
  }
  return r;
}

function elementoComId(xml: string, elemento: string, id: string): string {
  const ini = xml.search(new RegExp(`<${elemento}[\\s>][^>]*Id="${id}"`));
  if (ini < 0) throw new Error(`Elemento ${elemento} Id="${id}" não encontrado para assinar.`);
  const fim = xml.indexOf(`</${elemento}>`, ini);
  if (fim < 0) throw new Error(`Elemento ${elemento} sem fechamento.`);
  return xml.slice(ini, fim + elemento.length + 3);
}

/** Namespace padrão em vigor no ponto `pos` do documento (o xmlns do ancestral mais próximo) */
function nsEm(xml: string, pos: number): string {
  const antes = xml.slice(0, pos);
  const m = [...antes.matchAll(/<[A-Za-z][^>]*\sxmlns="([^"]+)"[^>]*>/g)];
  return m.length ? m[m.length - 1][1] : '';
}

function signedInfo(id: string, digest: string, comNs: boolean) {
  return (
    `<SignedInfo${comNs ? ` xmlns="${NS_DSIG}"` : ''}>` +
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${NS_DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${NS_DSIG}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${NS_DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  );
}

const base64Cert = (pem: string) => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

/**
 * @param xml       documento inteiro (com ou sem declaração)
 * @param elemento  infNFe, infEvento ou infInut
 * @param id        atributo Id do elemento, sem "#"
 */
export function assinar(xml: string, elemento: string, id: string, cert: DadosAssinatura): string {
  const alvo = elementoComId(xml, elemento, id);
  const inicio = xml.indexOf(alvo);
  const digest = crypto.createHash('sha1').update(canonicalizar(alvo, nsEm(xml, inicio)), 'utf8').digest('base64');
  const valor = crypto.createSign('RSA-SHA1').update(signedInfo(id, digest, true), 'utf8').sign(cert.chavePrivadaPem, 'base64');
  const assinatura =
    `<Signature xmlns="${NS_DSIG}">${signedInfo(id, digest, false)}<SignatureValue>${valor}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${base64Cert(cert.certificadoPem)}</X509Certificate></X509Data></KeyInfo></Signature>`;
  // Último filho do pai do elemento assinado
  const fimAlvo = inicio + alvo.length;
  const pai = xml.slice(0, inicio).match(/<([A-Za-z][\w:]*)[^>]*>$/)?.[1];
  if (!pai) throw new Error('Não foi possível achar o elemento pai da assinatura.');
  const fechaPai = xml.indexOf(`</${pai}>`, fimAlvo);
  return xml.slice(0, fechaPai) + assinatura + xml.slice(fechaPai);
}

/** Confere digest e assinatura de um XML assinado por `assinar` (usado nos testes) */
/** `chavePublica` (PEM) no lugar do certificado embutido: testes com chave gerada na hora */
export function conferirAssinatura(xml: string, elemento: string, chavePublica?: string): { valida: boolean; erros: string[] } {
  const erros: string[] = [];
  const id = xml.match(new RegExp(`<${elemento}[^>]*Id="([^"]+)"`))?.[1];
  const digest = xml.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
  const valor = xml.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)?.[1];
  const cert = xml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/)?.[1];
  if (!id || !digest || !valor || !cert) return { valida: false, erros: ['Assinatura incompleta.'] };
  const alvo = elementoComId(xml, elemento, id);
  const calculado = crypto.createHash('sha1').update(canonicalizar(alvo, nsEm(xml, xml.indexOf(alvo))), 'utf8').digest('base64');
  if (calculado !== digest) erros.push('DigestValue não confere com o conteúdo.');
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  let ok = false;
  try {
    ok = crypto.createVerify('RSA-SHA1').update(signedInfo(id, digest, true), 'utf8').verify(chavePublica ?? pem, valor, 'base64');
  } catch (e: any) {
    erros.push(`Certificado ilegível: ${e.message}`);
  }
  if (!ok) erros.push('SignatureValue não confere.');
  return { valida: erros.length === 0, erros };
}
