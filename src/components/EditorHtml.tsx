import React, { useEffect, useRef, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Eraser,
  Undo2,
  Redo2,
  Code2,
  Eye,
} from 'lucide-react';
import { INPUT_CLASS } from '../utils/formStyles';

/** Botões de formatação: comando do editor nativo do navegador (execCommand), como no editor de contratos do crmweb */
const FERRAMENTAS: { titulo: string; icone: React.ReactNode; cmd: string }[] = [
  { titulo: 'Negrito', icone: <Bold className="w-4 h-4" />, cmd: 'bold' },
  { titulo: 'Itálico', icone: <Italic className="w-4 h-4" />, cmd: 'italic' },
  { titulo: 'Sublinhado', icone: <Underline className="w-4 h-4" />, cmd: 'underline' },
  { titulo: 'Lista', icone: <List className="w-4 h-4" />, cmd: 'insertUnorderedList' },
  { titulo: 'Lista numerada', icone: <ListOrdered className="w-4 h-4" />, cmd: 'insertOrderedList' },
  { titulo: 'Alinhar à esquerda', icone: <AlignLeft className="w-4 h-4" />, cmd: 'justifyLeft' },
  { titulo: 'Centralizar', icone: <AlignCenter className="w-4 h-4" />, cmd: 'justifyCenter' },
  { titulo: 'Alinhar à direita', icone: <AlignRight className="w-4 h-4" />, cmd: 'justifyRight' },
  { titulo: 'Justificar', icone: <AlignJustify className="w-4 h-4" />, cmd: 'justifyFull' },
  { titulo: 'Limpar formatação', icone: <Eraser className="w-4 h-4" />, cmd: 'removeFormat' },
  { titulo: 'Desfazer', icone: <Undo2 className="w-4 h-4" />, cmd: 'undo' },
  { titulo: 'Refazer', icone: <Redo2 className="w-4 h-4" />, cmd: 'redo' },
];

const BLOCOS = [
  { valor: 'p', rotulo: 'Parágrafo' },
  { valor: 'h1', rotulo: 'Título' },
  { valor: 'h2', rotulo: 'Cláusula' },
  { valor: 'h3', rotulo: 'Subtítulo' },
];

interface EditorHtmlProps {
  /** HTML inicial; o editor visual é "não controlado": troque a `key` para carregar outro texto */
  valor: string;
  onChange: (html: string) => void;
  /** Variáveis oferecidas no menu "Inserir variável" (o texto inserido é `texto`, ex.: @cliente@) */
  variaveis?: { texto: string; descricao: string }[];
  somenteLeitura?: boolean;
  /** Classe de altura da área de edição */
  altura?: string;
}

/** Editor de texto com formatação (HTML), com modo código e variáveis — contrato padrão, contrato do cliente */
export const EditorHtml: React.FC<EditorHtmlProps> = ({ valor, onChange, variaveis = [], somenteLeitura, altura = 'min-h-[420px] max-h-[60vh]' }) => {
  const [html, setHtml] = useState(valor);
  const [modo, setModo] = useState<'visual' | 'html'>('visual');
  const editor = useRef<HTMLDivElement>(null);
  const codigo = useRef<HTMLTextAreaElement>(null);
  /** Última seleção dentro do editor: o menu de variáveis tira o foco dele */
  const selecao = useRef<Range | null>(null);

  useEffect(() => {
    if (modo === 'visual' && editor.current && editor.current.innerHTML !== html) editor.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  useEffect(() => {
    const guardar = () => {
      const s = document.getSelection();
      if (s?.rangeCount && editor.current?.contains(s.anchorNode)) selecao.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', guardar);
    return () => document.removeEventListener('selectionchange', guardar);
  }, []);

  const mudar = (novo: string) => {
    setHtml(novo);
    onChange(novo);
  };
  const lerEditor = () => mudar(editor.current?.innerHTML ?? '');

  const comando = (cmd: string, v?: string) => {
    editor.current?.focus();
    if (selecao.current) {
      const s = document.getSelection();
      s?.removeAllRanges();
      s?.addRange(selecao.current);
    }
    document.execCommand(cmd, false, v);
    lerEditor();
  };

  const inserir = (texto: string) => {
    if (!texto) return;
    if (modo === 'visual') return comando('insertText', texto);
    const t = codigo.current;
    if (!t) return;
    const ini = t.selectionStart;
    mudar(html.slice(0, ini) + texto + html.slice(t.selectionEnd));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(ini + texto.length, ini + texto.length);
    });
  };

  const botao = 'p-1.5 rounded text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700 cursor-pointer disabled:opacity-40 disabled:cursor-default';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60">
        <select
          aria-label="Estilo do bloco"
          disabled={somenteLeitura || modo === 'html'}
          onChange={(e) => {
            comando('formatBlock', e.target.value);
            e.target.value = '';
          }}
          defaultValue=""
          className={`${INPUT_CLASS} w-32 cursor-pointer`}
        >
          <option value="" disabled>
            Estilo…
          </option>
          {BLOCOS.map((b) => (
            <option key={b.valor} value={b.valor}>
              {b.rotulo}
            </option>
          ))}
        </select>
        {FERRAMENTAS.map((f) => (
          <button
            key={f.cmd}
            type="button"
            title={f.titulo}
            disabled={somenteLeitura || modo === 'html'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => comando(f.cmd)}
            className={botao}
          >
            {f.icone}
          </button>
        ))}
        {variaveis.length > 0 && (
          <>
            <span className="w-px h-6 bg-stone-300 dark:bg-stone-700 mx-1" />
            <select aria-label="Inserir variável" disabled={somenteLeitura} value="" onChange={(e) => inserir(e.target.value)} className={`${INPUT_CLASS} w-56 cursor-pointer`}>
              <option value="">Inserir variável…</option>
              {variaveis.map((v) => (
                <option key={v.texto} value={v.texto}>
                  {v.descricao} — {v.texto}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => {
              if (modo === 'visual') lerEditor();
              setModo(modo === 'visual' ? 'html' : 'visual');
            }}
            title={modo === 'visual' ? 'Editar o código HTML' : 'Voltar ao editor visual'}
            className={`${botao} flex items-center gap-1.5 text-xs font-semibold px-2`}
          >
            {modo === 'visual' ? <Code2 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {modo === 'visual' ? 'HTML' : 'Visual'}
          </button>
        </div>
      </div>

      {modo === 'visual' ? (
        <div
          ref={editor}
          contentEditable={!somenteLeitura}
          suppressContentEditableWarning
          onInput={lerEditor}
          aria-label="Texto"
          className={`editor-contrato ${altura} overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800 bg-white text-stone-900 px-10 py-8 text-[11pt] leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/40`}
        />
      ) : (
        <textarea
          ref={codigo}
          value={html}
          onChange={(e) => mudar(e.target.value)}
          readOnly={somenteLeitura}
          spellCheck={false}
          aria-label="Código HTML"
          className={`${INPUT_CLASS} w-full ${altura} font-mono text-[11px] leading-relaxed resize-y`}
        />
      )}
    </div>
  );
};
