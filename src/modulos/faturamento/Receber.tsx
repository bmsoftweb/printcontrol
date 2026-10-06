import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Download, FileUp, Info, Loader2, Mail, Pencil, Play, RefreshCw, RotateCcw, Save, Trash2, Wallet } from 'lucide-react';
import type { TelaProps } from '../tipos';
import { api, baixarArquivo } from '../../services/api';
import { AvisoErro } from '../../components/AvisoErro';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../../components/MenuAcoes';
import { DateField } from '../../components/DateField';
import { NumberField } from '../../components/NumberField';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../../utils/formStyles';
import { hojeIso } from '../../utils/formatters';
import { BotaoBarra, Grade, Selo, SeloStatusNota, data, dataHora, moeda, type Coluna, type Reg } from './comum';

type Periodo = 'H' | 'S' | 'M' | 'A' | 'T' | 'P';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Período do filtro de vencimento (Hoje / Semana seg..dom / Mês / Ano / Todos) */
export function periodo(p: Periodo, hoje = hojeIso()): [string, string] {
  const [a, m, d] = hoje.split('-').map(Number);
  const h = new Date(a, m - 1, d);
  switch (p) {
    case 'H':
      return [hoje, hoje];
    case 'S': {
      const seg = new Date(a, m - 1, d - ((h.getDay() + 6) % 7));
      return [iso(seg), iso(new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() + 6))];
    }
    case 'M':
      return [iso(new Date(a, m - 1, 1)), iso(new Date(a, m, 0))];
    case 'A':
      return [`${a}-01-01`, `${a}-12-31`];
    default:
      return ['1902-01-01', '2099-12-31'];
  }
}

/** Painel Recebimento: baixa manual (ou consulta dos dados da baixa) */
const Recebimento: React.FC<{ titulo: Reg; consulta: boolean; onFechar: () => void; onBaixado: () => void }> = ({ titulo, consulta, onFechar, onBaixado }) => {
  const [f, setF] = useState(() =>
    consulta
      ? { juros: String(titulo.total_recebido_juros ?? 0), descontos: String(titulo.total_recebido_descontos ?? 0), recebido: String(titulo.total_recebido ?? 0), data_baixa: String(titulo.data_baixa ?? '').slice(0, 10), obs: titulo.obs_baixa ?? '' }
      : { juros: '0', descontos: '0', recebido: String(titulo.total_liquido ?? 0), data_baixa: hojeIso(), obs: '' },
  );
  const [confirmar, setConfirmar] = useState(false);
  // Valor recebido acompanha principal + juros − desconto até o operador digitar outro
  const mudar = (k: 'juros' | 'descontos', v: string) =>
    setF((x) => {
      const n = { ...x, [k]: v };
      return { ...n, recebido: (Number(titulo.total_liquido) + Number(n.juros || 0) - Number(n.descontos || 0)).toFixed(2) };
    });
  return (
    <Janela
      titulo="Recebimento"
      subtitulo={`${titulo.nome} — NF ${titulo.serie}/${titulo.numero} — venc. ${data(titulo.data_vencimento)}`}
      onFechar={onFechar}
      largura="max-w-lg"
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>
            {consulta ? 'Fechar' : 'Cancelar'}
          </button>
          {!consulta && (
            <button type="button" className={BOTAO_PRIMARIO} onClick={() => setConfirmar(true)} disabled={!f.data_baixa}>
              <Wallet className="w-4 h-4" /> Baixar
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Valor A Receber</span>
          <NumberField value={titulo.total_liquido} onChange={() => {}} scale={2} disabled className={`${INPUT_CLASS} w-full`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Data Receb.</span>
          {consulta ? <input className={`${INPUT_CLASS} w-full`} value={data(f.data_baixa)} readOnly /> : <DateField value={f.data_baixa} onChange={(v) => setF({ ...f, data_baixa: v })} required className="w-full" />}
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Juros</span>
          <NumberField value={f.juros} onChange={(v) => mudar('juros', v)} scale={2} disabled={consulta} className={`${INPUT_CLASS} w-full`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Desc.</span>
          <NumberField value={f.descontos} onChange={(v) => mudar('descontos', v)} scale={2} disabled={consulta} className={`${INPUT_CLASS} w-full`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Valor Recebido</span>
          <NumberField value={f.recebido} onChange={(v) => setF({ ...f, recebido: v })} scale={2} disabled={consulta} required className={`${INPUT_CLASS} w-full`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Tipo de baixa</span>
          <input className={`${INPUT_CLASS} w-full`} readOnly value={consulta ? (titulo.tipo_baixa === 'A' ? 'Automática (retorno)' : titulo.tipo_baixa === 'M' ? 'Manual' : '') : 'Manual'} />
        </label>
        <label className={`${FIELD_CLASS} col-span-2`}>
          <span className={LABEL_CLASS}>Observação</span>
          <input className={`${INPUT_CLASS} w-full`} maxLength={255} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} readOnly={consulta} />
        </label>
        {consulta && titulo.datahora_baixa && <p className="col-span-2 text-[11px] text-stone-500">Baixado em {dataHora(titulo.datahora_baixa)}</p>}
      </div>
      {confirmar && (
        <ConfirmDialog
          titulo="Baixar título"
          tom="normal"
          confirmar="Baixar"
          mensagem={`Confirma baixar? R$ ${moeda(f.recebido)} em ${data(f.data_baixa)}.`}
          onConfirmar={async () => {
            await api.post(`/api/financeiro/titulos/${titulo.id}/baixar`, f);
            onBaixado();
          }}
          onCancelar={() => setConfirmar(false)}
        />
      )}
    </Janela>
  );
};

/** Página "Processar Retorno" (CNAB 240) */
const Retorno: React.FC<{ onVoltar: () => void; onToast: (m: string) => void }> = ({ onVoltar, onToast }) => {
  const [bancos, setBancos] = useState<Reg[]>([]);
  const [banco, setBanco] = useState('');
  const [arquivo, setArquivo] = useState<{ nome: string; conteudo: string } | null>(null);
  const [registros, setRegistros] = useState<Reg[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Reg[]>('/api/financeiro/bancos').then(setBancos).catch((e) => setErro(e.message));
  }, []);

  const ler = async (b: string, a: typeof arquivo) => {
    if (!b || !a) return;
    setOcupado('ler');
    setErro(null);
    try {
      setRegistros(await api.post('/api/financeiro/retorno/ler', { id_banco: Number(b), nome: a.nome, conteudo: a.conteudo }));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const enviar = async (f: File | undefined) => {
    if (!f) return;
    // Retorno é texto ANSI (Latin-1), como gravado pelos bancos
    const a = { nome: f.name, conteudo: new TextDecoder('latin1').decode(await f.arrayBuffer()) };
    setArquivo(a);
    if (input.current) input.current.value = '';
    ler(banco, a);
  };

  const processar = async () => {
    const r: Reg[] = await api.post('/api/financeiro/retorno/processar', { id_banco: Number(banco), nome: arquivo!.nome, conteudo: arquivo!.conteudo });
    setRegistros(r);
    setConfirmar(false);
    onToast(`Retorno processado: ${r.filter((x) => x.obs === 'BAIXADO!').length} título(s) baixado(s).`);
  };

  const v = (k: string, titulo: string, grupo: string, soma = false): Coluna => ({
    chave: k,
    titulo,
    grupo,
    alinhar: 'dir',
    render: (r) => moeda(r[k]),
    rodape: soma ? `R$ ${moeda(registros.reduce((s, r) => s + Number(r[k] || 0), 0))}` : undefined,
  });
  const colunas: Coluna[] = [
    { chave: 'status', titulo: 'Status', grupo: 'Processamento', alinhar: 'centro', render: (r) => (r.status === 'P' ? <Selo cor="#FFD700" texto="PROCESSADO" escuro /> : <Selo cor="#2E8B57" texto="A PROCESSAR" />) },
    { chave: 'baixar', titulo: 'Baixar', grupo: 'Processamento', alinhar: 'centro', render: (r) => (r.baixar === 'S' ? <Selo cor="#2E8B57" texto="SIM" /> : r.baixar === 'E' ? <Selo cor="#FF6347" texto="ERRO" /> : <Selo cor="#E5E5E5" texto="NÃO" escuro />) },
    { chave: 'obs', titulo: 'Obs.', grupo: 'Processamento' },
    { chave: 'ocorrencia', titulo: 'Código', grupo: 'Ocorrência', alinhar: 'centro' },
    { chave: 'ocorrenciaDescricao', titulo: 'Descrição', grupo: 'Ocorrência' },
    { chave: 'nomePagador', titulo: 'Cliente', grupo: 'Título', fixa: true },
    { chave: 'cnpj', titulo: 'CNPJ', grupo: 'Título' },
    v('valorPago', 'Valor Pago', 'Título', true),
    { chave: 'nossoNumero', titulo: 'Nosso Nr.', grupo: 'Título' },
    { chave: 'dataVencimento', titulo: 'Vencto.', grupo: 'Datas', alinhar: 'centro', render: (r) => data(r.dataVencimento) },
    { chave: 'dataOcorrencia', titulo: 'Ocorrência', grupo: 'Datas', alinhar: 'centro', render: (r) => data(r.dataOcorrencia) },
    { chave: 'dataCredito', titulo: 'Data Crédito', grupo: 'Datas', alinhar: 'centro', render: (r) => data(r.dataCredito) },
    v('valorNominal', 'Vlr. Nominal', 'Valores'),
    v('valorJuros', 'Vlr. Juros', 'Valores'),
    v('valorDescontos', 'Vlr. Descontos', 'Valores'),
    v('valorAbatimento', 'Vlr. Abatimentos', 'Valores'),
    v('valorCreditado', 'Vlr. Creditado', 'Valores'),
    v('valorOutrasDespesas', 'Vlr. Outras Desp.', 'Valores'),
    v('valorOutrosCreditos', 'Vlr. Outros Créd.', 'Valores'),
    { chave: 'idNota', titulo: 'ID/Fatur_notas', grupo: 'Identificação', alinhar: 'dir' },
    { chave: 'ident', titulo: 'Identificação', grupo: 'Identificação' },
    ...[0, 1, 2, 3, 4].map((i): Coluna => ({ chave: `erro${i}`, titulo: `Erro ${i + 1}`, grupo: 'Erros', render: (r) => (r.erros?.[i] ? `${r.erros[i].codigo} ${r.erros[i].descricao}` : '') })),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <BotaoBarra icone={ArrowLeft} texto="Voltar" onClick={onVoltar} />
        <span className={`${LABEL_CLASS} ml-2`}>Layout:</span>
        <select
          className={`${INPUT_CLASS} w-56`}
          value={banco}
          required
          onChange={(e) => {
            setBanco(e.target.value);
            ler(e.target.value, arquivo);
          }}
        >
          <option value="">— Escolha o banco —</option>
          {bancos.map((b) => (
            <option key={b.id} value={b.id}>
              {b.apelido} {b.cod_banco ? `(${b.cod_banco})` : ''}
            </option>
          ))}
        </select>
        <input ref={input} type="file" className="hidden" accept=".ret,.txt,.RET,.TXT" onChange={(e) => enviar(e.target.files?.[0])} />
        <BotaoBarra icone={FileUp} texto="Baixar Retorno" onClick={() => (banco ? input.current?.click() : setErro('Escolha um layout'))} carregando={ocupado === 'ler'} titulo="Envia o arquivo de retorno do banco" />
        <BotaoBarra icone={Play} texto="Processar Retorno" onClick={() => setConfirmar(true)} disabled={!registros.length || registros.every((r) => r.status === 'P')} />
        {arquivo && <span className="text-[11px] text-stone-500">{arquivo.nome} — {registros.length} título(s)</span>}
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3 shrink-0" />}
      <Grade nome="receber.retorno" onToast={onToast} chave="linha" colunas={colunas} linhas={registros.map((r, i) => ({ ...r, linha: i }))} vazio="Escolha o banco e envie o arquivo de retorno." />
      {confirmar && (
        <ConfirmDialog
          titulo="Processar retorno"
          tom="normal"
          confirmar="Processar"
          mensagem={`Baixar ${registros.filter((r) => r.baixar === 'S' && r.encontrado).length} título(s) liquidado(s) e atualizar a ocorrência dos demais?`}
          onConfirmar={processar}
          onCancelar={() => setConfirmar(false)}
        />
      )}
    </div>
  );
};

/** Tela Financeiro / Contas a Receber (ufrmReceber) */
export const TelaReceber: React.FC<TelaProps> = ({ onToast, refreshToken, empresa }) => {
  const [status, setStatus] = useState<'A' | 'R' | 'T'>('A');
  const [nome, setNome] = useState('');
  const [per, setPer] = useState<Periodo>('T');
  const [d1, setD1] = useState('2001-01-01');
  const [d2, setD2] = useState('2099-12-31');
  const [ordem, setOrdem] = useState<'V' | 'N' | 'R'>('V');
  const [linhas, setLinhas] = useState<Reg[]>([]);
  const [sel, setSel] = useState<Reg | null>(null);
  const [clientes, setClientes] = useState<{ id: number; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pagina, setPagina] = useState<'lista' | 'retorno'>('lista');
  const [baixa, setBaixa] = useState<{ titulo: Reg; consulta: boolean } | null>(null);
  const [estornar, setEstornar] = useState<Reg | null>(null);
  const [excluir, setExcluir] = useState<Reg | null>(null);
  const [vencto, setVencto] = useState<{ titulo: Reg; data: string } | null>(null);

  const qs = useMemo(() => new URLSearchParams({ status, nome, d1, d2, ordem }).toString(), [status, nome, d1, d2, ordem]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const l: Reg[] = await api.get(`/api/financeiro/titulos?${qs}`);
      setLinhas(l);
      setSel((s) => l.find((x) => x.id === s?.id) ?? null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [qs]);

  useEffect(() => {
    const t = setTimeout(carregar, 300); // o nome recarrega enquanto digita
    return () => clearTimeout(t);
  }, [carregar, refreshToken]);

  useEffect(() => {
    api.get('/api/faturamento/opcoes').then((o) => setClientes(o.clientes)).catch(() => {});
  }, []);

  const mudarPeriodo = (p: Periodo) => {
    setPer(p);
    if (p !== 'P') {
      const [a, b] = periodo(p);
      setD1(a);
      setD2(b);
    }
  };

  const acao = async (n: string, fn: () => Promise<unknown>) => {
    setOcupado(n);
    setErro(null);
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const reenviar = (t: Reg) =>
    acao('reenviar', async () => {
      if (!t.boleto_codigo_barras) throw new Error('Boleto ainda não emitido!');
      const r = await api.post(`/api/financeiro/titulos/${t.id}/reenviar-boleto`);
      onToast(`Boleto reenviado para ${r.para}.`);
      carregar();
    });

  const ordenar = (o: 'V' | 'N' | 'R') => () => setOrdem(o);
  const total = linhas.reduce((s, r) => s + Number(r.total_liquido || 0), 0);
  const colunas: Coluna[] = [
    {
      chave: 'baixar',
      titulo: '',
      rotulo: 'Baixar / Estornar',
      alinhar: 'centro',
      render: (r) =>
        r.status === 'A' ? (
          <button type="button" className="px-2 py-0.5 rounded text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 cursor-pointer" onClick={(e) => (e.stopPropagation(), setBaixa({ titulo: r, consulta: false }))}>
            Baixar
          </button>
        ) : (
          <button type="button" className="px-2 py-0.5 rounded text-[11px] font-semibold text-stone-700 bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-100 cursor-pointer" onClick={(e) => (e.stopPropagation(), setEstornar(r))}>
            Estornar
          </button>
        ),
    },
    { chave: 'empresa_apelido', titulo: 'Empresa' },
    { chave: 'status', titulo: 'Status', alinhar: 'centro', render: (r) => <SeloStatusNota status={r.status} atraso={r.atraso} /> },
    { chave: 'id_cliente', titulo: 'ID/Cliente', alinhar: 'dir' },
    { chave: 'nome', titulo: 'Nome', fixa: true, aoClicarTitulo: ordenar('N'), ordenada: ordem === 'N' ? 'asc' : null },
    { chave: 'data_vencimento', titulo: 'Data Vencto.', alinhar: 'centro', aoClicarTitulo: ordenar('V'), ordenada: ordem === 'V' ? 'asc' : null, render: (r) => data(r.data_vencimento) },
    { chave: 'data_baixa', titulo: 'Data Recbto.', alinhar: 'centro', aoClicarTitulo: ordenar('R'), ordenada: ordem === 'R' ? 'asc' : null, render: (r) => data(r.data_baixa) },
    { chave: 'total_liquido', titulo: 'Total NF', alinhar: 'dir', render: (r) => `R$ ${moeda(r.total_liquido)}`, rodape: `R$ ${moeda(total)}` },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Nr. NF', alinhar: 'dir' },
    { chave: 'data_nota', titulo: 'Data NF', alinhar: 'centro', render: (r) => data(r.data_nota) },
    { chave: 'banco_apelido', titulo: 'Banco' },
    { chave: 'datahora_baixa', titulo: 'Recebido em:', alinhar: 'centro', render: (r) => dataHora(r.datahora_baixa) },
    { chave: 'plano_descricao', titulo: 'Plano' },
    { chave: 'boleto_enviado', titulo: 'Boleto Enviado', alinhar: 'centro' },
    { chave: 'boleto_nosso_numero', titulo: 'Boleto Nosso Nr.' },
    { chave: 'boleto_nosso_numero_dig', titulo: 'Boleto Dig', alinhar: 'centro' },
    { chave: 'boleto_linha_digitavel', titulo: 'Boleto Linha Digitável', render: (r) => <span className="font-mono">{r.boleto_linha_digitavel}</span> },
    { chave: 'ultima_obs_retorno', titulo: 'Obs. Retorno' },
    { chave: 'id', titulo: 'Id#', alinhar: 'dir' },
  ];

  if (pagina === 'retorno') return <Retorno onVoltar={() => (setPagina('lista'), carregar())} onToast={onToast} />;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 flex flex-wrap items-end gap-2 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Status</span>
          <select className={`${INPUT_CLASS} w-32`} value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="A">Em Aberto</option>
            <option value="R">Recebidos</option>
            <option value="T">Todos</option>
          </select>
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Cliente (começa com)</span>
          <input className={`${INPUT_CLASS} w-56`} value={nome} onChange={(e) => setNome(e.target.value)} list="fat-clientes" placeholder="Nome ou fantasia" />
          <datalist id="fat-clientes">
            {clientes.map((c) => (
              <option key={c.id} value={c.nome} />
            ))}
          </datalist>
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Vencimento</span>
          <select className={`${INPUT_CLASS} w-36`} value={per} onChange={(e) => mudarPeriodo(e.target.value as Periodo)}>
            <option value="H">Hoje</option>
            <option value="S">Semana</option>
            <option value="M">Mês</option>
            <option value="A">Ano</option>
            <option value="T">Todos</option>
            <option value="P">Personalizado</option>
          </select>
        </label>
        {per === 'P' ? (
          <>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>De</span>
              <DateField value={d1} onChange={setD1} className="w-36" />
            </label>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Até</span>
              <DateField value={d2} onChange={setD2} className="w-36" />
            </label>
          </>
        ) : (
          <BotaoBarra icone={CalendarDays} texto="" titulo="Período personalizado" onClick={() => setPer('P')} />
        )}
        <div className="flex-1" />
        <BotaoBarra icone={RefreshCw} texto="Atualizar" onClick={carregar} carregando={carregando} />
        <BotaoBarra icone={Mail} texto="Reenviar Boleto" onClick={() => (sel ? reenviar(sel) : setErro('Escolha um título.'))} carregando={ocupado === 'reenviar'} />
        <BotaoBarra icone={Download} texto="Exportar" onClick={() => acao('exportar', () => baixarArquivo(`/api/financeiro/exportar?${qs}`, 'contas_a_receber.txt'))} carregando={ocupado === 'exportar'} />
        <BotaoBarra icone={FileUp} texto="Processar Retorno" onClick={() => setPagina('retorno')} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3 shrink-0" />}
      <Grade
        nome="receber.titulos"
        onToast={onToast}
        colunas={colunas}
        linhas={linhas}
        selecionado={sel?.id}
        onSelecionar={setSel}
        onDuploClique={(r, c) => c === 'data_vencimento' && r.status === 'A' && setVencto({ titulo: r, data: String(r.data_vencimento).slice(0, 10) })}
        riscada={(r) => r.cancelado === 'S'}
        carregando={carregando && !linhas.length}
        vazio="Nenhum título neste filtro."
        acoes={(r) => (
          <MenuAcoes>
            <BotaoAcao icone={Info} titulo="Dados da baixa" descricao="Consulta o recebimento" onClick={() => setBaixa({ titulo: r, consulta: true })} />
            {r.status === 'A' ? (
              <BotaoAcao icone={Wallet} titulo="Baixar" descricao="Baixa manual" tom="verde" onClick={() => setBaixa({ titulo: r, consulta: false })} />
            ) : (
              <BotaoAcao icone={RotateCcw} titulo="Estornar" descricao="Desfaz a baixa" onClick={() => setEstornar(r)} />
            )}
            <BotaoAcao icone={Mail} titulo="Reenviar boleto" descricao="Envia a NF com o boleto por e-mail" onClick={() => reenviar(r)} />
            <SeparadorAcoes />
            {r.status === 'A' && <BotaoAcao icone={Pencil} titulo="Alterar vencimento" descricao="Muda a data de vencimento" onClick={() => setVencto({ titulo: r, data: String(r.data_vencimento).slice(0, 10) })} />}
            {r.status === 'A' && <BotaoAcao icone={Trash2} titulo="Excluir" descricao="Exclui o título" tom="perigo" onClick={() => setExcluir(r)} />}
          </MenuAcoes>
        )}
      />
      <div className="px-4 py-1.5 border-t border-stone-200 dark:border-stone-800 text-[11px] text-stone-500 shrink-0">
        {linhas.length} título(s) de todas as empresas do grupo {empresa.grupoNome || empresa.grupoApelido}
      </div>

      {baixa && (
        <Recebimento
          titulo={baixa.titulo}
          consulta={baixa.consulta}
          onFechar={() => setBaixa(null)}
          onBaixado={() => {
            setBaixa(null);
            onToast('Título baixado.');
            carregar();
          }}
        />
      )}
      {estornar && (
        <ConfirmDialog
          titulo="Estornar baixa"
          confirmar="Estornar"
          mensagem={`Confirma estornar? ${estornar.nome} — NF ${estornar.numero} — recebido R$ ${moeda(estornar.total_recebido)} em ${data(estornar.data_baixa)}.`}
          onConfirmar={async () => {
            await api.post(`/api/financeiro/titulos/${estornar.id}/estornar`);
            setEstornar(null);
            onToast('Baixa estornada.');
            carregar();
          }}
          onCancelar={() => setEstornar(null)}
        />
      )}
      {excluir && (
        <ConfirmDialog
          titulo="Excluir título"
          mensagem={
            <>
              Excluir a NF {excluir.serie}/{excluir.numero} de {excluir.nome} (R$ {moeda(excluir.total_liquido)})? A nota e os produtos dela são apagados.
              {excluir.boleto_codigo_barras && (
                <span className="block mt-2 font-semibold text-rose-700 dark:text-rose-400">
                  Atenção: esta nota tem boleto gerado{excluir.boleto_enviado === 'S' ? ' e já enviado ao banco na remessa — peça a baixa do título no banco' : ''}.
                </span>
              )}
            </>
          }
          onConfirmar={async () => {
            await api.delete(`/api/financeiro/titulos/${excluir.id}${excluir.boleto_codigo_barras ? '?ciente=1' : ''}`);
            setExcluir(null);
            onToast('Título excluído.');
            carregar();
          }}
          onCancelar={() => setExcluir(null)}
        />
      )}
      {vencto && (
        <Janela
          titulo="Alterar vencimento"
          subtitulo={`${vencto.titulo.nome} — NF ${vencto.titulo.numero}`}
          onFechar={() => setVencto(null)}
          largura="max-w-sm"
          rodape={
            <>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setVencto(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={BOTAO_PRIMARIO}
                disabled={ocupado === 'vencto' || !vencto.data}
                onClick={() =>
                  acao('vencto', async () => {
                    await api.put(`/api/faturamento/notas/${vencto.titulo.id}`, { data_vencimento: vencto.data });
                    setVencto(null);
                    onToast('Vencimento alterado.');
                    carregar();
                  })
                }
              >
                {ocupado === 'vencto' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Gravar
              </button>
            </>
          }
        >
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
          <label className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Data Vencto.</span>
            <DateField value={vencto.data} onChange={(v) => setVencto({ ...vencto, data: v })} required className="w-full" />
          </label>
          {vencto.titulo.boleto_codigo_barras && <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">O boleto gerado é limpo (o código de barras traz o vencimento).</p>}
        </Janela>
      )}
    </div>
  );
};
