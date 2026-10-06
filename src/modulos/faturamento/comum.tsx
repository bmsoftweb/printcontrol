import React from 'react';
import { Loader2 } from 'lucide-react';
import { lerSessao } from '../../utils/session';
import { formatDateBR, formatDateTimeBR } from '../../utils/formatters';

/** Linha genérica vinda das rotas do módulo */
export type Reg = Record<string, any>;

export const moeda = (v: unknown) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inteiro = (v: unknown) => (v === null || v === undefined || v === '' ? '' : (Number(v) || 0).toLocaleString('pt-BR'));
export const data = (v: unknown) => (v ? formatDateBR(String(v)) : '');
export const dataHora = (v: unknown) => (v ? formatDateTimeBR(String(v)) : '');

/** Botão da barra das telas (mesma altura dos campos: 38px) */
export const BOTAO_BARRA =
  'inline-flex items-center justify-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

export const BotaoBarra: React.FC<{ icone: React.ElementType; texto: string; onClick: () => void; carregando?: boolean; disabled?: boolean; titulo?: string; ativo?: boolean }> = ({
  icone: Icone,
  texto,
  onClick,
  carregando,
  disabled,
  titulo,
  ativo,
}) => (
  <button type="button" className={`${BOTAO_BARRA} ${ativo ? '!bg-blue-50 !border-blue-400 !text-blue-700 dark:!bg-blue-950/50 dark:!text-blue-300' : ''}`} onClick={onClick} disabled={disabled || carregando} title={titulo}>
    {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
    {texto}
  </button>
);

/** Selo colorido (status, e-mail enviado, remessa) */
export const Selo: React.FC<{ cor: string; texto: string; escuro?: boolean }> = ({ cor, texto, escuro }) => (
  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wide whitespace-nowrap" style={{ background: cor, color: escuro ? '#333' : '#fff' }}>
    {texto}
  </span>
);

export const SeloStatusNota: React.FC<{ status: string; atraso?: number }> = ({ status, atraso = 0 }) =>
  status === 'R' ? (
    <Selo cor="#E5E5E5" texto="RECEBIDO" escuro />
  ) : status === 'C' ? (
    <Selo cor="#DC143C" texto="CANCELADO" />
  ) : (
    <Selo cor={atraso > 7 ? '#FF6347' : atraso > 0 ? '#FFD700' : '#2E8B57'} texto="A RECEBER" escuro={atraso > 0 && atraso <= 7} />
  );

const token = () => lerSessao()?.token ?? '';

async function falhou(r: Response): Promise<never> {
  const j = await r.json().catch(() => ({}));
  throw new Error(j?.error || `Falha na requisição (HTTP ${r.status}).`);
}

/** Abre um PDF de rota autenticada numa nova aba (a aba abre antes, para o navegador não bloquear) */
export async function abrirPdf(url: string) {
  const aba = window.open('', '_blank');
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) await falhou(r);
    const link = URL.createObjectURL(await r.blob());
    if (aba) aba.location.href = link;
    else window.location.assign(link);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** POST que devolve um arquivo para download (remessa); devolve os cabeçalhos para ler contagens */
export async function baixarPost(url: string, corpo: unknown, nomePadrao: string): Promise<Headers> {
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) await falhou(r);
  const nome = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? nomePadrao;
  const link = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = link;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(link), 10_000);
  return r.headers;
}

export interface Coluna {
  chave: string;
  titulo: React.ReactNode;
  alinhar?: 'dir' | 'centro';
  /** Classe de largura mínima (ex.: min-w-[90px]) */
  largura?: string;
  render?: (r: Reg) => React.ReactNode;
  /** Conteúdo do rodapé (soma) */
  rodape?: React.ReactNode;
  /** Título do grupo de colunas (cabeçalho agrupado) */
  grupo?: string;
  /** Clique no título (ordenação) */
  aoClicarTitulo?: () => void;
  /** Classe extra da célula conforme a linha */
  classe?: (r: Reg) => string;
}

interface GradeProps {
  colunas: Coluna[];
  linhas: Reg[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (r: Reg) => void;
  onDuploClique?: (r: Reg, coluna: string) => void;
  carregando?: boolean;
  vazio?: string;
  /** Linha riscada (cancelada) */
  riscada?: (r: Reg) => boolean;
  /** Coluna Ações fixa à direita */
  acoes?: (r: Reg) => React.ReactNode;
}

const ALINHAR = { dir: 'text-right', centro: 'text-center' } as const;

/** Grade simples das telas do módulo: cabeçalho fixo, linha selecionada, rodapé com somas */
export const Grade: React.FC<GradeProps> = ({ colunas, linhas, chave = 'id', selecionado, onSelecionar, onDuploClique, carregando, vazio = 'Nenhum registro.', riscada, acoes }) => {
  const temRodape = colunas.some((c) => c.rodape !== undefined);
  const grupos = colunas.some((c) => c.grupo)
    ? colunas.reduce<{ titulo: string; n: number }[]>((acc, c) => {
        const t = c.grupo ?? '';
        if (acc.length && acc[acc.length - 1].titulo === t) acc[acc.length - 1].n++;
        else acc.push({ titulo: t, n: 1 });
        return acc;
      }, [])
    : null;
  const th = 'px-2.5 py-2 font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 whitespace-nowrap';
  return (
    <div className="flex-1 overflow-auto min-h-0">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          {grupos && (
            <tr>
              {grupos.map((g, i) => (
                <th key={i} colSpan={g.n} className={`${th} text-center border-r`}>
                  {g.titulo}
                </th>
              ))}
              {acoes && <th className={th} />}
            </tr>
          )}
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                onClick={c.aoClicarTitulo}
                className={`${th} ${c.alinhar ? ALINHAR[c.alinhar] : 'text-left'} ${c.largura ?? ''} ${c.aoClicarTitulo ? 'cursor-pointer hover:text-blue-600' : ''}`}
              >
                {c.titulo}
              </th>
            ))}
            {acoes && <th className={`${th} sticky right-0 text-center border-l w-12`}>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {carregando ? (
            <tr>
              <td colSpan={colunas.length + (acoes ? 1 : 0)} className="py-10 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-stone-400 inline" />
              </td>
            </tr>
          ) : !linhas.length ? (
            <tr>
              <td colSpan={colunas.length + (acoes ? 1 : 0)} className="py-10 text-center text-stone-400">
                {vazio}
              </td>
            </tr>
          ) : (
            linhas.map((r) => {
              const sel = selecionado !== undefined && String(r[chave]) === String(selecionado);
              return (
                <tr
                  key={String(r[chave])}
                  onClick={() => onSelecionar?.(r)}
                  className={`${sel ? 'bg-blue-50 dark:bg-blue-950/40' : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'} ${riscada?.(r) ? 'line-through text-stone-400' : 'text-stone-800 dark:text-stone-200'} ${onSelecionar ? 'cursor-pointer' : ''}`}
                >
                  {colunas.map((c) => (
                    <td
                      key={c.chave}
                      onDoubleClick={() => onDuploClique?.(r, c.chave)}
                      className={`px-2.5 py-1.5 border-b border-stone-100 dark:border-stone-800 whitespace-nowrap ${c.alinhar ? ALINHAR[c.alinhar] : ''} ${c.classe?.(r) ?? ''}`}
                    >
                      {c.render ? c.render(r) : r[c.chave]}
                    </td>
                  ))}
                  {acoes && <td className="sticky right-0 px-2 py-1 text-center border-b border-l border-stone-100 dark:border-stone-800 bg-inherit">{acoes(r)}</td>}
                </tr>
              );
            })
          )}
        </tbody>
        {temRodape && (
          <tfoot className="sticky bottom-0">
            <tr>
              {colunas.map((c) => (
                <td key={c.chave} className={`px-2.5 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 font-bold text-blue-900 dark:text-blue-300 whitespace-nowrap ${c.alinhar ? ALINHAR[c.alinhar] : ''}`}>
                  {c.rodape}
                </td>
              ))}
              {acoes && <td className="bg-stone-50 dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

/** Título de painel (Faturamentos / Notas / Produtos da Nota) */
export const TituloPainel: React.FC<{ children: React.ReactNode; direita?: React.ReactNode }> = ({ children, direita }) => (
  <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-950/40 shrink-0">
    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{children}</span>
    {direita}
  </div>
);
