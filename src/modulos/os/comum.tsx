import React from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { lerSessao } from '../../utils/session';
import { formatarNumero } from './regras';
import { INPUT_CLASS } from '../../utils/formStyles';

/** Classe dos campos (DateField, NumberField, SelectBusca), como no RecordForm */
export const CAMPO = `${INPUT_CLASS} w-full`;

/** BadGet do Delphi: selo com fundo na cor indicada e texto branco */
export const Badge: React.FC<{ texto: React.ReactNode; cor?: string; escuro?: boolean }> = ({ texto, cor, escuro }) =>
  texto === '' || texto === null || texto === undefined ? null : (
    <span
      className="inline-block rounded-[3px] text-[11px] font-semibold px-1.5 py-0.5 whitespace-nowrap leading-tight"
      style={{ background: cor ?? (texto === 'SIM' ? '#2E8B57' : '#9CA3AF'), color: escuro ? '#111' : '#fff' }}
    >
      {texto}
    </span>
  );

export const dataBR = (v: unknown) => {
  const s = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : s;
};
export const dataHoraBR = (v: unknown) => {
  const s = String(v ?? '');
  return s.length >= 16 ? `${dataBR(s)} ${s.slice(11, 16)}` : dataBR(s);
};
export const valorBR = (v: unknown, formato = ',0.00') => formatarNumero(v, formato);

export interface ColunaGrade<T> {
  chave: string;
  titulo: React.ReactNode;
  largura?: number;
  alinhar?: 'esq' | 'centro' | 'dir';
  render?: (row: T) => React.ReactNode;
  /** Dica (title) do cabeçalho */
  dica?: string;
  /** Coluna presa à direita (Ações) */
  fixa?: boolean;
}

/**
 * Grade somente leitura das telas de OS/Requisições/Consultas (a edição é por formulário em janela):
 * cabeçalho fixo, rolagem nas duas direções, linha selecionada e duplo clique.
 */
export function Grade<T extends Record<string, any>>({
  colunas,
  linhas,
  chave = 'id',
  selecionado,
  onSelecionar,
  onDuploClique,
  carregando,
  vazio = 'Nenhum registro.',
  rodape,
}: {
  colunas: ColunaGrade<T>[];
  linhas: T[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (row: T) => void;
  onDuploClique?: (row: T) => void;
  carregando?: boolean;
  vazio?: string;
  rodape?: React.ReactNode;
}) {
  const alinhar = (a?: string) => (a === 'centro' ? 'text-center' : a === 'dir' ? 'text-right' : 'text-left');
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="text-xs border-separate border-spacing-0 min-w-full">
        <thead className="sticky top-0 z-10">
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                title={c.dica}
                style={c.largura ? { minWidth: c.largura, width: c.largura } : undefined}
                className={`${c.fixa ? 'sticky right-0 border-l ' : ''}px-2.5 py-2 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={carregando && linhas.length ? 'opacity-60' : undefined}>
          {!linhas.length && (
            <tr>
              <td colSpan={colunas.length} className="px-3 py-10 text-center text-stone-500 dark:text-stone-400">
                <span className="inline-flex items-center gap-2">
                  {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
                  {carregando ? 'Carregando…' : vazio}
                </span>
              </td>
            </tr>
          )}
          {linhas.map((row) => {
            const ativo = selecionado !== undefined && String(row[chave]) === String(selecionado);
            return (
              <tr
                key={String(row[chave])}
                onClick={() => onSelecionar?.(row)}
                onDoubleClick={() => onDuploClique?.(row)}
                className={`cursor-default ${ativo ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'}`}
              >
                {colunas.map((c) => {
                  const v = c.render ? c.render(row) : row[c.chave];
                  return (
                    <td
                      key={c.chave}
                      title={typeof v === 'string' && v.length > 30 ? v : undefined}
                      style={c.largura ? { maxWidth: Math.max(c.largura, 60) } : undefined}
                      className={`${c.fixa ? 'sticky right-0 border-l bg-white dark:bg-stone-900 ' : ''}px-2.5 py-1.5 border-b border-stone-100 dark:border-stone-800/70 truncate text-stone-800 dark:text-stone-200 ${alinhar(c.alinhar)}`}
                    >
                      {v as React.ReactNode}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {rodape && <tfoot className="sticky bottom-0 bg-stone-50 dark:bg-stone-950">{rodape}</tfoot>}
      </table>
    </div>
  );
}

/** Barra de ferramentas das telas próprias */
export const Barra: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 ${className}`}>{children}</div>
);

/** PDF de rota autenticada aberto numa nova aba (como o window.open do Delphi) */
export async function abrirPdf(url: string, corpo?: unknown) {
  // A aba é aberta já no clique: depois do await o navegador bloquearia como pop-up
  const aba = window.open('', '_blank');
  try {
    const res = await fetch(url, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${lerSessao()?.token ?? ''}`, ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Falha ao gerar o PDF (HTTP ${res.status}).`);
    const link = URL.createObjectURL(await res.blob());
    if (aba) aba.location.href = link;
    else {
      // Pop-up bloqueado: baixa o arquivo em vez de sair do sistema
      const a = document.createElement('a');
      a.href = link;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'documento.pdf';
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(link), 60_000);
  } catch (e) {
    aba?.close();
    throw e;
  }
}

/** Seletor de status (filtro do Delphi: combo na coluna Status) */
export const FiltroStatus: React.FC<{ valor: string; opcoes: [string, string][]; onChange: (v: string) => void }> = ({ valor, opcoes, onChange }) => (
  <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
    Status
    <select value={valor} onChange={(e) => onChange(e.target.value)} className="bg-stone-50 dark:bg-stone-800/80 h-[38px] px-3 text-xs font-medium text-stone-800 dark:text-stone-100 cursor-pointer">
      {opcoes.map(([v, l]) => (
        <option key={v} value={v}>
          {v}-{l}
        </option>
      ))}
    </select>
  </label>
);
