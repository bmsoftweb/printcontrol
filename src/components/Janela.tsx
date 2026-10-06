import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface JanelaProps {
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  onFechar: () => void;
  children: React.ReactNode;
  /** Botões do rodapé (à direita) */
  rodape?: React.ReactNode;
  /** Largura máxima (classe Tailwind); padrão max-w-2xl */
  largura?: string;
  /** Bloqueia fechar pelo fundo/Esc (ex.: gravando) */
  ocupado?: boolean;
}

/** Janela modal das telas dos módulos (diálogos do Delphi): título, conteúdo rolável e rodapé com botões */
export const Janela: React.FC<JanelaProps> = ({ titulo, subtitulo, onFechar, children, rodape, largura = 'max-w-2xl', ocupado }) => {
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !ocupado && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, ocupado]);

  const parar = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" onClick={parar} onDoubleClick={parar} onMouseDown={parar}>
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={ocupado ? undefined : onFechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className={`relative w-full ${largura} max-h-[92vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10`}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-stone-100 dark:border-stone-800">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{titulo}</h3>
            {subtitulo && <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{subtitulo}</div>}
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={ocupado}
            title="Fechar"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="px-5 py-3 border-t border-stone-100 dark:border-stone-800 flex items-center justify-end gap-2.5">{rodape}</div>}
      </div>
    </div>,
    document.body,
  );
};

/** Botões padrão do rodapé e das barras das telas (mesma altura dos campos vizinhos: 38px) */
export const BOTAO_PRIMARIO =
  'inline-flex items-center justify-center gap-2 h-[38px] px-4 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BOTAO_SECUNDARIO =
  'inline-flex items-center justify-center gap-2 h-[38px] px-4 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
export const BOTAO_PERIGO =
  'inline-flex items-center justify-center gap-2 h-[38px] px-4 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 shadow-xs transition-all cursor-pointer disabled:opacity-50';
