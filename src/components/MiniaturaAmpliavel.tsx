import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Miniatura que abre a foto grande num modal (fecha clicando fora, no × ou com Esc) */
export const MiniaturaAmpliavel: React.FC<{ src: string; className: string; titulo?: string }> = ({ src, className, titulo }) => {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberta(false);
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aberta]);

  // Os cliques não sobem para a linha da lista (que abriria a edição)
  const parar = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <img
        src={src}
        alt=""
        loading="lazy"
        title="Clique para ampliar"
        onClick={(e) => {
          parar(e);
          setAberta(true);
        }}
        onDoubleClick={parar}
        className={`${className} cursor-zoom-in`}
      />
      {aberta &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={parar} onDoubleClick={parar} onMouseDown={parar}>
            <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-xs" onClick={() => setAberta(false)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" className="relative z-10 flex flex-col items-center gap-2 max-w-[90vw]">
              <button
                type="button"
                onClick={() => setAberta(false)}
                title="Fechar (Esc)"
                className="self-end p-1.5 rounded-full bg-white/90 text-stone-700 hover:bg-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
              <img src={src} alt={titulo ?? ''} className="max-w-[90vw] max-h-[80vh] rounded-xl shadow-2xl bg-white object-contain" />
              {titulo && <div className="text-sm font-semibold text-white">{titulo}</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
