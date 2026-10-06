/**
 * Contrato do cliente (aba Contrato do ufrmClientes): troca das variáveis do contrato padrão da empresa
 * e página A4 usada na impressão e no PDF. Funções puras: usadas no navegador e no servidor.
 */

/** FormataCNPJ do Delphi: 11 dígitos = CPF, mais que 11 = CNPJ, menos que 11 = vazio */
export function formataCnpj(valor: unknown): string {
  const d = String(valor ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length > 11) return d.padStart(14, '0').replace(/^(\d+)(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return '';
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10-05" → "05 de outubro de 2026" (FormatDateTime('dd "de" mmmm "de" yyyy') do Delphi) */
export function dataPorExtenso(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d} de ${MESES[Number(m) - 1]} de ${a}`;
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ClienteContrato {
  nome?: string | null;
  fantasia?: string | null;
  cpf_cnpj?: string | null;
  endereco?: string | null;
  endereco_nr?: string | null;
  endereco_complemento?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_uf?: string | null;
  endereco_cep?: string | null;
  representante_legal_nome?: string | null;
  representante_legal_cpf?: string | null;
}

export interface EquipamentoContrato {
  marca_descricao?: string | null;
  modelo?: string | null;
  nr_serie?: string | null;
}

/**
 * "Copiar Padrão": troca as variáveis do contrato padrão pelos dados do cliente (troca literal, todas as ocorrências).
 * `equipamentos` já vem só com os contratos ativos, na ordem do número de série (o Delphi listava também os inativos).
 */
export function preencherContrato(modelo: string, c: ClienteContrato, equipamentos: EquipamentoContrato[], hojeIso: string): string {
  const linhas = equipamentos
    .map(
      (e, i) =>
        `${String.fromCharCode(97 + (i % 26))}) 01 IMPRESSORA MARCA: <b>${esc(e.marca_descricao)}</b> - Modelo: <b>${esc(e.modelo)}</b> - Numero Serie: <b>${esc(e.nr_serie)}</b><br>`,
    )
    .join('\n');
  const rua = `${c.endereco ?? ''} ${c.endereco_nr ?? ''}`;
  const vars: Record<string, string> = {
    '@cliente@': esc(c.nome),
    '@fantasia@': esc(c.fantasia),
    '@cnpj@': formataCnpj(c.cpf_cnpj),
    '@rua@': esc(rua),
    '@endereco@': esc([rua.trim(), c.endereco_complemento, c.endereco_bairro].filter((x) => String(x ?? '').trim()).join(', ')),
    '@bairro@': esc(c.endereco_bairro),
    '@cidade@': esc(c.endereco_cidade),
    '@uf@': esc(c.endereco_uf),
    '@cep@': esc(c.endereco_cep),
    '@representante@': esc(c.representante_legal_nome),
    '@cpf@': esc(c.representante_legal_cpf),
    '@data@': dataPorExtenso(hojeIso),
    '@equipamentos@': linhas,
  };
  let html = modelo;
  for (const [k, v] of Object.entries(vars)) html = html.split(k).join(v);
  return html;
}

/** Variáveis do contrato padrão (menu "Inserir variável" do editor) */
export const VARIAVEIS_CONTRATO_CLIENTE = [
  { texto: '@cliente@', descricao: 'Nome do cliente' },
  { texto: '@fantasia@', descricao: 'Nome fantasia' },
  { texto: '@cnpj@', descricao: 'CPF/CNPJ do cliente' },
  { texto: '@rua@', descricao: 'Rua e número' },
  { texto: '@endereco@', descricao: 'Rua, número, complemento e bairro' },
  { texto: '@bairro@', descricao: 'Bairro' },
  { texto: '@cidade@', descricao: 'Cidade' },
  { texto: '@uf@', descricao: 'UF' },
  { texto: '@cep@', descricao: 'CEP' },
  { texto: '@representante@', descricao: 'Representante legal' },
  { texto: '@cpf@', descricao: 'CPF do representante legal' },
  { texto: '@equipamentos@', descricao: 'Equipamentos locados (contratos ativos)' },
  { texto: '@data@', descricao: 'Data de hoje por extenso' },
];

/** Página A4 do contrato (impressão no navegador e PDF), com os mesmos estilos do editor */
export function paginaContrato(corpo: string, titulo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
@page { size: A4; margin: 2cm; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 10px; } h2 { font-size: 13pt; margin: 14px 0 6px; } h3 { font-size: 11.5pt; margin: 10px 0 4px; }
p { margin: 0 0 8px; } ul, ol { padding-left: 24px; margin: 0 0 8px; } table { border-collapse: collapse; }
</style></head><body>${corpo}</body></html>`;
}
