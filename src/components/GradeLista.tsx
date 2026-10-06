import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronRight, Loader2, Menu } from 'lucide-react';
import { Grade as LinhasGrade, ModoLargura, lerConfigLista, salvarConfigLista } from '../utils/configListas';
import { Toggle } from './Toggle';

/**
 * Grade das telas próprias dos módulos, com o mesmo padrão da lista genérica (CrudView / skill listas-crud):
 * indicador ">" da linha, redimensionar e reordenar colunas, menu ☰ (Ajustar/Melhor largura, linhas da grade,
 * Colunas, Salvar Configuração) e preferências por usuário em usuarios.config_listas (chave `nome`).
 * As linhas vêm prontas de quem usa (sem paginação nem busca próprias).
 */
export interface ColunaLista<T> {
  /** Identificador estável: vai para a configuração salva (ordem, larguras, visíveis) */
  id: string;
  titulo: React.ReactNode;
  /** Nome no menu Colunas quando o título não é texto */
  rotulo?: string;
  /** Campo exibido como texto quando não há render */
  campo?: string;
  render?: (row: T) => React.ReactNode;
  alinhar?: 'esq' | 'centro' | 'dir';
  /** Largura inicial (px) */
  largura?: number;
  /** Fora da grade por padrão (o usuário liga no menu Colunas) */
  oculta?: boolean;
  /** Presa à esquerda ao rolar para o lado (as colunas visíveis antes dela ficam presas junto) */
  fixa?: boolean;
  /** Título do grupo de colunas (cabeçalho agrupado das colunas vizinhas com o mesmo grupo) */
  grupo?: string;
  /** Conteúdo do rodapé (ex.: soma) */
  rodape?: React.ReactNode;
  estilo?: (row: T) => React.CSSProperties | undefined;
  classe?: (row: T) => string;
  dica?: string;
  /** Clique no título (ordenação feita por quem usa) */
  aoClicarTitulo?: () => void;
  ordenada?: 'asc' | 'desc' | null;
}

interface GradeListaProps<T> {
  /** Chave da configuração em usuarios.config_listas (ex.: 'locacoes.contratos') */
  nome: string;
  colunas: ColunaLista<T>[];
  linhas: T[];
  chave?: string;
  selecionado?: unknown;
  onSelecionar?: (row: T) => void;
  /** Duplo clique na linha; colunaId = coluna clicada (para ações por coluna) */
  onDuploClique?: (row: T, colunaId?: string) => void;
  carregando?: boolean;
  vazio?: React.ReactNode;
  /** Coluna Ações presa à direita */
  acoes?: (row: T) => React.ReactNode;
  /** Classe Tailwind de largura da coluna Ações (padrão w-24) */
  larguraAcoes?: string;
  classeLinha?: (row: T) => string;
  /** Mensagem "Configuração salva." */
  onToast?: (msg: string) => void;
  /** Rola a grade até a linha selecionada quando ela muda */
  rolarParaSelecionado?: boolean;
  /** Linhas mais baixas (diálogos) */
  compacta?: boolean;
}

const ALINHAR = { esq: 'text-left', centro: 'text-center', dir: 'text-right' };
const ITEM_MENU = 'w-full px-3 py-2 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer text-left';

export function GradeLista<T extends Record<string, any>>({
  nome,
  colunas: todas,
  linhas,
  chave = 'id',
  selecionado,
  onSelecionar,
  onDuploClique,
  carregando,
  vazio = 'Nenhum registro.',
  acoes,
  larguraAcoes = 'w-24 min-w-24 max-w-24',
  classeLinha,
  onToast,
  rolarParaSelecionado,
  compacta,
}: GradeListaProps<T>) {
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [ordem, setOrdem] = useState<string[]>([]);
  const [visiveis, setVisiveis] = useState<string[] | null>(null);
  const [grade, setGrade] = useState<LinhasGrade>('horizontais');
  const [comSobra, setComSobra] = useState(true);
  const [modo, setModo] = useState<ModoLargura>('manual');
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const [subColunas, setSubColunas] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const fecharSub = useRef<number | null>(null);
  const arrastando = useRef<string | null>(null);
  const tabelaRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    let vivo = true;
    lerConfigLista(nome).then((cfg) => {
      if (!vivo) return;
      setLarguras(cfg.larguras || {});
      setOrdem(cfg.ordem || []);
      // Coluna nova (não conhecida quando a configuração foi salva) entra se for visível por padrão
      const conhecidas = new Set(cfg.conhecidas ?? cfg.visiveis ?? []);
      setVisiveis(cfg.visiveis ? [...cfg.visiveis, ...todas.filter((c) => !c.oculta && !conhecidas.has(c.id)).map((c) => c.id)] : null);
      setGrade(cfg.grade || 'horizontais');
      setComSobra(cfg.sobra !== false);
      setModo(cfg.modo || 'manual');
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome]);

  /** Colunas visíveis, na ordem do usuário */
  const colunas = useMemo(() => {
    const vis = todas.filter((c) => (visiveis ? visiveis.includes(c.id) : !c.oculta));
    if (!ordem.length) return vis;
    const pos = (id: string) => {
      const i = ordem.indexOf(id);
      return i < 0 ? ordem.length + todas.findIndex((c) => c.id === id) : i;
    };
    return [...vis].sort((a, b) => pos(a.id) - pos(b.id));
  }, [todas, visiveis, ordem]);

  const bordas = `border-b border-r ${grade === 'ambas' || grade === 'horizontais' ? 'border-b-stone-100 dark:border-b-stone-800/60' : 'border-b-transparent'} ${
    grade === 'ambas' || grade === 'verticais' ? 'border-r-stone-100 dark:border-r-stone-800/60' : 'border-r-transparent'
  }`;

  const alternarColuna = (id: string) =>
    setVisiveis((v) => {
      const atuais = v ?? todas.filter((c) => !c.oculta).map((c) => c.id);
      return atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
    });

  const salvar = () => {
    setMenu(null);
    salvarConfigLista(nome, {
      visiveis: colunas.map((c) => c.id),
      conhecidas: todas.map((c) => c.id),
      larguras: modo === 'manual' ? larguras : undefined,
      ordem: colunas.map((c) => c.id),
      grade,
      sobra: comSobra,
      modo,
    }).then(
      () => onToast?.('Configuração salva.'),
      (e) => onToast?.(e.message || 'Não foi possível salvar a configuração.'),
    );
  };

  // ---------- larguras ----------
  const cabecalhosDados = () => {
    const tabela = tabelaRef.current;
    if (!tabela) return [] as HTMLElement[];
    return Array.from(tabela.querySelectorAll('thead tr:last-child th[data-col]')) as HTMLElement[];
  };

  const aplicarMelhorLargura = () => {
    setComSobra(true);
    const tabela = tabelaRef.current;
    if (!tabela) return;
    const celulas = Array.from(tabela.querySelectorAll('th[data-col], td[data-col]')) as HTMLElement[];
    const anteriores = celulas.map((c) => [c.style.width, c.style.maxWidth, c.style.minWidth]);
    celulas.forEach((c) => {
      c.style.width = '';
      c.style.maxWidth = '';
      c.style.minWidth = '';
    });
    const larguraTabela = tabela.style.width;
    tabela.style.width = 'max-content';
    // getBoundingClientRect + ceil: offsetWidth arredonda para baixo e o texto "truncate" ganhava reticências
    const medidas = cabecalhosDados().map((th) => Math.ceil(th.getBoundingClientRect().width));
    tabela.style.width = larguraTabela;
    celulas.forEach((c, i) => {
      c.style.width = anteriores[i][0];
      c.style.maxWidth = anteriores[i][1];
      c.style.minWidth = anteriores[i][2];
    });
    setLarguras(Object.fromEntries(colunas.map((c, i) => [c.id, Math.max(50, medidas[i] ?? 80)])));
  };

  const aplicarAjustarLargura = () => {
    setComSobra(false);
    const tabela = tabelaRef.current;
    const area = tabela?.parentElement;
    if (!tabela || !area) return;
    const atuais = cabecalhosDados().map((th) => th.offsetWidth);
    const soma = atuais.reduce((a, b) => a + b, 0);
    const fixas = 30 + (acoes ? ((tabela.querySelector('th[data-acoes]') as HTMLElement | null)?.offsetWidth ?? 0) : 0);
    const disponivel = area.clientWidth - fixas - 1;
    if (soma <= 0 || disponivel <= 0) return;
    const finais = atuais.map((l) => Math.max(50, Math.floor((l * disponivel) / soma)));
    const resto = disponivel - finais.reduce((a, b) => a + b, 0);
    if (resto > 0) finais[finais.length - 1] += resto;
    setLarguras(Object.fromEntries(colunas.map((c, i) => [c.id, finais[i]])));
  };

  // Modos automáticos: recalcula ao abrir, quando chegam as linhas e quando a janela muda de tamanho
  useEffect(() => {
    if (modo === 'manual') return;
    const aplicar = () => (modo === 'ajustar' ? aplicarAjustarLargura() : aplicarMelhorLargura());
    const id = requestAnimationFrame(aplicar);
    window.addEventListener('resize', aplicar);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', aplicar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, colunas, linhas]);

  const iniciarRedimensionamento = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModo('manual');
    // Congela as larguras atuais: sem isso o navegador redistribui a sobra e o arraste "escorrega"
    const base = cabecalhosDados().map((th) => th.offsetWidth);
    const indice = colunas.findIndex((c) => c.id === id);
    const x0 = e.clientX;
    const mover = (ev: PointerEvent) => {
      const finais = [...base];
      finais[indice] = Math.max(50, base[indice] + ev.clientX - x0);
      // Sem coluna de sobra, a coluna seguinte cede o espaço (total constante)
      if (!comSobra && indice < finais.length - 1) finais[indice + 1] = Math.max(50, base[indice + 1] - (finais[indice] - base[indice]));
      setLarguras(Object.fromEntries(colunas.map((c, i) => [c.id, finais[i]])));
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const soltarColuna = (destino: string) => {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === destino) return;
    const ids = colunas.map((c) => c.id).filter((id) => id !== origem);
    ids.splice(ids.indexOf(destino), 0, origem);
    setOrdem(ids);
  };

  // ---------- menu ☰ (portal: dentro da grade, que rola, ficaria cortado) ----------
  const abrirMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const altura = 330;
    setSubColunas(null);
    setMenu((m) => (m ? null : { left: r.left, top: r.bottom + altura > window.innerHeight ? Math.max(8, r.top - altura) : r.bottom + 4 }));
  };
  const abrirSub = (el: HTMLElement) => {
    if (fecharSub.current) window.clearTimeout(fecharSub.current);
    const r = el.getBoundingClientRect();
    const LARGURA = 240;
    const left = r.right - 4 + LARGURA > window.innerWidth ? Math.max(8, r.left - LARGURA + 4) : r.right - 4;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - 248));
    setSubColunas({ top, left, maxHeight: window.innerHeight - top - 8 });
  };
  useEffect(() => {
    if (!menu) return;
    const fechar = () => {
      setMenu(null);
      setSubColunas(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      fechar();
    };
    // Captura: roda antes do Esc das janelas (Janela) e impede que ele chegue lá
    window.addEventListener('keydown', esc, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', fechar);
    };
  }, [menu]);

  const rotulo = (c: ColunaLista<T>) => c.rotulo ?? (typeof c.titulo === 'string' ? c.titulo : c.id);

  // ---------- cabeçalho agrupado ----------
  const grupos = colunas.some((c) => c.grupo)
    ? colunas.reduce<{ titulo: string; n: number }[]>((acc, c) => {
        const t = c.grupo ?? '';
        if (acc.length && acc[acc.length - 1].titulo === t) acc[acc.length - 1].n++;
        else acc.push({ titulo: t, n: 1 });
        return acc;
      }, [])
    : null;
  const temRodape = colunas.some((c) => c.rodape !== undefined);
  /** Presas à esquerda: as visíveis até a última com "fixa" (as anteriores vão junto, senão a fixa encobre) */
  const ultimaFixa = colunas.reduce((u, c, i) => (c.fixa ? i : u), -1);
  const fixas = new Set(colunas.slice(0, ultimaFixa + 1).map((c) => c.id));
  const thBase = 'px-3 py-2.5 text-center font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap bg-stone-50 dark:bg-stone-950 border-b border-r border-stone-200 dark:border-stone-800';
  const nCols = colunas.length + 1 + (comSobra ? 1 : 0) + (acoes ? 1 : 0);

  const [esquerdas, setEsquerdas] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    if (!fixas.size) return;
    const medir = () => {
      let x = 30;
      const novo: Record<string, number> = {};
      for (const th of cabecalhosDados()) {
        const id = th.dataset.col!;
        if (!fixas.has(id)) break;
        novo[id] = x;
        x += th.getBoundingClientRect().width;
      }
      setEsquerdas((a) => (JSON.stringify(a) === JSON.stringify(novo) ? a : novo));
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colunas, larguras, linhas, ultimaFixa]);
  const presa = (id: string): React.CSSProperties | undefined => (fixas.has(id) ? { position: 'sticky', left: esquerdas[id] ?? 30 } : undefined);

  useEffect(() => {
    if (!rolarParaSelecionado || selecionado === undefined || selecionado === null) return;
    tabelaRef.current?.querySelector('tr[data-sel="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [rolarParaSelecionado, selecionado, linhas]);
  const py = compacta ? 'py-[3px]' : 'py-[7.5px]';

  const largura = (id: string): React.CSSProperties | undefined => (larguras[id] ? { width: larguras[id], minWidth: larguras[id], maxWidth: larguras[id] } : undefined);
  const larguraInicial = (c: ColunaLista<T>): React.CSSProperties | undefined => largura(c.id) ?? (c.largura ? { minWidth: c.largura } : undefined);

  return (
    <div className="flex-1 overflow-auto min-h-0">
      <table ref={tabelaRef} className="w-full text-xs border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          {grupos && (
            <tr>
              <th className={`sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] ${thBase} py-1`} />
              {grupos.map((g, i) => (
                <th key={i} colSpan={g.n} className={`${thBase} py-1 text-[11px]`}>
                  {g.titulo}
                </th>
              ))}
              {comSobra && <th className={`${thBase} py-1 border-r-0`} />}
              {acoes && <th className={`sticky right-0 z-20 ${thBase} py-1 border-l`} />}
            </tr>
          )}
          <tr>
            <th className={`sticky left-0 z-20 w-[30px] min-w-[30px] max-w-[30px] px-0 ${thBase}`}>
              <button
                type="button"
                onClick={(e) => abrirMenu(e.currentTarget)}
                title="Opções das colunas"
                className="p-1 mx-auto block text-stone-400 hover:text-blue-600 dark:text-stone-500 dark:hover:text-blue-400 cursor-pointer"
              >
                <Menu className="w-3.5 h-3.5" />
              </button>
            </th>
            {colunas.map((c) => (
              <th
                key={c.id}
                data-col={c.id}
                draggable
                onDragStart={(e) => {
                  arrastando.current = c.id;
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarColuna(c.id);
                }}
                onClick={c.aoClicarTitulo}
                title={c.dica ?? (c.aoClicarTitulo ? `Ordenar por ${rotulo(c)}` : undefined)}
                style={{ ...larguraInicial(c), ...presa(c.id) }}
                className={`relative ${thBase} select-none ${c.aoClicarTitulo ? 'cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800/60' : ''} ${
                  grade === 'ambas' || grade === 'verticais' ? '' : 'border-r-transparent'
                } ${fixas.has(c.id) ? 'z-20' : ''}`}
              >
                <span
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  onPointerDown={(e) => iniciarRedimensionamento(e, c.id)}
                  onClick={(e) => e.stopPropagation()}
                  title="Arrastar para redimensionar"
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                />
                <span className="inline-flex items-center gap-1 justify-center">
                  {c.titulo}
                  {c.ordenada === 'asc' && <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                  {c.ordenada === 'desc' && <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />}
                </span>
              </th>
            ))}
            {comSobra && <th className="w-full border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950" />}
            {acoes && (
              <th data-acoes className={`sticky right-0 z-20 ${larguraAcoes} ${thBase} border-l`}>
                Ações
              </th>
            )}
          </tr>
        </thead>
        <tbody className={carregando && linhas.length > 0 ? 'opacity-60' : undefined}>
          {carregando && linhas.length === 0 && (
            <tr>
              <td colSpan={nCols} className="px-3 py-12 text-center">
                <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Carregando…</span>
                </div>
              </td>
            </tr>
          )}
          {!carregando && linhas.length === 0 && (
            <tr>
              <td colSpan={nCols} className="px-3 py-12 text-center text-stone-500 dark:text-stone-400">
                {vazio}
              </td>
            </tr>
          )}
          {linhas.map((row, i) => {
            const id = row[chave] ?? i;
            const sel = selecionado !== undefined && selecionado !== null && String(selecionado) === String(row[chave]);
            return (
              <tr
                key={String(id)}
                data-sel={sel ? '1' : undefined}
                data-id={String(row[chave] ?? i)}
                onClick={onSelecionar ? () => onSelecionar(row) : undefined}
                onDoubleClick={
                  onDuploClique ? (e) => onDuploClique(row, (e.target as HTMLElement).closest('td[data-col]')?.getAttribute('data-col') ?? undefined) : undefined
                }
                className={`group transition-colors ${onSelecionar || onDuploClique ? 'cursor-pointer' : ''} ${
                  sel ? 'bg-blue-100 dark:bg-blue-950' : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                } ${classeLinha?.(row) ?? ''}`}
              >
                <td className={`sticky left-0 z-[5] w-[30px] min-w-[30px] max-w-[30px] px-0 text-center align-middle bg-inherit border-r border-stone-200 dark:border-stone-800 ${bordas}`}>
                  <ChevronRight
                    className={`w-3.5 h-3.5 mx-auto ${sel ? 'text-blue-600 dark:text-blue-400' : 'text-stone-300 opacity-0 group-hover:opacity-100 dark:text-stone-600'}`}
                  />
                </td>
                {colunas.map((c) => {
                  const conteudo = c.render ? c.render(row) : c.campo ? row[c.campo] : null;
                  return (
                  <td
                    key={c.id}
                    data-col={c.id}
                    // Texto cortado (truncate): o conteúdo inteiro aparece ao passar o mouse
                    title={typeof conteudo === 'string' || typeof conteudo === 'number' ? String(conteudo) : undefined}
                    style={{ ...largura(c.id), ...c.estilo?.(row), ...presa(c.id) }}
                    className={`px-3 ${py} align-middle truncate text-stone-700 dark:text-stone-300 ${ALINHAR[c.alinhar ?? 'esq']} ${bordas} ${
                      fixas.has(c.id) ? 'z-[4] bg-inherit' : ''
                    } ${c.classe?.(row) ?? ''}`}
                  >
                    {conteudo}
                  </td>
                  );
                })}
                {comSobra && <td className={`w-full ${bordas}`} />}
                {acoes && (
                  <td
                    className={`sticky right-0 z-[5] ${larguraAcoes} px-2 ${py} text-center whitespace-nowrap bg-inherit border-l border-stone-200 dark:border-stone-800 ${bordas}`}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {acoes(row)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {temRodape && linhas.length > 0 && (
          <tfoot className="sticky bottom-0 z-10">
            <tr className="bg-stone-50 dark:bg-stone-950 font-semibold">
              <td className="sticky left-0 z-20 bg-stone-50 dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800" />
              {colunas.map((c) => (
                <td key={c.id} className={`px-3 py-2 whitespace-nowrap border-t border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-100 ${ALINHAR[c.alinhar ?? 'esq']}`}>
                  {c.rodape}
                </td>
              ))}
              {comSobra && <td className="border-t border-stone-200 dark:border-stone-800" />}
              {acoes && <td className="sticky right-0 bg-stone-50 dark:bg-stone-950 border-t border-l border-stone-200 dark:border-stone-800" />}
            </tr>
          </tfoot>
        )}
      </table>

      {menu &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={() => {
                setMenu(null);
                setSubColunas(null);
              }}
            />
            <div style={{ top: menu.top, left: menu.left }} className="fixed z-[61] w-52 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1 text-left">
              <button
                type="button"
                className={ITEM_MENU}
                onClick={() => {
                  setMenu(null);
                  setModo('ajustar');
                  aplicarAjustarLargura();
                }}
              >
                Ajustar largura
              </button>
              <button
                type="button"
                className={ITEM_MENU}
                onClick={() => {
                  setMenu(null);
                  setModo('melhor');
                  aplicarMelhorLargura();
                }}
              >
                Melhor largura
              </button>
              <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
              {(
                [
                  ['ambas', 'Mostrar linhas da grade'],
                  ['horizontais', 'Mostrar linhas horizontais'],
                  ['verticais', 'Mostrar linhas verticais'],
                  ['nenhuma', 'Não mostrar linhas da grade'],
                ] as [LinhasGrade, string][]
              ).map(([valor, texto]) => (
                <button
                  type="button"
                  key={valor}
                  onClick={() => {
                    setGrade(valor);
                    setMenu(null);
                  }}
                  className={`${ITEM_MENU} ${grade === valor ? '!text-blue-700 dark:!text-blue-300 font-semibold' : ''}`}
                >
                  {texto}
                </button>
              ))}
              <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
              <div
                onMouseEnter={(e) => abrirSub(e.currentTarget)}
                onMouseLeave={() => {
                  fecharSub.current = window.setTimeout(() => setSubColunas(null), 350);
                }}
              >
                <button
                  type="button"
                  onClick={(e) => (subColunas ? setSubColunas(null) : abrirSub(e.currentTarget))}
                  className={`${ITEM_MENU} flex items-center justify-between ${subColunas ? 'bg-stone-100 dark:bg-stone-800' : ''}`}
                >
                  Colunas
                  <ChevronRight className="w-3.5 h-3.5 text-stone-400" />
                </button>
              </div>
              <div className="my-1 border-t border-stone-200 dark:border-stone-700" />
              <button type="button" className={ITEM_MENU} onClick={salvar}>
                Salvar Configuração
              </button>
            </div>
            {subColunas && (
              <div
                onMouseEnter={() => fecharSub.current && window.clearTimeout(fecharSub.current)}
                onMouseLeave={() => {
                  fecharSub.current = window.setTimeout(() => setSubColunas(null), 350);
                }}
                style={{ top: subColunas.top, left: subColunas.left, maxHeight: subColunas.maxHeight }}
                className="fixed z-[62] w-60 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg py-1"
              >
                {todas.map((c) => (
                  <div key={c.id} className="px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800">
                    <Toggle
                      checked={colunas.some((v) => v.id === c.id)}
                      onChange={() => alternarColuna(c.id)}
                      size="sm"
                      label={<span className="text-xs text-stone-700 dark:text-stone-200">{rotulo(c)}</span>}
                    />
                  </div>
                ))}
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
