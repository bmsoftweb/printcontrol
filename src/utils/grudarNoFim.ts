import { RefObject, useEffect, useRef } from 'react';

/**
 * Chat grudado na última mensagem: enquanto quem lê está no fim (ou perto), tudo que faz a conversa crescer
 * (mensagem nova, imagem ou áudio que terminou de carregar, resposta do bot preenchendo o "digitando...")
 * rola até o fim. Quem subiu para ler algo antigo fica onde está. `chave` muda quando outra conversa abre
 * (ou quando a caixa aparece): volta a grudar no fim.
 */
export function useGrudarNoFim(caixa: RefObject<HTMLElement | null>, chave: unknown) {
  const grudado = useRef(true);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    grudado.current = true;
    const irAoFim = () => {
      if (grudado.current) el.scrollTop = el.scrollHeight;
    };
    const aoRolar = () => {
      grudado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    irAoFim();
    el.addEventListener('scroll', aoRolar, { passive: true });
    // load e loadedmetadata não sobem pela árvore: escuta na captura
    el.addEventListener('load', irAoFim, true);
    el.addEventListener('loadedmetadata', irAoFim, true);
    const mudou = new MutationObserver(irAoFim);
    mudou.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('scroll', aoRolar);
      el.removeEventListener('load', irAoFim, true);
      el.removeEventListener('loadedmetadata', irAoFim, true);
      mudou.disconnect();
    };
  }, [caixa, chave]);
}
