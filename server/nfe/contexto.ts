/**
 * O que toda operação com a SEFAZ precisa: configuração, emitente e certificado — no printControl tudo vem
 * de empresas_filiais (nfe_ambiente P/H, uf, cnpj, ie, simples_normal, arquivo_pfx, senha_pfx), corrigindo
 * o "UF = SC / Homologação" fixo do Delphi. O log vai para a tabela nfe_log do próprio printControl
 * (o nfeWeb tinha tabelas nfe_* próprias, com outra estrutura).
 */
import { pool } from '../db.js';
import { ler } from '../armazenamento.js';
import { carregarPfx, CertificadoCarregado } from './certificado.js';
import { ModeloDFe } from './servicos.js';

export interface Emitente {
  id: number;
  cnpj: string;
  inscricao_estadual: string;
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  codigo_municipio: string;
  municipio: string;
  uf: string;
  cep: string;
  fone: string;
  crt: number;
}

export interface ConfigNFe {
  geral: {
    formaEmissao: number;
    modeloDF: '55' | '65';
    idCSC: string;
    csc: string;
    idCSRT: string;
    csrt: string;
    respTecCNPJ: string;
    respTecContato: string;
    respTecEmail: string;
    respTecFone: string;
    inscricaoMunicipal: string;
    cnae: string;
    exibirErroSchema: boolean;
  };
  webservice: { uf: string; ambiente: 1 | 2; timeout: number };
  danfe: { tipoDanfe: number };
}

export interface Contexto {
  empresaId: number;
  grupoId: number;
  /** Venda da operação em curso, para o nfe_log */
  vendaId?: number | null;
  config: ConfigNFe;
  emitente: Emitente;
  certificado: CertificadoCarregado;
  modelo: ModeloDFe;
}

/** CRT pelo regime da empresa (Delphi: pubEmpresaAtiva.regime 1/2/3): S = Simples (1), N = Normal (3) */
export const crtDaEmpresa = (simplesNormal: string | null | undefined) => (String(simplesNormal || 'S').toUpperCase() === 'N' ? 3 : 1);

export async function carregarEmpresa(empresaId: number, grupoId: number) {
  const [[e]] = await pool.query<any[]>('SELECT * FROM empresas_filiais WHERE id = ? AND id_grupo = ?', [empresaId, grupoId]);
  if (!e) throw new Error('Empresa ativa não encontrada.');
  return e;
}

/** Configuração e emitente sem o certificado (geração do XML para conferência e testes) */
export function configDaEmpresa(e: any): { config: ConfigNFe; emitente: Emitente } {
  if (!e.uf) throw new Error('Informe a UF da empresa (cadastro de Empresas) antes de emitir NF-e.');
  return {
    config: {
      geral: {
        formaEmissao: 1,
        modeloDF: '55',
        idCSC: '',
        csc: '',
        idCSRT: process.env.NFE_RESPTEC_IDCSRT || '',
        csrt: process.env.NFE_RESPTEC_CSRT || '',
        respTecCNPJ: process.env.NFE_RESPTEC_CNPJ || '',
        respTecContato: process.env.NFE_RESPTEC_CONTATO || '',
        respTecEmail: process.env.NFE_RESPTEC_EMAIL || '',
        respTecFone: process.env.NFE_RESPTEC_FONE || '',
        inscricaoMunicipal: '',
        cnae: '',
        exibirErroSchema: true,
      },
      webservice: { uf: String(e.uf).toUpperCase(), ambiente: String(e.nfe_ambiente || 'H').toUpperCase() === 'P' ? 1 : 2, timeout: 30 },
      danfe: { tipoDanfe: 0 },
    },
    emitente: {
      id: e.id,
      cnpj: String(e.cnpj || '').replace(/\D/g, ''),
      inscricao_estadual: String(e.ie || ''),
      razao_social: e.razao_social || e.nome_comercial || '',
      nome_fantasia: e.nome_comercial || '',
      logradouro: e.endereco || '',
      numero: e.numero || '',
      complemento: '',
      bairro: e.bairro || '',
      codigo_municipio: String(e.cod_cidade || ''),
      municipio: e.cidade || '',
      uf: String(e.uf).toUpperCase(),
      cep: String(e.cep || ''),
      fone: '',
      crt: crtDaEmpresa(e.simples_normal),
    },
  };
}

const cacheCertificado = new Map<number, { chave: string; cert: CertificadoCarregado }>();

export async function carregarCertificado(e: any): Promise<CertificadoCarregado> {
  if (!e.arquivo_pfx) throw new Error('A empresa não tem certificado digital: envie o .pfx em Empresas › Upload .PFX.');
  const chave = `${e.arquivo_pfx}|${e.senha_pfx ?? ''}`;
  const emCache = cacheCertificado.get(e.id);
  if (emCache?.chave === chave) return emCache.cert;
  let pfx: Buffer;
  try {
    pfx = await ler(String(e.arquivo_pfx));
  } catch (err: any) {
    throw new Error(`Não foi possível ler o certificado da empresa (${e.arquivo_pfx}): ${err.message}`);
  }
  const cert = await carregarPfx(pfx, String(e.senha_pfx ?? ''));
  cacheCertificado.set(e.id, { chave, cert });
  return cert;
}

export async function montarContexto(empresaId: number, grupoId: number, vendaId?: number | null): Promise<Contexto> {
  const e = await carregarEmpresa(empresaId, grupoId);
  const { config, emitente } = configDaEmpresa(e);
  const certificado = await carregarCertificado(e);
  if (certificado.info.diasParaVencer < 0) {
    throw new Error(`O certificado digital venceu em ${certificado.info.validoAte.toLocaleDateString('pt-BR')}.`);
  }
  return { empresaId, grupoId, vendaId, config, emitente, certificado, modelo: 'NFe' };
}

export interface RegistroLog {
  operacao: string;
  url?: string;
  chave?: string;
  sucesso: boolean;
  codigoStatus?: number;
  motivo?: string;
  duracaoMs?: number;
  envio?: string;
  retorno?: string;
}

/** LogaNFe do Delphi: uma linha em nfe_log (varchar 255) */
export async function logNFe(grupoId: number, empresaId: number, vendaId: number | null | undefined, texto: string) {
  try {
    await pool.query('INSERT INTO nfe_log (id_grupo, id_empresa, id_venda, data_hora, log) VALUES (?, ?, ?, NOW(), ?)', [
      grupoId,
      empresaId,
      vendaId ?? null,
      String(texto).slice(0, 255),
    ]);
  } catch (err) {
    // O log nunca pode derrubar a operação que ele está registrando
    console.warn('Falha ao gravar o nfe_log:', err);
  }
}

export async function registrarLog(ctx: Contexto, reg: RegistroLog) {
  await logNFe(
    ctx.grupoId,
    ctx.empresaId,
    ctx.vendaId,
    `${reg.operacao}: ${reg.codigoStatus ?? ''} ${reg.motivo ?? ''}${reg.chave ? ` (${reg.chave})` : ''}`.trim(),
  );
}
