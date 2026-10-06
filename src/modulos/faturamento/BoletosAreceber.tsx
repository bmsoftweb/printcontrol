import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Barcode, Loader2, Printer, Search } from 'lucide-react';
import { api, baixarArquivo } from '../../services/api';
import { Janela, BOTAO_SECUNDARIO } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { NumberField } from '../../components/NumberField';
import { Toggle } from '../../components/Toggle';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../../utils/formStyles';
import { BotaoBarra, Grade, abrirPdf, data, moeda, type Reg } from './comum';

interface Props {
  /** Parcela única (areceber.id); 0 = todas da venda */
  idAreceber?: number;
  idVenda?: number;
  /** Gera e imprime o boleto da primeira parcela e fecha (modo "Automático" do Delphi) */
  automatico?: boolean;
  onFechar: () => void;
}

/**
 * "Geração / Impressão Boleto" (frmImpressaoBoletoNew), aberta pelas telas de Vendas para as parcelas
 * (areceber) de uma venda. Uso: <BoletosAreceber idVenda={venda.id} onFechar={...} />.
 */
export const BoletosAreceber: React.FC<Props> = ({ idAreceber = 0, idVenda = 0, automatico = false, onFechar }) => {
  const [ids, setIds] = useState({ areceber: String(idAreceber), venda: String(idVenda) });
  const [preview, setPreview] = useState(true);
  const [linhas, setLinhas] = useState<Reg[]>([]);
  const [sel, setSel] = useState<Reg | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const automaticoFeito = useRef(false);

  const selecionar = useCallback(async () => {
    setOcupado('selecionar');
    setErro(null);
    try {
      const l: Reg[] = await api.get(`/api/boletos-areceber?id_areceber=${Number(ids.areceber) || 0}&id_venda=${Number(ids.venda) || 0}`);
      setLinhas(l);
      setSel((s) => l.find((x) => x.id === s?.id) ?? l[0] ?? null);
      return l;
    } catch (e: any) {
      setErro(e.message);
      return [];
    } finally {
      setOcupado(null);
    }
  }, [ids]);

  const imprimir = async (lista: Reg[], nome: string) => {
    const url = `/api/boletos-areceber/pdf?ids=${lista.map((r) => r.id).join(',')}`;
    if (preview) await abrirPdf(url);
    else await baixarArquivo(url, `${nome}.pdf`);
  };

  const acao = async (n: string, fn: () => Promise<unknown>) => {
    setOcupado(n);
    setErro(null);
    try {
      await fn();
      await selecionar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  useEffect(() => {
    selecionar().then((l) => {
      if (automatico && !automaticoFeito.current && l[0]) {
        automaticoFeito.current = true;
        imprimir([l[0]], 'boleto').then(onFechar, (e) => setErro(e.message));
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Janela
      titulo="Geração / Impressão Boleto"
      subtitulo={automatico ? '..Gerando boleto..' : 'Parcelas a receber com banco que emite boleto'}
      onFechar={onFechar}
      largura="max-w-6xl"
      rodape={
        <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>
          Fechar
        </button>
      }
    >
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Id Registro Único</span>
          <NumberField value={ids.areceber} onChange={(v) => setIds({ ...ids, areceber: v })} className={`${INPUT_CLASS} w-32`} />
        </label>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Id Venda</span>
          <NumberField value={ids.venda} onChange={(v) => setIds({ ...ids, venda: v })} className={`${INPUT_CLASS} w-32`} />
        </label>
        <BotaoBarra icone={Search} texto="Selecionar" onClick={selecionar} carregando={ocupado === 'selecionar'} />
        <div className="h-[38px] flex items-center px-2">
          <Toggle checked={preview} onChange={setPreview} label="Preview" size="sm" />
        </div>
        <div className="flex-1" />
        <BotaoBarra
          icone={Barcode}
          texto="Gerar Boleto"
          onClick={() => sel && !sel.boleto_codigo_barras && acao('gerar', () => api.post(`/api/boletos-areceber/${sel.id}/gerar`))}
          carregando={ocupado === 'gerar'}
          disabled={!sel || Boolean(sel.boleto_codigo_barras)}
        />
        <BotaoBarra icone={Printer} texto="Imprimir Atual" onClick={() => sel && acao('atual', () => imprimir([sel], `boleto_${sel.documento}_${sel.parcelas_nr}`))} carregando={ocupado === 'atual'} disabled={!sel} />
        <BotaoBarra icone={Printer} texto="Imprimir Todos" onClick={() => acao('todos', () => imprimir(linhas, `boleto_${sel?.documento ?? ''}`))} carregando={ocupado === 'todos'} disabled={!linhas.length} />
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="h-[50vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        <Grade
          linhas={linhas}
          selecionado={sel?.id}
          onSelecionar={setSel}
          carregando={ocupado === 'selecionar' && !linhas.length}
          vazio="Nenhuma parcela com boleto para esta venda."
          colunas={[
            { chave: 'id', titulo: 'ID', alinhar: 'dir' },
            { chave: 'id_venda', titulo: 'Venda', alinhar: 'dir' },
            { chave: 'documento', titulo: 'Documento' },
            { chave: 'parcelas_nr', titulo: 'Parcela', alinhar: 'centro', render: (r) => `${String(r.parcelas_nr ?? '').padStart(3, '0')}/${r.parcelas_tot ?? ''}` },
            { chave: 'sacado_nome', titulo: 'Cliente' },
            { chave: 'data_venda', titulo: 'Data Venda', alinhar: 'centro', render: (r) => data(r.data_venda) },
            { chave: 'data_vencimento', titulo: 'Vencimento', alinhar: 'centro', render: (r) => data(r.data_vencimento) },
            { chave: 'valor_areceber', titulo: 'Valor', alinhar: 'dir', render: (r) => moeda(r.valor_areceber), rodape: moeda(linhas.reduce((s, r) => s + Number(r.valor_areceber || 0), 0)) },
            { chave: 'banco_apelido', titulo: 'Banco' },
            { chave: 'boleto_nosso_numero', titulo: 'Nosso Nr.', render: (r) => `${r.boleto_nosso_numero ?? ''}${r.boleto_nosso_numero_dig ? `-${r.boleto_nosso_numero_dig}` : ''}` },
            { chave: 'boleto_linha_digitavel', titulo: 'Linha Digitável', render: (r) => <span className="font-mono">{r.boleto_linha_digitavel}</span> },
            { chave: 'status', titulo: 'Status', alinhar: 'centro' },
          ]}
        />
      </div>
      {ocupado && ocupado !== 'selecionar' && (
        <p className="mt-2 text-[11px] text-stone-500 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Gerando boleto…
        </p>
      )}
    </Janela>
  );
};
