import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Inbox, Loader2 } from 'lucide-react';
import type { OpcaoRef, RegistroCrud, ResourceDef } from '../../types';
import { RecordForm } from '../../components/RecordForm';

// ---------------------------------------------------------------------------------------------
// Formatação (padrão das grades do Delphi)
// ---------------------------------------------------------------------------------------------

export const moeda = (v: unknown, casas = 2) =>
  v === null || v === undefined || v === '' ? '' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
export const inteiro = (v: unknown) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('pt-BR'));
export const dataBr = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
export const dataHoraBr = (v: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dataBr(v);
};
export const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/** Selo colorido (BadGet do Delphi): fundo da cor, texto branco (escuro nas cores claras) */
export const Selo: React.FC<{ texto: string; cor?: string; onClick?: () => void; title?: string }> = ({ texto, cor, onClick, title }) => {
  const fundo = cor ?? (texto === 'SIM' ? '#2E8B57' : '#E5E5E5');
  const claro = ['#E5E5E5', '#FFD700', '#FFDAB9', '#FFA07A'].includes(fundo.toUpperCase());
  return (
    <span
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      title={title}
      style={{ background: fundo, color: claro ? '#44403c' : '#fff' }}
      className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[11px] font-semibold leading-tight whitespace-nowrap ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      {texto}
    </span>
  );
};

// ---------------------------------------------------------------------------------------------
// Grade simples (as grades do Delphi): seleção de linha, duplo clique, colunas configuradas
// ---------------------------------------------------------------------------------------------

export interface Coluna<T> {
  titulo: React.ReactNode;
  /** Campo exibido como texto (sem render) */
  campo?: keyof T & string;
  render?: (row: T) => React.ReactNode;
  alinhar?: 'e' | 'c' | 'd';
  largura?: number;
  /** Estilo próprio da célula (ex.: cor condicional) */
  estilo?: (row: T) => React.CSSProperties | undefined;
  negrito?: boolean;
  /** Linha de totais */
  total?: (rows: T[]) => React.ReactNode;
}

const ALINHAR = { e: 'text-left', c: 'text-center', d: 'text-right' };

export function Grade<T extends Record<string, any>>({
  colunas,
  linhas,
  chave = 'id',
  selecionada,
  onSelecionar,
  onDuploClique,
  carregando,
  vazio = 'Nenhum registro.',
  compacta,
  rolarParaSelecionada,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave?: string;
  selecionada?: unknown;
  onSelecionar?: (row: T) => void;
  onDuploClique?: (row: T) => void;
  carregando?: boolean;
  vazio?: string;
  compacta?: boolean;
  rolarParaSelecionada?: boolean;
}) {
  const sel = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (rolarParaSelecionada) sel.current?.scrollIntoView({ block: 'nearest' });
  }, [selecionada, rolarParaSelecionada, linhas]);
  const temTotal = colunas.some((c) => c.total);
  const py = compacta ? 'py-1' : 'py-1.5';
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr className="bg-stone-50 dark:bg-stone-950">
            {colunas.map((c, i) => (
              <th
                key={i}
                style={c.largura ? { minWidth: c.largura } : undefined}
                className={`px-2 ${py} ${ALINHAR[c.alinhar ?? 'e']} font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((row) => {
            const ativa = selecionada !== undefined && String(row[chave]) === String(selecionada);
            return (
              <tr
                key={String(row[chave])}
                ref={ativa ? sel : undefined}
                onClick={() => onSelecionar?.(row)}
                onDoubleClick={() => onDuploClique?.(row)}
                className={`${onSelecionar ? 'cursor-pointer' : ''} ${ativa ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-stone-50 dark:hover:bg-stone-800/40'}`}
              >
                {colunas.map((c, i) => (
                  <td
                    key={i}
                    style={c.estilo?.(row)}
                    title={c.campo ? String(row[c.campo] ?? '') : undefined}
                    className={`px-2 ${py} ${ALINHAR[c.alinhar ?? 'e']} ${c.negrito ? 'font-bold' : ''} text-stone-700 dark:text-stone-300 whitespace-nowrap max-w-[420px] truncate border-b border-stone-100 dark:border-stone-800/60`}
                  >
                    {c.render ? c.render(row) : String(row[c.campo!] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {temTotal && linhas.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr className="bg-stone-100 dark:bg-stone-900 font-semibold">
              {colunas.map((c, i) => (
                <td key={i} className={`px-2 ${py} ${ALINHAR[c.alinhar ?? 'e']} border-t border-stone-300 dark:border-stone-700 whitespace-nowrap`}>
                  {c.total?.(linhas)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-8 text-stone-500 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
        </div>
      ) : (
        !linhas.length && (
          <div className="flex flex-col items-center gap-2 py-8 text-stone-400">
            <Inbox className="w-5 h-5" />
            <span className="text-xs">{vazio}</span>
          </div>
        )
      )}
    </div>
  );
}

/** Botão das barras de ferramentas (38px, ícone + texto) */
export const BotaoBarra: React.FC<{ icone: React.ElementType; texto: string; onClick: () => void; disabled?: boolean; title?: string; primario?: boolean; carregando?: boolean }> = ({
  icone: Icone,
  texto,
  onClick,
  disabled,
  title,
  primario,
  carregando,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || carregando}
    title={title}
    className={`inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      primario
        ? 'text-white bg-blue-600 hover:bg-blue-700'
        : 'text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800'
    }`}
  >
    {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icone className="w-4 h-4" />}
    {texto}
  </button>
);

/** Formulário genérico (RecordForm) numa janela modal */
export const JanelaForm: React.FC<{
  titulo: string;
  resource: ResourceDef;
  record: RegistroCrud | null;
  refOptions: Record<string, OpcaoRef[]>;
  onCancel: () => void;
  onSave: (payload: RegistroCrud) => Promise<void>;
}> = ({ titulo, ...form }) =>
  createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-2xl bg-white dark:bg-stone-900">
        <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 text-sm font-bold text-stone-900 dark:text-stone-100 shrink-0">{titulo}</div>
        <RecordForm {...form} />
      </div>
    </div>,
    document.body,
  );
