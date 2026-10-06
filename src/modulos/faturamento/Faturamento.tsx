import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Barcode, ChevronDown, Eraser, FileDown, FileText, ListChecks, Loader2, Mail, Pencil, Printer, RefreshCw, Save, Sparkles } from 'lucide-react';
import type { TelaProps } from '../tipos';
import { api } from '../../services/api';
import { AvisoErro } from '../../components/AvisoErro';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { BotaoAcao, MenuAcoes, SeparadorAcoes } from '../../components/MenuAcoes';
import { DateField } from '../../components/DateField';
import { NumberField } from '../../components/NumberField';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../../utils/formStyles';
import { Grade, Selo, SeloStatusNota, TituloPainel, BotaoBarra, abrirPdf, baixarPost, data, dataHora, inteiro, moeda, type Coluna, type Reg } from './comum';
import { PreFaturamento } from './PreFaturamento';

export interface Opcoes {
  bancos: { id: number; apelido: string; cod_banco: string }[];
  planos: { id: string; descricao: string }[];
  clientes: { id: number; nome: string }[];
}

/** Editar nota: vencimento, total, banco e plano (navegador Editar/Gravar do Delphi) */
const EditarNota: React.FC<{ nota: Reg; opcoes: Opcoes | null; onFechar: () => void; onGravado: () => void }> = ({ nota, opcoes, onFechar, onGravado }) => {
  const [f, setF] = useState({ data_vencimento: String(nota.data_vencimento ?? '').slice(0, 10), total_liquido: String(nota.total_liquido ?? ''), id_banco: String(nota.id_banco ?? ''), id_plano: String(nota.id_plano ?? '').trim() });
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const temBoleto = Boolean(nota.boleto_codigo_barras);
  const gravar = async () => {
    setGravando(true);
    setErro(null);
    try {
      await api.put(`/api/faturamento/notas/${nota.id}`, { ...f, id_banco: Number(f.id_banco) || 0 });
      onGravado();
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };
  return (
    <Janela
      titulo={`Nota ${nota.serie}/${nota.numero}`}
      subtitulo={nota.nome}
      onFechar={onFechar}
      ocupado={gravando}
      largura="max-w-xl"
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={gravar} disabled={gravando}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="grid grid-cols-2 gap-3">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Data Vencto.</span>
          <DateField value={f.data_vencimento} onChange={(v) => setF({ ...f, data_vencimento: v })} required className="w-full" />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Total NF</span>
          <NumberField value={f.total_liquido} onChange={(v) => setF({ ...f, total_liquido: v })} scale={2} required className={`${INPUT_CLASS} w-full`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Banco</span>
          <select className={`${INPUT_CLASS} w-full`} value={f.id_banco} onChange={(e) => setF({ ...f, id_banco: e.target.value })}>
            <option value="0">— Nenhum —</option>
            {opcoes?.bancos.map((b) => (
              <option key={b.id} value={b.id}>
                {b.apelido} {b.cod_banco ? `(${b.cod_banco})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Plano</span>
          <select className={`${INPUT_CLASS} w-full`} value={f.id_plano} onChange={(e) => setF({ ...f, id_plano: e.target.value })}>
            <option value="">— Nenhum —</option>
            {opcoes?.planos.map((p) => (
              <option key={p.id} value={String(p.id).trim()}>
                {p.descricao}
              </option>
            ))}
          </select>
        </label>
        <label className={`${FIELD_CLASS} col-span-2`}>
          <span className={LABEL_CLASS}>E-Mail</span>
          <input className={`${INPUT_CLASS} w-full`} value={nota.email ?? ''} readOnly />
          <span className={HINT_CLASS}>O e-mail vem do cadastro do cliente: altere lá.</span>
        </label>
      </div>
      {temBoleto && (
        <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
          Esta nota tem boleto gerado: trocar o banco, o valor ou o vencimento limpa os dados do boleto
          {nota.boleto_enviado === 'S' ? ' (valor e vencimento não podem mudar: o boleto já foi na remessa).' : '.'}
        </p>
      )}
    </Janela>
  );
};

/** Tela Faturamento (ufrmFatur): faturamentos × notas × produtos, pré-faturamento, NF, boleto, e-mail e remessa */
export const TelaFaturamento: React.FC<TelaProps> = ({ onToast, refreshToken }) => {
  const [faturs, setFaturs] = useState<Reg[]>([]);
  const [fatur, setFatur] = useState<Reg | null>(null);
  const [tudo, setTudo] = useState(false);
  const [notas, setNotas] = useState<Reg[]>([]);
  const [nota, setNota] = useState<Reg | null>(null);
  const [produtos, setProdutos] = useState<Reg[]>([]);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [pre, setPre] = useState(false);
  const [editar, setEditar] = useState<Reg | null>(null);
  const [confirmar, setConfirmar] = useState<{ tipo: 'cancelar' | 'limpar' | 'remessa'; nota: Reg } | null>(null);
  const [editRef, setEditRef] = useState<{ id: number; obs: string } | null>(null);
  const [opcoesAberto, setOpcoesAberto] = useState(false);
  const notaIdRef = useRef<number | null>(null);
  notaIdRef.current = nota?.id ?? null;
  const faturIdRef = useRef<number | null>(null);
  faturIdRef.current = fatur?.id ?? null;

  const carregarNotas = useCallback(async (f: Reg | null, listarTudo: boolean) => {
    if (!f && !listarTudo) return setNotas([]);
    const lista: Reg[] = await api.get(`/api/faturamento/notas?${listarTudo ? 'tudo=1' : `fatur=${f!.id}`}`);
    setNotas(lista);
    setNota((atual) => lista.find((n) => n.id === (notaIdRef.current ?? atual?.id)) ?? lista[0] ?? null);
  }, []);

  /** Atualizar: recarrega tudo e volta ao faturamento/nota que estavam selecionados */
  const atualizar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [lista, op] = await Promise.all([api.get<Reg[]>('/api/faturamento/fatur'), api.get<Opcoes>('/api/faturamento/opcoes')]);
      setFaturs(lista);
      setOpcoes(op);
      const atual = lista.find((x) => x.id === faturIdRef.current) ?? lista[0] ?? null;
      setFatur(atual);
      await carregarNotas(atual, tudo);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [carregarNotas, tudo]);

  useEffect(() => {
    atualizar();
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nota) return setProdutos([]);
    api.get<Reg[]>(`/api/faturamento/notas/${nota.id}/produtos`).then(setProdutos).catch((e) => setErro(e.message));
  }, [nota?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolherFatur = async (f: Reg) => {
    setFatur(f);
    setTudo(false);
    notaIdRef.current = null;
    try {
      await carregarNotas(f, false);
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const listarTudo = async () => {
    setTudo(true);
    setCarregando(true);
    try {
      await carregarNotas(null, true);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  /** Executa uma ação sobre a nota e recarrega as notas */
  const acao = async (nome: string, fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(nome);
    setErro(null);
    try {
      await fn();
      if (ok) onToast(ok);
      await carregarNotas(fatur, tudo);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const exigirNota = (fn: (n: Reg) => void) => () => (nota ? fn(nota) : setErro('Escolha uma nota.'));
  const imprimir = (n: Reg) => acao('imprimir', () => abrirPdf(`/api/faturamento/notas/${n.id}/nf.pdf`));
  const gerarBoleto = (n: Reg) =>
    n.boleto_codigo_barras ? onToast('A nota já tem boleto.') : acao('boleto', () => api.post(`/api/faturamento/notas/${n.id}/boleto`), `Boleto da NF ${n.numero} gerado.`);
  const enviarEmail = (n: Reg) => acao('email', async () => onToast(`NF ${n.numero} enviada para ${(await api.post(`/api/faturamento/notas/${n.id}/email`)).para}.`));
  const remessa = (n: Reg) =>
    acao('remessa', async () => {
      const h = await baixarPost('/api/faturamento/remessa', { nota: n.id, tudo }, 'remessa.txt');
      const sem = Number(h.get('X-Sem-Boleto') || 0);
      onToast(`Remessa com ${h.get('X-Titulos')} título(s) gerada.${sem ? ` ${sem} nota(s) sem boleto ficaram de fora.` : ''}`);
    });

  const gravarRef = async () => {
    if (!editRef) return;
    const r = editRef;
    setEditRef(null);
    try {
      await api.put(`/api/faturamento/fatur/${r.id}`, { obs: r.obs });
      setFaturs((l) => l.map((f) => (f.id === r.id ? { ...f, obs: r.obs } : f)));
    } catch (e: any) {
      setErro(e.message);
    }
  };

  const colunasNotas: Coluna[] = [
    { chave: 'cancelado', titulo: '', classe: (r) => (r.cancelado === 'S' ? 'bg-rose-600' : ''), render: () => null, largura: 'w-2' },
    { chave: 'status', titulo: 'Status', alinhar: 'centro', render: (r) => <SeloStatusNota status={r.status} /> },
    { chave: 'id_cliente', titulo: 'ID/Cliente', alinhar: 'dir' },
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'email', titulo: 'E-Mail' },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Nr. NF', alinhar: 'dir' },
    { chave: 'data_nota', titulo: 'Data NF', alinhar: 'centro', render: (r) => data(r.data_nota) },
    { chave: 'data_vencimento', titulo: 'Data Vencto.', alinhar: 'centro', render: (r) => data(r.data_vencimento) },
    { chave: 'total_liquido', titulo: 'Total NF', alinhar: 'dir', render: (r) => `R$ ${moeda(r.total_liquido)}`, rodape: `R$ ${moeda(notas.filter((n) => n.cancelado !== 'S').reduce((s, n) => s + Number(n.total_liquido || 0), 0))}` },
    { chave: 'banco_apelido', titulo: 'Banco' },
    { chave: 'plano_descricao', titulo: 'Plano' },
    { chave: 'status_email', titulo: 'e-Mail Status', alinhar: 'centro', render: (r) => (r.status_email === 'E' ? <Selo cor="#2E8B57" texto="ENVIADO" /> : null) },
    { chave: 'datahora_email', titulo: 'e-Mail enviado em:', alinhar: 'centro', render: (r) => dataHora(r.datahora_email) },
    { chave: 'boleto_enviado', titulo: 'Remessa', alinhar: 'centro', render: (r) => (r.boleto_enviado === 'S' ? <span title="Duplo clique: reenviar na próxima remessa"><Selo cor="#2E8B57" texto="ENVIADO" /></span> : null) },
    { chave: 'boleto_nosso_numero', titulo: 'Boleto Nosso Nr.' },
    { chave: 'boleto_nosso_numero_dig', titulo: 'Boleto Dig', alinhar: 'centro' },
    { chave: 'boleto_linha_digitavel', titulo: 'Boleto Linha Digitável', render: (r) => <span className="font-mono">{r.boleto_linha_digitavel}</span> },
    { chave: 'obs_nf', titulo: 'Observação para NF' },
  ];

  const colunasProdutos: Coluna[] = [
    { chave: 'id_equip', titulo: 'ID', alinhar: 'dir' },
    { chave: 'descricao', titulo: 'Equipamento' },
    { chave: 'nr_serie', titulo: 'Série' },
    { chave: 'setor', titulo: 'Setor' },
    { chave: 'leitura_anterior', titulo: 'Leitura Anterior', alinhar: 'dir', render: (r) => inteiro(r.leitura_anterior) },
    { chave: 'leitura_atual', titulo: 'Leitura Atual', alinhar: 'dir', render: (r) => inteiro(r.leitura_atual) },
    { chave: 'nr_copias', titulo: 'Nr. Cópias', alinhar: 'dir', render: (r) => inteiro(r.nr_copias) },
    { chave: 'nr_copias_contrato', titulo: 'Nr. Cópias Contrato', alinhar: 'dir', render: (r) => inteiro(r.nr_copias_contrato) },
    { chave: 'nr_copias_exced', titulo: 'Nr. Cópias Exced.', alinhar: 'dir', render: (r) => inteiro(r.nr_copias_exced) },
    { chave: 'valor_unit_copia', titulo: 'Vlr. Unit Cópia', alinhar: 'dir', render: (r) => `R$ ${moeda(r.valor_unit_copia)}` },
    { chave: 'valor_unit_exced', titulo: 'Vlr. Unit Exced.', alinhar: 'dir', render: (r) => `R$ ${moeda(r.valor_unit_exced)}` },
    { chave: 'valor_total_contrato', titulo: 'Vlr. Total Contrato', alinhar: 'dir', render: (r) => `R$ ${moeda(r.valor_total_contrato)}` },
    { chave: 'valor_total_exced', titulo: 'Vlr. Total Exced.', alinhar: 'dir', render: (r) => `R$ ${moeda(r.valor_total_exced)}` },
    { chave: 'valor_liquido', titulo: 'Valor NF', alinhar: 'dir', render: (r) => `R$ ${moeda(r.valor_liquido)}`, rodape: `R$ ${moeda(produtos.reduce((s, p) => s + Number(p.valor_liquido || 0), 0))}` },
  ];

  const acoesNota = (n: Reg) => (
    <MenuAcoes>
      <BotaoAcao icone={Printer} titulo="Imprimir NF" descricao="Nota de débito em PDF" onClick={() => imprimir(n)} />
      <BotaoAcao icone={Barcode} titulo="Gerar Boleto" descricao="Gera o boleto da nota" onClick={() => gerarBoleto(n)} />
      <BotaoAcao icone={Mail} titulo="Enviar por e-mail" descricao="Envia a NF ao cliente" onClick={() => enviarEmail(n)} />
      <BotaoAcao icone={Eraser} titulo="Limpar dados do boleto" descricao="Apaga código de barras e nosso número" onClick={() => setConfirmar({ tipo: 'limpar', nota: n })} />
      {n.boleto_enviado === 'S' && <BotaoAcao icone={RefreshCw} titulo="Reenviar na remessa" descricao="Marca como não enviada" onClick={() => setConfirmar({ tipo: 'remessa', nota: n })} />}
      <SeparadorAcoes />
      <BotaoAcao icone={Pencil} titulo="Editar" descricao="Vencimento, total, banco e plano" onClick={() => setEditar(n)} />
      <BotaoAcao icone={Ban} titulo="Cancelar NF" descricao="Cancela a nota" tom="perigo" onClick={() => setConfirmar({ tipo: 'cancelar', nota: n })} />
    </MenuAcoes>
  );

  const executarConfirmacao = async () => {
    const c = confirmar!;
    if (c.tipo === 'cancelar') {
      const r = await api.post(`/api/faturamento/notas/${c.nota.id}/cancelar`, { ciente: c.nota.boleto_enviado === 'S' });
      onToast(r.aviso || `NF ${c.nota.numero} cancelada.`);
    } else if (c.tipo === 'limpar') {
      await api.post(`/api/faturamento/notas/${c.nota.id}/limpar-boleto`);
      onToast('Dados do boleto limpos.');
    } else {
      await api.post(`/api/faturamento/notas/${c.nota.id}/reenviar-remessa`);
      onToast('A nota vai na próxima remessa.');
    }
    setConfirmar(null);
    await carregarNotas(fatur, tudo);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-stone-200 dark:border-stone-800 shrink-0">
        <BotaoBarra icone={Sparkles} texto="Pré-Faturamento" onClick={() => setPre(true)} />
        <BotaoBarra icone={RefreshCw} texto="Atualizar" onClick={atualizar} carregando={carregando} />
        <BotaoBarra icone={Printer} texto="Imprimir NF" onClick={exigirNota(imprimir)} carregando={ocupado === 'imprimir'} />
        <BotaoBarra icone={Barcode} texto="Gerar Boleto" onClick={exigirNota(gerarBoleto)} carregando={ocupado === 'boleto'} />
        <BotaoBarra icone={Mail} texto="Enviar por Email" onClick={exigirNota(enviarEmail)} carregando={ocupado === 'email'} />
        <BotaoBarra icone={FileDown} texto="Gerar Remessa" onClick={exigirNota(remessa)} carregando={ocupado === 'remessa'} titulo="Remessa CNAB 240 das notas da lista, do banco da nota escolhida" />
        <BotaoBarra icone={ListChecks} texto="Listar Tudo" onClick={listarTudo} ativo={tudo} titulo="Todas as notas da empresa" />
        <div className="relative">
          <BotaoBarra icone={ChevronDown} texto="Opções" onClick={() => setOpcoesAberto((v) => !v)} />
          {opcoesAberto && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setOpcoesAberto(false)} />
              <div className="absolute z-30 mt-1 min-w-48 py-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl">
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                  onClick={() => {
                    setOpcoesAberto(false);
                    exigirNota((n) => setConfirmar({ tipo: 'limpar', nota: n }))();
                  }}
                >
                  <Eraser className="w-4 h-4 text-blue-600" /> Limpar Dados Boleto
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3 shrink-0" />}

      <div className="flex-1 flex min-h-0">
        <div className="w-72 shrink-0 flex flex-col min-h-0 border-r border-stone-200 dark:border-stone-800">
          <TituloPainel>Faturamentos</TituloPainel>
          <Grade
            colunas={[
              { chave: 'id', titulo: 'ID', alinhar: 'dir' },
              { chave: 'data_fatur', titulo: 'Data', alinhar: 'centro', render: (r) => data(r.data_fatur) },
              {
                chave: 'obs',
                titulo: 'Referência',
                render: (r) =>
                  editRef?.id === r.id ? (
                    <input
                      autoFocus
                      maxLength={255}
                      className={`${INPUT_CLASS} w-40 !py-1`}
                      value={editRef.obs}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditRef({ id: r.id, obs: e.target.value })}
                      onBlur={gravarRef}
                      onKeyDown={(e) => (e.key === 'Enter' ? gravarRef() : e.key === 'Escape' ? setEditRef(null) : null)}
                    />
                  ) : (
                    <span title="Duplo clique para editar">{r.obs}</span>
                  ),
              },
            ]}
            linhas={faturs}
            selecionado={tudo ? undefined : fatur?.id}
            onSelecionar={escolherFatur}
            onDuploClique={(r, c) => c === 'obs' && setEditRef({ id: r.id, obs: r.obs ?? '' })}
            carregando={carregando && !faturs.length}
            vazio="Nenhum faturamento."
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 flex flex-col min-h-0">
            <TituloPainel direita={<span className="text-[11px] text-stone-500">{tudo ? 'Todas as notas da empresa' : fatur ? `Faturamento ${fatur.id}${fatur.obs ? ` — ${fatur.obs}` : ''}` : ''}</span>}>
              Notas ({notas.length})
            </TituloPainel>
            <Grade
              colunas={colunasNotas}
              linhas={notas}
              selecionado={nota?.id}
              onSelecionar={setNota}
              onDuploClique={(r, c) => (c === 'boleto_enviado' && r.boleto_enviado === 'S' ? setConfirmar({ tipo: 'remessa', nota: r }) : r.status === 'A' && setEditar(r))}
              riscada={(r) => r.cancelado === 'S'}
              acoes={acoesNota}
              vazio={fatur || tudo ? 'Nenhuma nota.' : 'Escolha um faturamento.'}
            />
          </div>
          <div className="h-56 shrink-0 flex flex-col min-h-0 border-t border-stone-200 dark:border-stone-800">
            <TituloPainel>
              <FileText className="w-3 h-3 inline mr-1" />
              Produtos da Nota {nota ? `${nota.serie}/${nota.numero}` : ''}
            </TituloPainel>
            <Grade colunas={colunasProdutos} linhas={produtos} vazio="Nenhum produto." />
          </div>
        </div>
      </div>

      {pre && (
        <PreFaturamento
          clientes={opcoes?.clientes ?? []}
          onFechar={() => setPre(false)}
          onGravado={(qtd) => {
            setPre(false);
            onToast(`Faturamento gravado com ${qtd} nota(s).`);
            faturIdRef.current = null;
            atualizar();
          }}
        />
      )}
      {editar && (
        <EditarNota
          nota={editar}
          opcoes={opcoes}
          onFechar={() => setEditar(null)}
          onGravado={() => {
            setEditar(null);
            onToast('Nota gravada.');
            carregarNotas(fatur, tudo);
          }}
        />
      )}
      {confirmar && (
        <ConfirmDialog
          titulo={confirmar.tipo === 'cancelar' ? 'Cancelar NF' : confirmar.tipo === 'limpar' ? 'Limpar dados do boleto' : 'Reenviar na remessa'}
          tom={confirmar.tipo === 'remessa' ? 'normal' : 'perigo'}
          confirmar={confirmar.tipo === 'cancelar' ? 'Cancelar NF' : confirmar.tipo === 'limpar' ? 'Limpar' : 'Reenviar'}
          mensagem={
            <>
              {confirmar.tipo === 'cancelar' ? 'Confirma cancelar a NF?' : confirmar.tipo === 'limpar' ? 'Confirma limpar dados do boleto?' : 'A nota volta a "não enviada" e sai na próxima remessa.'}
              <br />
              NF {confirmar.nota.serie}/{confirmar.nota.numero} — {confirmar.nota.nome} — R$ {moeda(confirmar.nota.total_liquido)}
              {confirmar.tipo !== 'remessa' && confirmar.nota.boleto_enviado === 'S' && (
                <span className="block mt-2 font-semibold text-rose-700 dark:text-rose-400">
                  Atenção: o boleto já foi enviado ao banco na remessa. Peça a baixa/alteração do título no banco.
                </span>
              )}
              {confirmar.tipo === 'cancelar' && confirmar.nota.status_email === 'E' && <span className="block mt-1">O cliente recebe um e-mail avisando do cancelamento.</span>}
              {confirmar.tipo === 'limpar' && <span className="block mt-1">O nosso número já usado não volta para o banco.</span>}
            </>
          }
          onConfirmar={executarConfirmacao}
          onCancelar={() => setConfirmar(null)}
        />
      )}
    </div>
  );
};
