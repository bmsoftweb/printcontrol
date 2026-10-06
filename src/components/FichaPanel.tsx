import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import { CellValue } from './CellValue';

interface FichaPanelProps {
  resource: ResourceDef;
  row: RegistroCrud;
  /** Rótulo curto do registro, exibido no cabeçalho */
  label: string;
  refOptions: Record<string, OpcaoRef[]>;
  onClose: () => void;
  /** Recolhido controlado por quem usa (ex.: ao trocar a lista pelo calendário); sem ele, o painel cuida sozinho */
  recolhido?: boolean;
  onRecolhidoChange?: (v: boolean) => void;
}

/**
 * Ficha do registro selecionado embaixo da lista (resource.ficha), no mesmo lugar e visual do
 * painel mestre-detalhe: todos os campos, com os textos longos (observação, resumo) por inteiro.
 */
export const FichaPanel: React.FC<FichaPanelProps> = ({ resource, row, label, refOptions, onClose, recolhido, onRecolhidoChange }) => {
  const [recolhidoLocal, setRecolhidoLocal] = useState(false);
  const isCollapsed = recolhido ?? recolhidoLocal;
  const setIsCollapsed = (f: (c: boolean) => boolean) => (onRecolhidoChange ? onRecolhidoChange(f(isCollapsed)) : setRecolhidoLocal(f));
  const campos = resource.fields.filter((f) => f.type !== 'password' && !f.foraDaFicha);
  const curtos = campos.filter((f) => f.type !== 'textarea');
  // Texto longo vazio só ocupa espaço
  const longos = campos.filter((f) => f.type === 'textarea' && row[f.name] != null && String(row[f.name]).trim() !== '');

  return (
    <div
      className={`shrink-0 border-t-2 border-blue-500/60 dark:border-blue-600/60 bg-white dark:bg-stone-900 flex flex-col ${
        isCollapsed ? '' : 'h-[38%] min-h-[200px]'
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60 shrink-0">
        <span className="px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-400 border-b-2 border-blue-600 whitespace-nowrap">
          Detalhes
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="hidden sm:inline text-[11px] text-stone-500 dark:text-stone-400 truncate max-w-[280px]">
            {resource.labelSingular} <strong className="text-stone-700 dark:text-stone-200">{label}</strong>
          </span>
          <button
            onClick={() => setIsCollapsed((c) => !c)}
            title={isCollapsed ? 'Expandir painel' : 'Recolher painel'}
            className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            title="Fechar painel de detalhe"
            className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="flex-1 overflow-auto min-h-0 p-3 space-y-3 text-xs">
          <dl className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-2">
            {curtos.map((f) => (
              <div key={f.name} className="min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{f.label}</dt>
                <dd className="text-stone-700 dark:text-stone-300 truncate">
                  <CellValue field={f} row={row} refOptions={refOptions} />
                </dd>
              </div>
            ))}
          </dl>
          {longos.map((f) => (
            <div key={f.name}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{f.label}</div>
              <div className="mt-0.5 p-2 rounded bg-stone-50 dark:bg-stone-950/40 text-stone-700 dark:text-stone-300 whitespace-pre-wrap break-words">
                {String(row[f.name])}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
