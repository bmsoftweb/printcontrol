import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Download, FileCheck2, FileCode2, FileText, Mail, Printer, Receipt, RefreshCw, Search, Send, Slash } from 'lucide-react';
import { api, baixarArquivo } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MaisAcoes } from '../../components/MaisAcoes';
import { INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { BoletosAreceber } from '../faturamento';
import { Botao, Carregando, Grade, PreviewPdf, dataBR, dataHoraBR, moeda, numero9, type Coluna, type Linha } from './comum';

/** ● verde autorizada, vermelho com erro na última mensagem, amarelo nos demais */
const Situacao: React.FC<{ v: Linha }> = ({ v }) => {
  const cor = v.nfe_cancelada === 'S' ? '#6b7280' : v.nfe_status === '100' ? '#16a34a' : /erro|rejei/i.test(String(v.nfe_ultima_msg ?? '')) ? '#dc2626' : '#eab308';
  return <span title={v.nfe_ultima_msg ?? ''} className="inline-block w-3 h-3 rounded-full" style={{ background: cor }} />;
};

/** Texto de justificativa: vermelho com menos de 15 caracteres, verde com 15 ou mais (como no Delphi) */
const Justificativa: React.FC<{ valor: string; onChange: (v: string) => void; rotulo: string }> = ({ valor, onChange, rotulo }) => (
  <label className="flex flex-col gap-1">
    <span className={LABEL_CLASS}>{rotulo}</span>
    <textarea
      autoFocus
      rows={4}
      className={`${INPUT_CLASS} w-full resize-none ${valor.trim().length < 15 ? '!text-rose-600' : '!text-emerald-700'}`}
      value={valor}
      onChange={(e) => onChange(e.target.value)}
    />
    <span className="text-[11px] text-stone-400">{valor.trim().length} caracteres (mínimo 15)</span>
  </label>
);

type Painel = null | 'cancelar' | 'cce' | 'inutilizar' | 'email' | 'xml';

/** Gerenciamento de NF-e (frmVendasNFe) */
export const GerenciadorNFe: React.FC<{ idVenda?: number; onFechar: () => void; onToast: (m: string) => void }> = ({ idVenda, onFechar, onToast }) => {
  const [notas, setNotas] = useState<Linha[]>([]);
  const [sel, setSel] = useState<number | null>(idVenda ?? null);
  const [det, setDet] = useState<Linha | null>(null);
  const [aba, setAba] = useState<'eventos' | 'log'>('eventos');
  const [logGeral, setLogGeral] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [texto, setTexto] = useState('');
  const [inut, setInut] = useState({ ano: String(new Date().getFullYear()), serie: '1', modelo: '55', de: '', ate: '' });
  const [pdf, setPdf] = useState<{ url: string; titulo: string } | null>(null);
  const [boletos, setBoletos] = useState(false);
  const [xmlConf, setXmlConf] = useState<Linha | null>(null);
  const [evSel, setEvSel] = useState<number | null>(null);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);

  const nota = notas.find((n) => n.id === sel) ?? null;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const l: Linha[] = await api.get('/api/vendas-nfe');
      setNotas(l);
      setSel((s) => (s && l.some((n) => n.id === s) ? s : l.length ? l[l.length - 1].id : null));
      setLogGeral(await api.get('/api/vendas-nfe/log'));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    setDet(null);
    if (sel) api.get(`/api/vendas-nfe/${sel}`).then(setDet).catch((e) => setErro(e.message));
  }, [sel, notas]);

  const executar = async (rotulo: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      const r = await fn();
      if (ok) onToast(ok(r));
      await carregar();
      return r;
    } catch (e: any) {
      const extra = Array.isArray(e?.erros) ? '' : '';
      setErro(`${e.message}${extra}`);
    } finally {
      setOcupado(null);
    }
  };

  const exigirNota = () => {
    if (!nota) {
      setErro('Escolha uma nota na lista.');
      return false;
    }
    return true;
  };

  const colunas: Coluna<Linha>[] = [
    { chave: 'sit', titulo: '●', rotulo: 'Situação', alinhar: 'centro', render: (r) => <Situacao v={r} /> },
    { chave: 'venda_status', titulo: 'S', alinhar: 'centro' },
    { chave: 'es', titulo: 'E/S', alinhar: 'centro' },
    { chave: 'data_venda', titulo: 'Data', alinhar: 'centro', render: (r) => dataBR(r.data_venda) },
    { chave: 'id_operacao', titulo: 'Id Op.', alinhar: 'dir', oculta: true },
    { chave: 'apelido_operacao', titulo: 'Operação' },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Número', alinhar: 'dir', render: (r) => numero9(r.numero) },
    { chave: 'id_cliente', titulo: 'Id Cliente', alinhar: 'dir' },
    { chave: 'cliente_nome', titulo: 'Cliente' },
    { chave: 'valor_total_liquido', titulo: 'Total Líquido', alinhar: 'dir', render: (r) => moeda(r.valor_total_liquido) },
    { chave: 'valor_total_bruto', titulo: 'Total Bruto', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_total_bruto) },
    { chave: 'valor_acrescimo_total', titulo: 'R$ Acresc.', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_acrescimo_total) },
    { chave: 'valor_desconto_total', titulo: 'R$ Desc.', alinhar: 'dir', oculta: true, render: (r) => moeda(r.valor_desconto_total) },
    { chave: 'nfe_chave', titulo: 'Chave NFe' },
    { chave: 'nfe_status', titulo: 'Status NFe', alinhar: 'centro' },
    { chave: 'nfe_protocolo', titulo: 'Protocolo Envio' },
    { chave: 'nfe_recibo', titulo: 'Recibo', oculta: true },
    { chave: 'nfe_cancelada', titulo: 'NFe Cancelada', alinhar: 'centro' },
    { chave: 'nfe_protocolo_cancelamento', titulo: 'Protocolo Cancelamento', oculta: true },
    { chave: 'nfe_ultima_msg', titulo: 'Última Mensagem' },
  ];

  const abrirPainel = (p: Painel) => {
    if (p !== 'inutilizar' && !exigirNota()) return;
    setTexto(p === 'email' ? String(det?.cliente_email ?? '') : '');
    setPainel(p);
  };

  const okPainel = async () => {
    if (painel === 'cancelar') {
      if (texto.trim().length < 15) return setErro('Justificativa deve ter pelo menos 15 caracteres !');
      const r = await executar('cancelar', () => api.post(`/api/vendas-nfe/${nota!.id}/cancelar`, { justificativa: texto }), () => 'NF-e cancelada.');
      if (r) {
        setPainel(null);
        setErro(r.aviso);
      }
    } else if (painel === 'cce') {
      if (texto.trim().length < 15) return setErro('Correção deve ter pelo menos 15 caracteres !');
      if (await executar('cce', () => api.post(`/api/vendas-nfe/${nota!.id}/cce`, { correcao: texto }), (r) => `Carta de correção ${r.seq} registrada.`)) setPainel(null);
    } else if (painel === 'inutilizar') {
      if (texto.trim().length < 15) return setErro('Justificativa deve ter pelo menos 15 caracteres !');
      if (await executar('inutilizar', () => api.post('/api/vendas-nfe/inutilizar', { ...inut, justificativa: texto }), (r) => `Inutilização: ${r.cStat} - ${r.xMotivo}`)) setPainel(null);
    } else if (painel === 'email') {
      if (await executar('email', () => api.post(`/api/vendas-nfe/${nota!.id}/email`, { para: texto }), (r) => `E-mail enviado para ${r.para.join(', ')}.`)) setPainel(null);
    }
  };

  const eventos: Linha[] = det?.eventos ?? [];
  const evento = eventos.find((e) => e.id === evSel) ?? eventos[eventos.length - 1];

  return (
    <Janela titulo="Gerenciamento de NF-e" subtitulo="Notas fiscais eletrônicas (modelo 55) da empresa ativa" onFechar={onFechar} largura="max-w-[97vw]">
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Botao
          icone={Send}
          tom="primario"
          carregando={ocupado === 'registrar'}
          onClick={() => {
            if (!exigirNota()) return;
            if (nota!.nfe_status === '100') return setErro('Nota já autorizada!');
            setConfirmarEnvio(true);
          }}
        >
          Registrar NFe
        </Botao>
        <Botao icone={Printer} onClick={() => exigirNota() && setPdf({ url: `/api/vendas-nfe/${nota!.id}/danfe`, titulo: `DANFE ${nota!.serie}/${nota!.numero}` })}>
          DANFE
        </Botao>
        <Botao icone={Search} carregando={ocupado === 'consultar'} onClick={() => exigirNota() && executar('consultar', () => api.post(`/api/vendas-nfe/${nota!.id}/consultar`), (r) => `${r.cStat} - ${r.xMotivo}${r.eventos?.length ? ` · ${r.eventos.length} evento(s)` : ''}`)}>
          Consultar
        </Botao>
        <Botao icone={Mail} onClick={() => abrirPainel('email')}>
          Enviar e-mail
        </Botao>
        <MaisAcoes
          itens={[
            { icone: Receipt, titulo: 'Boletos', onClick: () => exigirNota() && setBoletos(true) },
            {
              icone: FileCode2,
              titulo: ocupado === 'xml' ? 'Conferindo XML…' : 'Conferir XML',
              disabled: ocupado === 'xml',
              onClick: () => exigirNota() && executar('xml', () => api.post(`/api/vendas-nfe/${nota!.id}/gerar-xml`)).then((r) => r && setXmlConf(r)),
            },
            { icone: Download, titulo: 'Baixar XML', onClick: () => exigirNota() && baixarArquivo(`/api/vendas-nfe/${nota!.id}/xml`, `${nota!.nfe_chave || nota!.id}.xml`).catch((e: any) => setErro(e.message)) },
            { icone: FileText, titulo: 'Carta Correção', separar: true, onClick: () => abrirPainel('cce') },
            { icone: Slash, titulo: 'Inutilizar Numeração', onClick: () => abrirPainel('inutilizar') },
            { icone: Ban, titulo: 'Cancelar NFe', tom: 'perigo', separar: true, onClick: () => abrirPainel('cancelar') },
          ]}
        />
        <Botao icone={RefreshCw} onClick={carregar} carregando={carregando} titulo="Atualizar" />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3 whitespace-pre-line" />}
      <div className="text-xs font-semibold text-stone-500 mb-1">Listagem das Notas Fiscais</div>
      <div className="h-[38vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        <Grade nome="vendas.nfe" onToast={onToast} colunas={colunas} linhas={notas} carregando={carregando} selecionado={sel} onSelecionar={(r) => setSel(r.id)} vazio="Nenhuma venda finalizada com série de NF-e (modelo 55)." />
      </div>
      <div className="flex gap-1 mt-3 border-b border-stone-200 dark:border-stone-800">
        {(['eventos', 'log'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAba(a)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 cursor-pointer ${aba === a ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-stone-500'}`}
          >
            {a === 'eventos' ? 'Registro de Eventos' : 'Log'}
          </button>
        ))}
      </div>
      <div className="h-[22vh] flex border border-t-0 border-stone-200 dark:border-stone-800 rounded-b-lg overflow-hidden">
        {aba === 'eventos' ? (
          <>
            <div className="flex-1 flex flex-col min-w-0">
              {!det && sel ? (
                <Carregando />
              ) : (
                <Grade
                  nome="vendas.nfe.eventos"
                  onToast={onToast}
                  colunas={[
                    { chave: 'seq', titulo: 'Seq#', alinhar: 'centro' },
                    { chave: 'data', titulo: 'Data', alinhar: 'centro', render: (r) => dataBR(r.data) },
                    { chave: 'hora', titulo: 'Hora', alinhar: 'centro' },
                    { chave: 'protocolo', titulo: 'Protocolo' },
                    { chave: 'descricao', titulo: 'Descrição', render: (r) => <span title={r.texto}>{r.texto || r.descricao}</span> },
                  ]}
                  linhas={eventos}
                  selecionado={evento?.id}
                  onSelecionar={(r) => setEvSel(r.id)}
                  vazio="Nenhum evento."
                />
              )}
            </div>
            <div className="flex flex-col gap-1.5 p-2 border-l border-stone-200 dark:border-stone-800">
              <Botao icone={Printer} onClick={() => (evento ? setPdf({ url: `/api/vendas-nfe/eventos/${evento.id}/pdf`, titulo: `Evento ${evento.seq}` }) : setErro('NFe ainda não tem carta de correção'))}>
                Imprimir evento
              </Botao>
              <Botao
                icone={Mail}
                carregando={ocupado === 'emailev'}
                onClick={() => (evento ? executar('emailev', () => api.post(`/api/vendas-nfe/eventos/${evento.id}/email`, {}), (r) => `Evento enviado para ${r.para.join(', ')}.`) : setErro('NFe ainda não tem carta de correção'))}
              >
                E-mail evento
              </Botao>
            </div>
          </>
        ) : (
          <Grade
            nome="vendas.nfe.log"
            onToast={onToast}
            colunas={[
              { chave: 'data_hora', titulo: 'Registrado em', alinhar: 'centro', render: (r) => dataHoraBR(r.data_hora) },
              { chave: 'serie_numero', titulo: 'Série/Número', alinhar: 'centro' },
              { chave: 'log', titulo: 'Mensagem' },
            ]}
            linhas={logGeral.filter((l) => !sel || l.id_venda === sel || !l.id_venda)}
            vazio="Sem registros."
          />
        )}
      </div>

      {painel && painel !== 'xml' && (
        <Janela
          titulo={{ cancelar: 'JUSTIFICATIVA CANCELAMENTO', cce: 'CORREÇÃO A SER CONSIDERADA', inutilizar: 'INUTILIZAÇÃO DE NUMERAÇÃO', email: 'ENVIAR NF-e POR E-MAIL' }[painel]}
          subtitulo={painel !== 'inutilizar' && nota ? `NF-e ${nota.serie}/${nota.numero} - ${nota.cliente_nome}` : undefined}
          onFechar={() => setPainel(null)}
          largura="max-w-xl"
          ocupado={!!ocupado}
          rodape={
            <>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setPainel(null)} disabled={!!ocupado}>
                Cancelar
              </button>
              <button type="button" className={BOTAO_PRIMARIO} onClick={okPainel} disabled={!!ocupado}>
                OK
              </button>
            </>
          }
        >
          {painel === 'email' ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Destinatário (padrão: e-mail do cliente)</span>
              <input autoFocus className={INPUT_CLASS} value={texto} onChange={(e) => setTexto(e.target.value)} />
              <span className="text-[11px] text-stone-400">Vão anexos o XML, o DANFE e os boletos das parcelas (se houver).</span>
            </label>
          ) : (
            <Justificativa rotulo={painel === 'cce' ? 'Correção:' : 'Justificativa:'} valor={texto} onChange={setTexto} />
          )}
          {painel === 'inutilizar' && (
            <div className="grid grid-cols-5 gap-2 mt-3">
              {(
                [
                  ['ano', 'Ano'],
                  ['serie', 'Série'],
                  ['modelo', 'Modelo'],
                  ['de', 'Numeração de'],
                  ['ate', 'até'],
                ] as const
              ).map(([k, r]) => (
                <label key={k} className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>{r}</span>
                  <input className={`${INPUT_CLASS} text-right`} value={inut[k]} onChange={(e) => setInut((x) => ({ ...x, [k]: e.target.value.replace(/\D/g, '') }))} />
                </label>
              ))}
            </div>
          )}
        </Janela>
      )}

      {xmlConf && (
        <Janela titulo={`XML da NF-e ${xmlConf.chave}`} onFechar={() => setXmlConf(null)} largura="max-w-5xl">
          <div className="text-xs mb-2 space-y-1">
            <div>
              Assinatura: <b>{xmlConf.assinado ? 'assinado com o certificado da empresa' : 'não assinado'}</b> {xmlConf.aviso && <span className="text-amber-700">({xmlConf.aviso})</span>}
            </div>
            <div>
              Schema ({xmlConf.validacao?.schema}):{' '}
              {xmlConf.validacao?.pulada ? (
                <b className="text-amber-700">validação XSD indisponível no servidor (dependência xmllint-wasm)</b>
              ) : xmlConf.validacao?.valido ? (
                <b className="text-emerald-700">válido</b>
              ) : (
                <b className="text-rose-600">
                  inválido:{' '}
                  {(xmlConf.validacao?.erros ?? []).map((e: Linha) => `${e.campo ? `${e.campo}: ` : ''}${e.mensagem}`).join(' | ')}
                </b>
              )}
            </div>
            <div>
              Total da nota: <b>R$ {moeda(xmlConf.totais?.vNF)}</b>
            </div>
          </div>
          <pre className="text-[10px] bg-stone-50 dark:bg-stone-950 p-3 rounded-lg overflow-auto h-[55vh] whitespace-pre-wrap break-all">{xmlConf.xml}</pre>
        </Janela>
      )}

      {confirmarEnvio && nota && (
        <ConfirmDialog
          titulo="Confirme a operação"
          mensagem={`Enviar a NF-e ${nota.serie}/${nota.numero} (${nota.cliente_nome}) para autorização na SEFAZ?`}
          confirmar="Registrar NFe"
          tom="normal"
          onCancelar={() => setConfirmarEnvio(false)}
          onConfirmar={async () => {
            setConfirmarEnvio(false);
            await executar('registrar', () => api.post(`/api/vendas-nfe/${nota.id}/registrar`), (r) => `NF-e autorizada: protocolo ${r.protocolo}.`);
          }}
        />
      )}
      {pdf && <PreviewPdf url={pdf.url} titulo={pdf.titulo} onFechar={() => setPdf(null)} />}
      {boletos && nota && <BoletosAreceber idVenda={nota.id} onFechar={() => setBoletos(false)} />}
      {ocupado === 'registrar' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/40">
          <div className="px-5 py-4 rounded-xl bg-white dark:bg-stone-900 shadow-xl text-sm flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-blue-600 animate-pulse" /> Enviando NFe...
          </div>
        </div>
      )}
    </Janela>
  );
};
