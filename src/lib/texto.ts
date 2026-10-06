/**
 * Normalização de texto para comparações (nomes do .dae, palavras-chave, padrões de mapeamento):
 * minúsculas, sem acento, "_" e "-" viram espaço, espaços colapsados.
 */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ModoComparacao = 'EXATO' | 'CONTEM' | 'INICIA' | 'REGEX';

/**
 * O texto casa com o padrão do mapeamento? Os dois são normalizados antes (no REGEX, só o texto:
 * a expressão vale como foi escrita, sem diferenciar maiúsculas). Regex inválida não casa.
 */
export function casaPadrao(padrao: string, modo: ModoComparacao, texto: string | null | undefined): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  if (modo === 'REGEX') {
    try {
      return new RegExp(padrao, 'i').test(t);
    } catch {
      return false;
    }
  }
  const p = normalizar(padrao);
  if (!p) return false;
  if (modo === 'EXATO') return t === p;
  if (modo === 'INICIA') return t.startsWith(p);
  return t.includes(p);
}

/** Lista CSV de palavras-chave normalizada: "Lateral, LAT ,ld" → "lateral,lat,ld" (sem vazias e sem repetidas) */
export function normalizarPalavrasChave(csv: string | null | undefined): string {
  return [...new Set(String(csv ?? '').split(',').map(normalizar).filter(Boolean))].join(',');
}

/**
 * Junção de objetos na revisão: os somados ficam "Ignorar" com o motivo `Somado em "nome" (nº id)`
 * (as primeiras junções só tinham o nome). Diz se o objeto `o` foi somado na peça `p`.
 */
export function somadoEm(o: { id: number; classificacao: string; motivo_classificacao: string | null }, p: { id: number; nome: string | null }): boolean {
  if (o.id === p.id || o.classificacao !== 'IGNORAR') return false;
  const m = o.motivo_classificacao?.match(/^Somado em "(.*)"(?: \(nº (\d+)\))?$/);
  return !!m && (m[2] ? Number(m[2]) === Number(p.id) : m[1] === p.nome);
}

export const motivoSomado = (nome: string, principal: number) => `Somado em "${nome.slice(0, 200)}" (nº ${principal})`;
