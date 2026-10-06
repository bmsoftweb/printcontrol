import React, { useEffect, useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface AvisoErroProps {
  /** Texto do erro; o aviso some sozinho quando ele muda ou depois do tempo */
  mensagem: string;
  onFechar: () => void;
  /** Espaçamento próprio de cada tela (ex.: "mx-4 mt-3") */
  className?: string;
}

/** Tempo que o aviso fica na tela antes de se fechar sozinho */
const SEGUNDOS = 10;

/** Aviso de erro de uma ação: fecha no "x" ou sozinho depois de 10 segundos */
export const AvisoErro: React.FC<AvisoErroProps> = ({ mensagem, onFechar, className = '' }) => {
  // Em ref para o relógio não reiniciar a cada render de quem usa o aviso
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    const t = setTimeout(() => fechar.current(), SEGUNDOS * 1000);
    return () => clearTimeout(t);
  }, [mensagem]);

  return (
    <div
      role="alert"
      className={`${className} p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300`}
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
      <span className="flex-1 min-w-0">{mensagem}</span>
      <button
        type="button"
        onClick={onFechar}
        title="Fechar aviso"
        className="p-0.5 -mt-0.5 rounded shrink-0 text-rose-400 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-900/60 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
