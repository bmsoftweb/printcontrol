/**
 * Regras puras de OS, Requisições e Consultas (sem banco e sem React): usadas pelo servidor (server/os.ts),
 * pelas telas e pelo teste (tests/os.test.ts).
 */

// ============================================================
// OS e peças
// ============================================================

/** Ícone da coluna de tipo da OS (render do os_tipo no Delphi) */
export function iconeTipoOs(osTipo: string | null | undefined, obs: string | null | undefined): 'cartucho' | 'cilindro' | 'requisicao' | 'recarga' | 'servico' {
  const o = String(obs ?? '').toLowerCase();
  if (osTipo === 'R') return o.includes('cartucho') ? 'cartucho' : o.includes('cilindro') ? 'cilindro' : 'requisicao';
  return osTipo === 'G' ? 'recarga' : 'servico';
}

/**
 * BeforePost da peça (ufrmOS): devolve o valor_total ou lança a mensagem do Delphi.
 * `nivel` = letra do usuário; nível >= 'T' (técnico) tem que entregar a quantidade toda.
 */
export function validarPeca(p: { qtdade: number; qtdade_entregue: number; valor_unit: number }, qtdadeOs: number, nivel: string): number {
  const qtd = Number(p.qtdade) || 0;
  const entregue = Number(p.qtdade_entregue) || 0;
  if (qtd <= 0) throw new Error('Digite uma quantidade');
  if (qtdadeOs > 0 && qtd > qtdadeOs) throw new Error('Quantidade deve ser igual a solicitada!');
  if (entregue > qtd) throw new Error('Quantidade entregue inválida!');
  if (String(nivel || 'Z').toUpperCase() >= 'T' && entregue !== qtd) throw new Error('Quantidade entregue deve ser igual a solicitada!');
  return Math.round(entregue * (Number(p.valor_unit) || 0) * 100) / 100;
}

/** StrTranEx do Delphi: troca todas as ocorrências, sem diferenciar maiúsculas (as variáveis maiores primeiro) */
export function aplicarVariaveis(modelo: string, vars: Record<string, string | number | null | undefined>): string {
  let texto = String(modelo ?? '').trim();
  for (const nome of Object.keys(vars).sort((a, b) => b.length - a.length)) {
    texto = texto.replace(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => String(vars[nome] ?? ''));
  }
  return texto;
}

// ============================================================
// Consultas configuráveis
// ============================================================

export type TipoParametro = 'D' | 'I' | 'N' | 'T' | 'L' | 'P';

export interface ParametroConsulta {
  /** par<N> */
  n: number;
  rotulo: string;
  nome: string;
  tipo: TipoParametro;
  padrao: string;
  /** L: itens separados por vírgula; P: SQL do combo (1ª coluna = chave, 2ª = exibição) */
  extra: string;
}

/** Linhas "chave=valor" (TStringList.Values do Delphi: vale a primeira ocorrência da chave) */
function valores(texto: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i <= 0) continue;
    const chave = linha.slice(0, i).trim().toLowerCase();
    if (!m.has(chave)) m.set(chave, linha.slice(i + 1));
  }
  return m;
}

/** `parN=Rótulo;nome;Tipo;Padrão;Extra`, N de 1 a 99 */
export function parseParametros(texto: string | null | undefined): ParametroConsulta[] {
  const m = valores(texto);
  const lista: ParametroConsulta[] = [];
  for (let n = 1; n <= 99; n++) {
    const v = m.get(`par${n}`);
    if (v === undefined) continue;
    const [rotulo = '', nome = '', tipo = '', padrao = '', ...resto] = v.split(';');
    if (!nome.trim()) continue;
    lista.push({ n, rotulo: rotulo.trim(), nome: nome.trim(), tipo: (tipo.trim().toUpperCase() || 'T') as TipoParametro, padrao: padrao.trim(), extra: resto.join(';').trim() });
  }
  return lista;
}

/** Itens do parâmetro L: "A-Aberto,R-Recebido" */
export const itensLista = (p: ParametroConsulta) => p.extra.split(',').map((s) => s.trim()).filter(Boolean);

/** dd/mm/aaaa ou aaaa-mm-dd → aaaa-mm-dd ('' se inválida) */
export function dataIso(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** Valor inicial do controle do parâmetro (tela Parâmetros) */
export function valorInicial(p: ParametroConsulta): string {
  switch (p.tipo) {
    case 'D':
      return dataIso(p.padrao);
    case 'I':
    case 'N':
      return String(Number(`0${p.padrao.replace(',', '.')}`) || 0);
    case 'L':
      return itensLista(p)[0] ?? '';
    default:
      return p.padrao;
  }
}

/** Valor que vai para o SQL (como parâmetro ?, nunca como texto do comando) */
export function valorParametro(p: ParametroConsulta, bruto: unknown): string | number {
  const s = bruto === undefined || bruto === null ? '' : String(bruto);
  switch (p.tipo) {
    case 'D':
      return dataIso(s) || dataIso(p.padrao);
    case 'I':
      return Math.trunc(Number(s.replace(',', '.')) || 0);
    case 'N':
      return Number(s.replace(',', '.')) || 0;
    case 'L':
      return s.includes('-') ? s.charAt(0) : s;
    case 'P':
      return s === '' ? p.padrao : s;
    default:
      return s;
  }
}

/** Título da aba: comentário `/* t: Título *\/` no SQL, senão "Consulta (N)" */
export function tituloAba(sql: string | null | undefined, n: number): string {
  const m = /\/\*\s*t:([\s\S]*?)\*\//i.exec(String(sql ?? ''));
  return m && m[1].trim() ? m[1].trim() : `Consulta (${n})`;
}

/** FormataTitle: "_" vira espaço e cada palavra começa com maiúscula */
export const formataTitle = (campo: string) =>
  campo
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());

export interface TituloColuna {
  titulo?: string;
  largura?: number;
  formato?: string;
}

/** sqlN_titulos: `campo=Título;largura;formato`, uma linha por campo */
export function parseTitulos(texto: string | null | undefined): Record<string, TituloColuna> {
  const r: Record<string, TituloColuna> = {};
  for (const [campo, v] of valores(texto)) {
    const [titulo, largura, formato] = v.split(';');
    r[campo] = { titulo: titulo?.trim() || undefined, largura: Number(largura) || undefined, formato: formato?.trim() || undefined };
  }
  return r;
}

export type TipoColuna = 'int' | 'dec' | 'date' | 'datetime' | 'str';

export interface ColunaConsulta {
  campo: string;
  titulo: string;
  largura: number;
  tipo: TipoColuna;
  /** Formato numérico do Delphi (",0.00", "0.000"...) */
  formato?: string;
}

/** Título, largura e formato de cada coluna do resultado (3.5 da spec; cada coluna começa do zero, sem herdar da anterior) */
export function formatarColuna(campo: string, tipo: TipoColuna, tamanho: number, titulos: Record<string, TituloColuna>): ColunaConsulta {
  const t = titulos[campo.toLowerCase()] ?? {};
  const titulo = t.titulo || formataTitle(campo);
  let largura = tipo === 'int' ? 80 : tipo === 'dec' ? 120 : tipo === 'date' || tipo === 'datetime' ? 150 : tamanho < 4 ? 50 : tamanho * 7;
  largura = Math.min(400, Math.max(largura, titulo.length * 11));
  const formato = tipo === 'dec' ? t.formato || ',0.00' : tipo === 'int' ? t.formato : undefined;
  return { campo, titulo, largura, tipo, formato };
}

/** Número no formato do Delphi (",0.00": milhar e 2 casas; "0.###": até 3 casas; "000": 3 dígitos) em pt-BR */
export function formatarNumero(v: unknown, formato = ',0.00'): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const [int = '', dec = ''] = formato.replace(/[^0#.,]/g, '').split('.');
  const minDec = (dec.match(/0/g) || []).length;
  const maxDec = minDec + (dec.match(/#/g) || []).length;
  const s = n.toLocaleString('pt-BR', { minimumFractionDigits: minDec, maximumFractionDigits: maxDec, useGrouping: int.includes(',') });
  const minInt = (int.match(/0/g) || []).length;
  if (minInt <= 1) return s;
  const [i, d] = s.replace('-', '').split(',');
  return `${n < 0 ? '-' : ''}${i.padStart(minInt, '0')}${d !== undefined ? `,${d}` : ''}`;
}

// ------------------------------------------------------------
// SQL das consultas: divisão em comandos, conferência de "só leitura" e parâmetros por bind
// ------------------------------------------------------------

/** Pedaços do SQL: código, texto entre aspas (com as aspas) e comentários */
type Pedaco = { tipo: 'codigo' | 'texto' | 'comentario' | 'ident'; s: string };

function pedacos(sql: string): Pedaco[] {
  const r: Pedaco[] = [];
  let i = 0;
  let codigo = '';
  const fecharCodigo = () => {
    if (codigo) r.push({ tipo: 'codigo', s: codigo });
    codigo = '';
  };
  while (i < sql.length) {
    const c = sql[i];
    const c2 = sql.slice(i, i + 2);
    if (c === "'" || c === '"' || c === '`') {
      fecharCodigo();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && c !== '`') j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      r.push({ tipo: c === '`' ? 'ident' : 'texto', s: sql.slice(i, j + 1) });
      i = j + 1;
    } else if (c2 === '/*') {
      fecharCodigo();
      const j = sql.indexOf('*/', i + 2);
      const fim = j < 0 ? sql.length : j + 2;
      r.push({ tipo: 'comentario', s: sql.slice(i, fim) });
      i = fim;
    } else if (c === '#' || (c2 === '--' && /\s/.test(sql[i + 2] ?? ' '))) {
      fecharCodigo();
      const j = sql.indexOf('\n', i);
      const fim = j < 0 ? sql.length : j;
      r.push({ tipo: 'comentario', s: sql.slice(i, fim) });
      i = fim;
    } else {
      codigo += c;
      i++;
    }
  }
  fecharCodigo();
  return r;
}

/** Comandos separados por ";" fora de textos e comentários (vazios descartados) */
export function dividirComandos(sql: string): string[] {
  const cmds: string[] = [];
  let atual = '';
  for (const p of pedacos(String(sql ?? ''))) {
    if (p.tipo !== 'codigo') {
      atual += p.s;
      continue;
    }
    const partes = p.s.split(';');
    atual += partes[0];
    for (const parte of partes.slice(1)) {
      cmds.push(atual);
      atual = parte;
    }
  }
  cmds.push(atual);
  return cmds.filter((c) => pedacos(c).some((p) => p.tipo !== 'comentario' && p.s.trim()));
}

const PROIBIDO =
  /\b(insert|replace\s+into|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler|load|lock|unlock|set|do|prepare|execute|deallocate|flush|kill|shutdown|install|uninstall|outfile|dumpfile|sleep|benchmark|get_lock)\b/i;

/**
 * O comando é só de leitura? Começa com SELECT/WITH e não tem palavras de escrita fora de textos e comentários.
 * O servidor ainda roda tudo numa transação READ ONLY: esta conferência é a primeira barreira, não a única.
 * Funções de texto com nome de comando (REPLACE(), INSERT()) são aceitas quando seguidas de "(".
 */
export function motivoRecusa(cmd: string): string | null {
  // /*! ... */ é executado pelo MySQL: não pode passar como comentário
  if (cmd.includes('/*!')) return 'Comentários executáveis (/*! */) não são permitidos.';
  const codigo = pedacos(cmd)
    .map((p) => (p.tipo === 'codigo' ? p.s : p.tipo === 'comentario' ? ' ' : ' x '))
    .join('')
    .replace(/\b(replace|insert)\s*\(/gi, 'fn(');
  const inicio = codigo.trim().replace(/^\(+\s*/, '');
  if (!/^(select|with)\b/i.test(inicio)) return 'Só são aceitas consultas (SELECT ou WITH).';
  const m = PROIBIDO.exec(codigo);
  if (m) return `Comando não permitido na consulta: ${m[1].toUpperCase()}.`;
  if (/\bfor\s+update\b|\bin\s+share\s+mode\b|\binto\s+@/i.test(codigo)) return 'A consulta não pode bloquear registros nem gravar variáveis.';
  return null;
}

/**
 * Troca os parâmetros `:nome` por `?` e devolve os valores na ordem (bind do mysql2, sem montar texto).
 * Só troca nomes conhecidos e inteiros (`:d1` não mexe em `:d10`). Dentro de texto entre aspas,
 * `':d1'` vira `?` e `'%:nome%'` vira CONCAT('%', ?, '%'). Comentários ficam como estão.
 */
export function prepararSql(sql: string, valoresPorNome: Record<string, unknown>): { sql: string; params: unknown[] } {
  const nomes = new Map(Object.entries(valoresPorNome).map(([k, v]) => [k.toLowerCase(), v]));
  const params: unknown[] = [];
  const re = /:([A-Za-z_]\w*)/g;
  const saida = pedacos(sql).map((p) => {
    if (p.tipo === 'codigo') {
      return p.s.replace(re, (todo, nome: string, pos: number) => {
        // @a:=1 (atribuição) e nomes desconhecidos ficam como estão
        if (!nomes.has(nome.toLowerCase()) || p.s[pos - 1] === ':') return todo;
        params.push(nomes.get(nome.toLowerCase()));
        return '?';
      });
    }
    if (p.tipo !== 'texto') return p.s;
    const aspas = p.s[0];
    const miolo = p.s.slice(1, -1);
    const partes: string[] = [];
    const valoresTexto: unknown[] = [];
    let ultimo = 0;
    for (const m of miolo.matchAll(re)) {
      if (!nomes.has(m[1].toLowerCase())) continue;
      partes.push(miolo.slice(ultimo, m.index));
      valoresTexto.push(nomes.get(m[1].toLowerCase()));
      ultimo = m.index! + m[0].length;
    }
    if (!valoresTexto.length) return p.s;
    partes.push(miolo.slice(ultimo));
    params.push(...valoresTexto);
    if (partes.length === 2 && !partes[0] && !partes[1]) return '?';
    const termos: string[] = [];
    partes.forEach((t, i) => {
      if (t) termos.push(`${aspas}${t}${aspas}`);
      if (i < valoresTexto.length) termos.push('?');
    });
    return `CONCAT(${termos.join(', ')})`;
  });
  return { sql: saida.join(''), params };
}

// ------------------------------------------------------------
// Cubo (pivot) sobre o resultado do SQL 1
// ------------------------------------------------------------

export interface Pivot {
  /** Combinações das colunas (uma por grupo de colunas do resultado) */
  colunas: string[][];
  linhas: { chaves: string[]; valores: number[][] }[];
  /** Totais por combinação de coluna e métrica, mais o total geral no fim */
  totais: number[][];
}

const SEP = '\u0001';

/**
 * Soma das métricas por linhas × colunas (layout compacto do cubo do Delphi). `valores[i][k]` = coluna i, métrica k;
 * a última coluna é o total da linha.
 */
export function montarPivot(rows: Record<string, unknown>[], linhas: string[], colunas: string[], metricas: string[]): Pivot {
  const chave = (r: Record<string, unknown>, campos: string[]) => campos.map((c) => String(r[c] ?? '')).join(SEP);
  const colKeys = [...new Set(rows.map((r) => chave(r, colunas)))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  const idx = new Map(colKeys.map((k, i) => [k, i]));
  const mapa = new Map<string, number[][]>();
  const nova = () => Array.from({ length: colKeys.length + 1 }, () => metricas.map(() => 0));
  const totais = nova();
  for (const r of rows) {
    const lk = chave(r, linhas);
    if (!mapa.has(lk)) mapa.set(lk, nova());
    const v = mapa.get(lk)!;
    const ci = idx.get(chave(r, colunas))!;
    metricas.forEach((m, k) => {
      const n = Number(r[m]) || 0;
      v[ci][k] += n;
      v[colKeys.length][k] += n;
      totais[ci][k] += n;
      totais[colKeys.length][k] += n;
    });
  }
  const ordenadas = [...mapa.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  return {
    colunas: colKeys.map((k) => (colunas.length ? k.split(SEP) : [])),
    linhas: ordenadas.map((k) => ({ chaves: linhas.length ? k.split(SEP) : [], valores: mapa.get(k)! })),
    totais,
  };
}

/** Lista de campos guardada em pivot_linhas/colunas/metrica (um por linha) */
export const camposPivot = (texto: string | null | undefined) =>
  String(texto ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
