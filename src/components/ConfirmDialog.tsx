import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react';

interface ConfirmDialogProps {
  titulo: string;
  mensagem: React.ReactNode;
  /** Texto do botão de confirmação */
  confirmar?: string;
  /** 'perigo' (vermelho) para excluir/remover; 'normal' (azul) para as demais ações */
  tom?: 'perigo' | 'normal';
  /** Ação confirmada; um erro lançado aqui aparece dentro do diálogo */
  onConfirmar: () => Promise<void> | void;
  onCancelar: () => void;
  /** Conteúdo extra entre a mensagem e os botões (ex.: campo de motivo) */
  children?: React.ReactNode;
  /** Largura máxima (classe Tailwind); padrão max-w-md */
  largura?: string;
}

/** Diálogo de confirmação padrão do app: toda exclusão/remoção passa por ele */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  titulo,
  mensagem,
  confirmar = 'Excluir',
  tom = 'perigo',
  onConfirmar,
  onCancelar,
  children,
  largura = 'max-w-md',
}) => {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await onConfirmar();
    } catch (err: any) {
      setErro(err.message || 'Não foi possível concluir a ação.');
      setOcupado(false);
    }
  };

  const cor =
    tom === 'perigo'
      ? 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800'
      : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800';

  // No body: aberto a partir do menu "..." (que fica escondido depois da escolha) continuaria invisível.
  // Os cliques não sobem para a linha da lista nem para o menu.
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={parar} onDoubleClick={parar} onMouseDown={parar}>
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={ocupado ? undefined : onCancelar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className={`relative w-full ${largura} max-h-[92vh] overflow-y-auto bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10 p-5`}>
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              tom === 'perigo'
                ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900'
                : 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900'
            }`}
          >
            <ShieldAlert className={`w-5 h-5 ${tom === 'perigo' ? 'text-rose-600' : 'text-blue-600'}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{titulo}</h3>
            <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{mensagem}</div>
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}

        {erro && (
          <div className="mt-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{erro}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancelar}
            disabled={ocupado}
            className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={executar}
            disabled={ocupado}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white shadow-xs transition-all cursor-pointer disabled:opacity-50 ${cor}`}
          >
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{confirmar}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
