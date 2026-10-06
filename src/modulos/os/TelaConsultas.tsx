import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Grid3x3,
  LineChart,
  Loader2,
  Play,
  Printer,
  RefreshCw,
  Save,
  Settings2,
} from 'lucide-react';
import type { TelaProps } from '../tipos';
import type { OpcaoRef } from '../../types';
import { api } from '../../services/api';
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { CrudView } from '../../components/CrudView';
import { MaisAcoes } from '../../components/MaisAcoes';
import { SelectBusca } from '../../components/SelectBusca';
import { DateField } from '../../components/DateField';
import { NumberField } from '../../components/NumberField';
import { AvisoErro } from '../../components/AvisoErro';
import { INPUT_CLASS } from '../../utils/formStyles';
import { Barra, CAMPO, ColunaGrade, Grade, abrirPdf, dataBR, dataHoraBR } from './comum';
import { ColunaConsulta, ParametroConsulta, formatarNumero, itensLista, montarPivot, valorInicial } from './regras';

interface Consulta {
  id: number;
  grupo: string | null;
  codigo: string | null;
  descricao_resumida: string | null;
  parametros: ParametroConsulta[];
  abas: { n: number; titulo: string }[];
  pivot: { linhas: string[]; colunas: string[]; metrica: string[] };
  /** Linha de título do grupo na lista (só na tela) */
  _grupo?: boolean;
}

interface Aba {
  n: number;
  titulo: string;
  colunas: ColunaConsulta[];
  linhas: Record<string, any>[];
  truncado: boolean;
}

type Passo = 'lista' | 'parametros' | 'resultado' | 'cubo' | 'grafico';

/** Valor da célula no formato da coluna (números à direita, datas dd/mm/aaaa) */
function celula(c: ColunaConsulta, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'dec' || (c.tipo === 'int' && c.formato)) return formatarNumero(v, c.formato || ',0.00');
  if (c.tipo === 'date') return dataBR(v);
  if (c.tipo === 'datetime') return dataHoraBR(v);
  return String(v);
}

const carimbo = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(/\D/g, '').slice(0, 14);
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob(['﻿', conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Excel: tabela HTML salva como .xls (o Excel abre direto, como o arquivo que o Delphi gerava) */
function exportarXls(nome: string, cabecalho: string[], linhas: string[][]) {
  const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><tr>${cabecalho.map((t) => `<th>${escHtml(t)}</th>`).join('')}</tr>${linhas
    .map((l) => `<tr>${l.map((v) => `<td>${escHtml(v)}</td>`).join('')}</tr>`)
    .join('')}</table></body></html>`;
  baixar(nome, html, 'application/vnd.ms-excel');
}

function exportarCsv(nome: string, cabecalho: string[], linhas: string[][]) {
  const campo = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  baixar(nome, [cabecalho, ...linhas].map((l) => l.map(campo).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

/** Gráfico de linhas simples: X = 1ª coluna, valor = 2ª coluna, rótulo do valor acima de cada ponto */
const GraficoLinhas: React.FC<{ aba: Aba }> = ({ aba }) => {
  const [cx, cy] = aba.colunas;
  if (!cx || !cy) return <p className="p-6 text-sm text-stone-500">O SQL 1 precisa de duas colunas (rótulo e valor) para o gráfico.</p>;
  const pontos = aba.linhas.map((l) => ({ x: String(celula(cx, l[cx.campo])), y: Number(l[cy.campo]) || 0 }));
  if (!pontos.length) return <p className="p-6 text-sm text-stone-500">Sem dados.</p>;
  const L = Math.max(600, pontos.length * 70);
  const H = 360;
  const m = { e: 60, d: 30, t: 30, b: 60 };
  const max = Math.max(...pontos.map((p) => p.y), 0);
  const min = Math.min(...pontos.map((p) => p.y), 0);
  const faixa = max - min || 1;
  const px = (i: number) => m.e + (pontos.length === 1 ? (L - m.e - m.d) / 2 : (i * (L - m.e - m.d)) / (pontos.length - 1));
  const py = (v: number) => m.t + ((max - v) * (H - m.t - m.b)) / faixa;
  const fmt = (v: number) => formatarNumero(v, cy.formato || (cy.tipo === 'int' ? ',0' : ',0.00'));
  return (
    <div className="overflow-auto p-4">
      <svg width={L} height={H} className="text-stone-500" role="img" aria-label={`Gráfico de ${cy.titulo} por ${cx.titulo}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = min + f * faixa;
          return (
            <g key={f}>
              <line x1={m.e} x2={L - m.d} y1={py(v)} y2={py(v)} stroke="currentColor" strokeOpacity={0.15} />
              <text x={m.e - 6} y={py(v) + 3} fontSize={10} textAnchor="end" fill="currentColor">
                {fmt(v)}
              </text>
            </g>
          );
        })}
        <polyline fill="none" stroke="#2563eb" strokeWidth={2} points={pontos.map((p, i) => `${px(i)},${py(p.y)}`).join(' ')} />
        {pontos.map((p, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(p.y)} r={3.5} fill="#2563eb" />
            <text x={px(i)} y={py(p.y) - 8} fontSize={10} textAnchor="middle" className="fill-stone-700 dark:fill-stone-200">
              {fmt(p.y)}
            </text>
            <text x={px(i)} y={H - m.b + 16} fontSize={10} textAnchor="end" transform={`rotate(-35 ${px(i)} ${H - m.b + 16})`} fill="currentColor">
              {p.x.length > 18 ? `${p.x.slice(0, 18)}…` : p.x}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

/** Bloco do configurador do cubo: Disponíveis | Selecionados com ↑ ↓ → ← */
const BlocoPivot: React.FC<{ titulo: string; campos: string[]; selecionados: string[]; onChange: (s: string[]) => void }> = ({ titulo, campos, selecionados, onChange }) => {
  const [disp, setDisp] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const disponiveis = campos.filter((c) => !selecionados.includes(c));
  const mover = (d: number) => {
    if (!sel) return;
    const i = selecionados.indexOf(sel);
    const j = i + d;
    if (j < 0 || j >= selecionados.length) return;
    const n = [...selecionados];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const lista = (itens: string[], marcado: string | null, marcar: (s: string) => void, duplo: (s: string) => void) => (
    <div className="h-36 overflow-auto border border-stone-200 dark:border-stone-700 rounded bg-stone-50 dark:bg-stone-800/60">
      {itens.map((c) => (
        <div
          key={c}
          onClick={() => marcar(c)}
          onDoubleClick={() => duplo(c)}
          className={`px-2 py-1 text-xs cursor-pointer select-none ${marcado === c ? 'bg-blue-600 text-white' : 'hover:bg-stone-100 dark:hover:bg-stone-700'}`}
        >
          {c}
        </div>
      ))}
    </div>
  );
  const btn = 'p-1.5 rounded border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40';
  return (
    <div className="flex-1 min-w-[260px]">
      <div className="text-xs font-bold text-stone-700 dark:text-stone-200 mb-1">{titulo}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 items-center">
        <div>
          <div className="text-[11px] text-stone-500">Disponíveis</div>
          {lista(disponiveis, disp, setDisp, (c) => onChange([...selecionados, c]))}
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" className={btn} title="Subir" onClick={() => mover(-1)} disabled={!sel}>
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" className={btn} title="Descer" onClick={() => mover(1)} disabled={!sel}>
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button type="button" className={btn} title="Incluir" onClick={() => disp && disponiveis.includes(disp) && onChange([...selecionados, disp])} disabled={!disp}>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button type="button" className={btn} title="Remover" onClick={() => sel && onChange(selecionados.filter((s) => s !== sel))} disabled={!sel}>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        </div>
        <div>
          <div className="text-[11px] text-stone-500">Selecionados</div>
          {lista(selecionados, sel, setSel, (c) => onChange(selecionados.filter((s) => s !== c)))}
        </div>
      </div>
    </div>
  );
};

/** Consultas configuráveis (ufrmConsultas): lista → parâmetros → resultado (até 4 SQLs) → cubo / gráfico */
export const TelaConsultas: React.FC<TelaProps> = ({ usuario, resources, onToast, refreshToken, createToken, onNavigate, onCountChange }) => {
  const nivel = String(usuario.nivel || 'Z').toUpperCase();
  const [cadastro, setCadastro] = useState(false);
  const [lista, setLista] = useState<Consulta[] | null>(null);
  const [atual, setAtual] = useState<Consulta | null>(null);
  const [passo, setPasso] = useState<Passo>('lista');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [opcoesP, setOpcoesP] = useState<Record<string, OpcaoRef[]>>({});
  const [abas, setAbas] = useState<Aba[]>([]);
  const [abaAtiva, setAbaAtiva] = useState(0);
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pivot, setPivot] = useState({ linhas: [] as string[], colunas: [] as string[], metrica: [] as string[] });
  const [pivotAplicado, setPivotAplicado] = useState(pivot);
  const [configurando, setConfigurando] = useState(false);

  useEffect(() => {
    setLista(null);
    api
      .get<Consulta[]>('/api/consultas/lista')
      .then((l) => {
        setLista(l);
        setAtual((a) => l.find((c) => c.id === a?.id) ?? l[0] ?? null);
      })
      .catch((e) => {
        setErro(e.message);
        setLista([]);
      });
  }, [refreshToken, cadastro]);

  const avancar = (c: Consulta | null = atual) => {
    if (!c) return;
    setAtual(c);
    const ini: Record<string, string> = {};
    for (const p of c.parametros) ini[p.nome] = valorInicial(p);
    setValores(ini);
    for (const p of c.parametros.filter((p) => p.tipo === 'P'))
      api
        .get<OpcaoRef[]>(`/api/consultas/${c.id}/opcoes/${encodeURIComponent(p.nome)}`)
        .then((o) => setOpcoesP((x) => ({ ...x, [p.nome]: o })))
        .catch((e) => setErro(e.message));
    if (c.parametros.length) setPasso('parametros');
    else executar(c, ini);
  };

  async function executar(c: Consulta, v: Record<string, string>) {
    setExecutando(true);
    setErro(null);
    try {
      const r = await api.post<Aba[]>(`/api/consultas/${c.id}/executar`, { valores: v });
      setAbas(r);
      setAbaAtiva(0);
      setPivot(c.pivot);
      setPivotAplicado(c.pivot);
      setConfigurando(false);
      setPasso('resultado');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setExecutando(false);
    }
  }

  const voltarResultado = () => setPasso(atual?.parametros.length ? 'parametros' : 'lista');

  const exibicao = useMemo(() => {
    const r: Record<string, string> = {};
    for (const p of atual?.parametros ?? []) {
      const v = valores[p.nome] ?? '';
      r[p.nome] = p.tipo === 'D' ? dataBR(v) : p.tipo === 'P' ? opcoesP[p.nome]?.find((o) => o.value === v)?.label ?? v : v;
    }
    return r;
  }, [atual, valores, opcoesP]);

  const linhasTexto = (a: Aba) => a.linhas.map((l) => a.colunas.map((c) => celula(c, l[c.campo])));
  const exportar = (tipo: 'xls' | 'csv') => {
    for (const a of abas) {
      const nome = `${atual?.codigo || 'consulta'}_${a.n}_${carimbo()}.${tipo}`;
      (tipo === 'xls' ? exportarXls : exportarCsv)(nome, a.colunas.map((c) => c.titulo), linhasTexto(a));
    }
  };

  const imprimir = async () => {
    if (!atual) return;
    setExecutando(true);
    setErro(null);
    try {
      await abrirPdf(`/api/consultas/${atual.id}/pdf`, { valores, exibicao });
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setExecutando(false);
    }
  };

  const sql1 = abas.find((a) => a.n === 1) ?? null;
  const camposSql1 = sql1?.colunas.map((c) => c.campo) ?? [];
  const cubo = useMemo(
    () => (sql1 && pivotAplicado.metrica.length ? montarPivot(sql1.linhas, pivotAplicado.linhas, pivotAplicado.colunas, pivotAplicado.metrica) : null),
    [sql1, pivotAplicado],
  );

  const salvarPivot = async () => {
    if (!atual) return;
    try {
      await api.put(`/api/consultas/${atual.id}/pivot`, pivot);
      setAtual({ ...atual, pivot });
      setLista((l) => l?.map((c) => (c.id === atual.id ? { ...c, pivot } : c)) ?? null);
      onToast('Configuração do cubo gravada.');
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const exportarCubo = () => {
    if (!cubo) return;
    const { linhas: L, colunas: C, metrica: M } = pivotAplicado;
    const nomeCol = (k: string[]) => (k.length ? k.join(' / ') : 'Valores');
    const cab = [...L, ...cubo.colunas.flatMap((k) => M.map((m) => `${nomeCol(k)} - ${m}`)), ...M.map((m) => `Total - ${m}`)];
    const linhas = [
      ...cubo.linhas.map((l) => [...l.chaves, ...l.valores.flatMap((v) => v.map((n) => formatarNumero(n, '0.00')))]),
      [...L.map((_, i) => (i === 0 ? 'Total' : '')), ...cubo.totais.flatMap((v) => v.map((n) => formatarNumero(n, '0.00')))],
    ];
    exportarXls(`${atual?.codigo || 'consulta'}_cubo_${carimbo()}.xls`, cab, linhas);
  };

  const recursoCadastro = resources.find((r) => r.name === 'consultas');
  if (cadastro && recursoCadastro) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <Barra>
          <button className={BOTAO_SECUNDARIO} onClick={() => setCadastro(false)}>
            <ChevronLeft className="w-4 h-4" /> Voltar às consultas
          </button>
          <span className="text-xs text-stone-500">Os SQLs são executados só para leitura (SELECT/WITH), com tempo máximo e limite de linhas.</span>
        </Barra>
        <CrudView
          resource={recursoCadastro}
          allResources={resources}
          refreshToken={refreshToken}
          createToken={createToken}
          onToast={onToast}
          onCountChange={onCountChange}
          onNavigate={onNavigate}
          usuario={usuario}
        />
      </div>
    );
  }

  const colunasLista: ColunaGrade<Consulta>[] = [
    { chave: 'codigo', titulo: 'Código', largura: 90, render: (c) => (c._grupo ? <b className="text-stone-500">{c.grupo || 'Sem grupo'}</b> : c.codigo) },
    { chave: 'descricao_resumida', titulo: 'Descrição Resumida', largura: 500, render: (c) => (c._grupo ? '' : c.descricao_resumida) },
  ];
  // Agrupado por "grupo" (o Delphi agrupava a grade): uma linha de título por grupo
  const linhasLista = (lista ?? []).flatMap((c, i, arr) =>
    i === 0 || arr[i - 1].grupo !== c.grupo ? [{ ...c, id: -1 - i, _grupo: true }, c] : [c],
  );
  const aba = abas[Math.min(abaAtiva, abas.length - 1)];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {passo === 'lista' && (
        <>
          <Barra>
            <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">Escolha a consulta</span>
            <div className="ml-auto flex gap-2">
              {nivel <= 'A' && recursoCadastro && (
                <button className={BOTAO_SECUNDARIO} onClick={() => setCadastro(true)} title="Cadastro dos SQLs, parâmetros e permissões (administrador)">
                  <Database className="w-4 h-4" /> Cadastro
                </button>
              )}
              <button className={BOTAO_PRIMARIO} disabled={!atual || executando} onClick={() => avancar()}>
                {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />} Avançar
              </button>
            </div>
          </Barra>
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
          <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-900">
            <Grade
              nome="consultas.lista"
              onToast={onToast}
              colunas={colunasLista}
              linhas={linhasLista}
              carregando={!lista}
              selecionado={atual?.id}
              onSelecionar={(c) => !c._grupo && setAtual(c)}
              onDuploClique={(c) => !c._grupo && avancar(c)}
              vazio="Nenhuma consulta liberada para você."
            />
          </div>
        </>
      )}

      {passo === 'parametros' && atual && (
        <>
          <Barra>
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">{atual.descricao_resumida}</span>
            <div className="ml-auto flex gap-2">
              <button className={BOTAO_SECUNDARIO} onClick={() => setPasso('lista')}>
                <ChevronLeft className="w-4 h-4" /> Voltar
              </button>
              <button className={BOTAO_PRIMARIO} disabled={executando} onClick={() => executar(atual, valores)}>
                {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Avançar
              </button>
            </div>
          </Barra>
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
          <form
            className="p-6 grid gap-3 max-w-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              executar(atual, valores);
            }}
          >
            {atual.parametros.map((p) => {
              const muda = (v: string) => setValores((x) => ({ ...x, [p.nome]: v }));
              const v = valores[p.nome] ?? '';
              return (
                <label key={p.nome} className="grid grid-cols-[150px_1fr] items-center gap-3">
                  <span className="text-xs font-semibold text-stone-600 dark:text-stone-300 text-right">{p.rotulo}:</span>
                  {p.tipo === 'D' ? (
                    <DateField className={CAMPO} value={v} onChange={muda} />
                  ) : p.tipo === 'I' ? (
                    <NumberField className={CAMPO} value={v} scale={0} onChange={muda} />
                  ) : p.tipo === 'N' ? (
                    <NumberField className={CAMPO} value={v} scale={2} allowNegative onChange={muda} />
                  ) : p.tipo === 'L' ? (
                    <select className={INPUT_CLASS} value={v} onChange={(e) => muda(e.target.value)}>
                      {itensLista(p).map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  ) : p.tipo === 'P' ? (
                    <SelectBusca className={CAMPO} value={v} options={opcoesP[p.nome] ?? []} onChange={muda} vazioLabel="Pesquisar…" />
                  ) : (
                    <input className={INPUT_CLASS} value={v} onChange={(e) => muda(e.target.value)} onFocus={(e) => e.target.select()} />
                  )}
                </label>
              );
            })}
            <button type="submit" className="hidden" />
          </form>
        </>
      )}

      {passo === 'resultado' && atual && (
        <>
          <Barra>
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Registros Selecionados na Consulta — {atual.descricao_resumida}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className={BOTAO_SECUNDARIO} onClick={voltarResultado}>
                <ChevronLeft className="w-4 h-4" /> Voltar
              </button>
              <button className={BOTAO_SECUNDARIO} onClick={imprimir} disabled={executando} title="PDF com a grade do resultado">
                {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />} Imprimir
              </button>
              <button className={BOTAO_SECUNDARIO} onClick={() => exportar('xls')} title="Um arquivo .xls por SQL">
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </button>
              <button className={BOTAO_SECUNDARIO} onClick={() => setPasso('cubo')} disabled={!sql1}>
                <Grid3x3 className="w-4 h-4" /> Cubo
              </button>
              <MaisAcoes
                itens={[
                  { icone: FileSpreadsheet, titulo: 'CSV', onClick: () => exportar('csv') },
                  { icone: LineChart, titulo: 'Gráfico', onClick: () => setPasso('grafico'), disabled: !sql1 },
                ]}
              />
            </div>
          </Barra>
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
          {abas.length > 1 && (
            <div className="flex gap-1 px-4 pt-2 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
              {abas.map((a, i) => (
                <button
                  key={a.n}
                  onClick={() => setAbaAtiva(i)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg cursor-pointer ${i === abaAtiva ? 'bg-blue-600 text-white' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'}`}
                >
                  {a.titulo}
                </button>
              ))}
            </div>
          )}
          {aba && (
            <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-900">
              <Grade
                key={`${atual.id}.${aba.n}`}
                nome={`consultas.${atual.id}.${aba.n}`}
                onToast={onToast}
                chave="__i"
                colunas={aba.colunas.map((c) => ({
                  chave: c.campo,
                  titulo: c.titulo,
                  largura: c.largura,
                  alinhar: c.tipo === 'int' || c.tipo === 'dec' ? 'dir' : c.tipo === 'date' || c.tipo === 'datetime' ? 'centro' : 'esq',
                  render: (l: any) => celula(c, l[c.campo]),
                }))}
                linhas={aba.linhas.map((l, i) => ({ ...l, __i: i }))}
                vazio="A consulta não retornou registros."
              />
              <div className="px-4 py-1.5 text-[11px] text-stone-500 border-t border-stone-100 dark:border-stone-800">
                {aba.linhas.length} registro(s){aba.truncado ? ' — resultado limitado às primeiras linhas; refine os parâmetros' : ''}
              </div>
            </div>
          )}
        </>
      )}

      {passo === 'cubo' && atual && (
        <>
          <Barra>
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Consulta Avançada — {atual.descricao_resumida}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className={BOTAO_SECUNDARIO} onClick={() => setPasso('resultado')}>
                <ChevronLeft className="w-4 h-4" /> Voltar
              </button>
              <MaisAcoes
                itens={[
                  { icone: FileSpreadsheet, titulo: 'Excel', onClick: exportarCubo, disabled: !cubo },
                  {
                    icone: RefreshCw,
                    titulo: 'Refazer (configuração gravada)',
                    onClick: () => {
                      setPivot(atual.pivot);
                      setPivotAplicado(atual.pivot);
                    },
                  },
                ]}
              />
              {nivel <= 'B' && (
                <button className={BOTAO_SECUNDARIO} onClick={() => setConfigurando((x) => !x)}>
                  <Settings2 className="w-4 h-4" /> Configurar
                </button>
              )}
              {configurando && (
                <>
                  <button className={BOTAO_SECUNDARIO} onClick={salvarPivot}>
                    <Save className="w-4 h-4" /> Salvar
                  </button>
                  <button className={BOTAO_PRIMARIO} onClick={() => setPivotAplicado(pivot)}>
                    <Play className="w-4 h-4" /> Executar
                  </button>
                </>
              )}
            </div>
          </Barra>
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}
          {configurando && (
            <div className="flex flex-wrap gap-4 p-4 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
              <BlocoPivot titulo="Linhas" campos={camposSql1} selecionados={pivot.linhas} onChange={(s) => setPivot({ ...pivot, linhas: s })} />
              <BlocoPivot titulo="Colunas" campos={camposSql1} selecionados={pivot.colunas} onChange={(s) => setPivot({ ...pivot, colunas: s })} />
              <BlocoPivot titulo="Valores" campos={camposSql1} selecionados={pivot.metrica} onChange={(s) => setPivot({ ...pivot, metrica: s })} />
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-stone-900 p-4">
            {!cubo ? (
              <p className="text-sm text-stone-500">
                <BarChart3 className="w-4 h-4 inline mr-1" />
                Cubo sem configuração: {nivel <= 'B' ? 'clique em Configurar e escolha linhas, colunas e valores.' : 'peça a um supervisor para configurar.'}
              </p>
            ) : (
              <table className="text-xs border-collapse">
                <thead className="sticky top-0">
                  <tr>
                    {pivotAplicado.linhas.map((l) => (
                      <th key={l} rowSpan={2} className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-left">
                        {l}
                      </th>
                    ))}
                    {cubo.colunas.map((k, i) => (
                      <th key={i} colSpan={pivotAplicado.metrica.length} className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950">
                        {k.length ? k.join(' / ') : 'Valores'}
                      </th>
                    ))}
                    <th colSpan={pivotAplicado.metrica.length} className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900">
                      Total
                    </th>
                  </tr>
                  <tr>
                    {[...cubo.colunas, null].flatMap((_, i) =>
                      pivotAplicado.metrica.map((m) => (
                        <th key={`${i}-${m}`} className="px-2 py-1 border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 font-medium text-stone-500">
                          {m}
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {cubo.linhas.map((l, i) => (
                    <tr key={i} className="hover:bg-stone-50 dark:hover:bg-stone-800/40">
                      {l.chaves.map((c, j) => (
                        <td key={j} className="px-2 py-1 border border-stone-200 dark:border-stone-700">
                          {c}
                        </td>
                      ))}
                      {l.valores.flatMap((v, j) =>
                        v.map((n, k) => (
                          <td key={`${j}-${k}`} className={`px-2 py-1 border border-stone-200 dark:border-stone-700 text-right ${j === l.valores.length - 1 ? 'font-semibold' : ''}`}>
                            {n ? formatarNumero(n, ',0.00') : ''}
                          </td>
                        )),
                      )}
                    </tr>
                  ))}
                  <tr className="font-bold bg-stone-50 dark:bg-stone-950">
                    {pivotAplicado.linhas.map((_, j) => (
                      <td key={j} className="px-2 py-1 border border-stone-200 dark:border-stone-700">
                        {j === 0 ? 'Total' : ''}
                      </td>
                    ))}
                    {cubo.totais.flatMap((v, j) =>
                      v.map((n, k) => (
                        <td key={`${j}-${k}`} className="px-2 py-1 border border-stone-200 dark:border-stone-700 text-right">
                          {formatarNumero(n, ',0.00')}
                        </td>
                      )),
                    )}
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {passo === 'grafico' && atual && sql1 && (
        <>
          <Barra>
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Gráfico - {atual.descricao_resumida}</span>
            <div className="ml-auto flex gap-2">
              <button className={BOTAO_SECUNDARIO} onClick={() => setPasso('resultado')}>
                <ChevronLeft className="w-4 h-4" /> Voltar
              </button>
            </div>
          </Barra>
          <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-stone-900">
            <GraficoLinhas aba={sql1} />
          </div>
        </>
      )}
    </div>
  );
};
