import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, MoreHorizontal, type LucideIcon } from 'lucide-react';

export interface ItemMaisAcoes {
  icone: LucideIcon;
  titulo: string;
  onClick: () => void;
  disabled?: boolean;
  /** Linha separadora antes deste item */
  separar?: boolean;
  tom?: 'perigo';
  /** Dica (title) do item */
  dica?: string;
  /** Processo em andamento: mostra o giro e bloqueia o item */
  carregando?: boolean;
  /** Opção ligada (ex.: "Listar Tudo"): marcada com ✓ */
  ativo?: boolean;
}

/**
 * Botão "Mais ações" da barra de uma tela: as ações menos usadas num menu com ícone e nome, para a barra
 * mostrar só as do dia a dia. Fecha ao escolher, clicar fora, rolar ou Esc; abre para cima perto do pé da tela.
 */
export const MaisAcoes: React.FC<{ itens: ItemMaisAcoes[]; className?: string; titulo?: string }> = ({ itens, className = '', titulo = 'Mais ações' }) => {
  const botao = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);

  useEffect(() => {
    if (!pos) return;
    const fechar = () => setPos(null);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fechar();
    };
    // Captura: o Esc fecha só o menu, não a janela embaixo dele
    window.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [pos]);

  const abrir = () => {
    const r = botao.current!.getBoundingClientRect();
    const altura = itens.length * 34 + 16;
    const left = Math.min(r.left, window.innerWidth - 232);
    setPos(r.bottom + altura > window.innerHeight ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={() => (pos ? setPos(null) : abrir())}
        className={`inline-flex items-center gap-1.5 h-[38px] px-3 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 bg-white dark:bg-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer ${className}`}
      >
        {itens.some((i) => i.carregando) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
        {titulo}
        <ChevronDown className="w-3 h-3 text-stone-400" />
      </button>
      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setPos(null)} />
            <div role="menu" style={pos} className="fixed z-[61] w-56 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1">
              {itens.map((it, i) => (
                <React.Fragment key={it.titulo}>
                  {it.separar && i > 0 && <div className="my-1 border-t border-stone-100 dark:border-stone-800" />}
                  <button
                    role="menuitem"
                    type="button"
                    disabled={it.disabled || it.carregando}
                    title={it.dica}
                    onClick={() => {
                      setPos(null);
                      it.onClick();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {it.carregando ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin text-stone-400" />
                    ) : (
                      <it.icone className={`w-4 h-4 shrink-0 ${it.tom === 'perigo' ? 'text-rose-600' : 'text-blue-600 dark:text-blue-400'}`} />
                    )}
                    <span className={`text-xs font-medium ${it.tom === 'perigo' ? 'text-rose-700 dark:text-rose-400' : 'text-stone-800 dark:text-stone-100'}`}>{it.titulo}</span>
                    {it.ativo && <Check className="w-3.5 h-3.5 ml-auto text-blue-600 dark:text-blue-400" />}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
};
