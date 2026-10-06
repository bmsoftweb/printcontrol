import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { api } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { NumberField } from '../../components/NumberField';
import { DateField } from '../../components/DateField';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { CampoPesquisa, moeda, num, qtd, r2, type Linha } from './comum';

export interface Apoio {
  operacoes: Linha[];
  series: Linha[];
  condicoes: Linha[];
  vendedores: Linha[];
  bancos: Linha[];
}

const Campo: React.FC<{ rotulo: string; children: React.ReactNode; dica?: string; className?: string }> = ({ rotulo, children, dica, className = '' }) => (
  <label className={`${FIELD_CLASS} ${className}`}>
    <span className={LABEL_CLASS}>{rotulo}</span>
    {children}
    {dica && <span className={HINT_CLASS}>{dica}</span>}
  </label>
);

const ValorLeitura: React.FC<{ valor: unknown; destaque?: boolean }> = ({ valor, destaque }) => (
  <input readOnly tabIndex={-1} value={moeda(valor)} className={`${INPUT_CLASS} text-right font-mono ${destaque ? 'font-bold' : ''}`} />
);

/** Percentual ↔ valor sobre uma base, como os OnExit do Delphi (round2) */
const pctDe = (valor: number, base: number) => (base ? r2((valor / base) * 100) : 0);
const valorDe = (pct: number, base: number) => r2((pct / 100) * base);

const Rodape: React.FC<{ onCancelar: () => void; onGravar: () => void; gravando: boolean; rotulo?: string }> = ({ onCancelar, onGravar, gravando, rotulo = 'Gravar' }) => (
  <>
    <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} disabled={gravando}>
      Cancelar
    </button>
    <button type="button" className={BOTAO_PRIMARIO} onClick={onGravar} disabled={gravando}>
      {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {rotulo}
    </button>
  </>
);

// ============================================================ §3.5 Inclusão / Alteração de Venda

export const FormVenda: React.FC<{ venda: Linha | null; apoio: Apoio; onFechar: () => void; onGravado: (id: number) => void }> = ({ venda, apoio, onFechar, onGravado }) => {
  const [f, setF] = useState<Linha>(() => ({
    id_operacao: venda?.id_operacao ?? '',
    id_serie: venda?.id_serie ?? '',
    id_cliente: venda?.id_cliente ?? 0,
    nome_cliente: venda?.nome ?? '',
    id_condicao: venda?.id_condicao ?? '',
    id_vendedor1: venda?.id_vendedor1 ?? '',
    id_vendedor2: venda?.id_vendedor2 || '',
    valor_acrescimo_digitado: num(venda?.valor_acrescimo_digitado),
    perc_acrescimo_digitado: num(venda?.perc_acrescimo_digitado),
    valor_desconto_digitado: num(venda?.valor_desconto_digitado),
    perc_desconto_digitado: num(venda?.perc_desconto_digitado),
  }));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const op = apoio.operacoes.find((o) => String(o.id) === String(f.id_operacao));
  const devolucao = op?.tipo === 'D';
  const base = num(venda?.valor_total_liquido_antes_desconto_nf);

  // Operação: a 1ª série aceita vira a série da venda (como o OnExit do Delphi)
  const mudarOperacao = (id: string) => {
    const o = apoio.operacoes.find((x) => String(x.id) === id);
    const primeira = String(o?.series_aceitas ?? '').split(/[;,\s]+/).filter(Boolean)[0];
    const s = apoio.series.find((x) => x.serie === primeira);
    setF((x) => ({ ...x, id_operacao: id, id_serie: s?.id ?? x.id_serie }));
  };

  const gravar = async () => {
    setGravando(true);
    setErro(null);
    try {
      const corpo = { ...f, id_vendedor2: f.id_vendedor2 || 0 };
      const r = venda ? await api.put(`/api/vendas/${venda.id}`, corpo) : await api.post('/api/vendas', corpo);
      onGravado(Number(r.id ?? venda?.id));
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };

  const select = (k: string, opcoes: Linha[], rotulo: (o: Linha) => string, vazio = '— Selecione —', extra: Partial<React.SelectHTMLAttributes<HTMLSelectElement>> = {}) => (
    <select className={`${INPUT_CLASS} w-full`} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...extra}>
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {rotulo(o)}
        </option>
      ))}
    </select>
  );

  return (
    <Janela titulo={venda ? `Alteração de Venda nº ${venda.id}` : 'Inclusão de Venda'} onFechar={onFechar} largura="max-w-3xl" ocupado={gravando} rodape={<Rodape onCancelar={onFechar} onGravar={gravar} gravando={gravando} />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3 whitespace-pre-line" />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo rotulo="Operação:">
          <select autoFocus={!venda} required className={`${INPUT_CLASS} w-full`} value={f.id_operacao} onChange={(e) => mudarOperacao(e.target.value)}>
            <option value="">— Selecione —</option>
            {apoio.operacoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} - {o.apelido} ({o.codigo})
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Série:" dica={op ? `Séries aceitas: ${op.series_aceitas || '—'}` : undefined}>
          {select('id_serie', apoio.series, (s) => `${s.serie}${s.descricao ? ` - ${s.descricao}` : ''}${s.modelo === '55' ? ' (NF-e)' : ''}`, '— Selecione —', { required: true })}
        </Campo>
        <Campo rotulo="Cliente:" className="sm:col-span-2">
          <CampoPesquisa tipo="clientes" id={f.id_cliente} nome={f.nome_cliente} obrigatorio onEscolher={(id, l) => setF((x) => ({ ...x, id_cliente: id, nome_cliente: l?.nome ?? '' }))} />
        </Campo>
        <Campo rotulo="Plano:" dica={devolucao ? 'Devolução usa a condição "VALE"' : undefined}>
          {select('id_condicao', apoio.condicoes, (c) => `${c.id} - ${c.apelido}`, '— Selecione —', { disabled: devolucao, required: !devolucao })}
        </Campo>
        <div />
        <Campo rotulo="Vendedor 1:">{select('id_vendedor1', apoio.vendedores, (v) => `${v.id} - ${v.nome}`, '— Selecione —', { required: true })}</Campo>
        <Campo rotulo="Vendedor 2:">{select('id_vendedor2', apoio.vendedores, (v) => `${v.id} - ${v.nome}`, '— Nenhum —')}</Campo>
      </div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        <Campo rotulo="Total Bruto:" className="col-span-2">
          <ValorLeitura valor={base} />
        </Campo>
        <div className="hidden sm:block col-span-2" />
        <Campo rotulo="Acréscimos (R$):">
          <NumberField scale={2} value={f.valor_acrescimo_digitado} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, valor_acrescimo_digitado: num(v), perc_acrescimo_digitado: pctDe(num(v), base) }))} />
        </Campo>
        <Campo rotulo="Acréscimos (%):">
          <NumberField scale={2} value={f.perc_acrescimo_digitado} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, perc_acrescimo_digitado: num(v), valor_acrescimo_digitado: valorDe(num(v), base) }))} />
        </Campo>
        <Campo rotulo="Descontos (R$):">
          <NumberField scale={2} value={f.valor_desconto_digitado} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, valor_desconto_digitado: num(v), perc_desconto_digitado: pctDe(num(v), base) }))} />
        </Campo>
        <Campo rotulo="Descontos (%):">
          <NumberField scale={2} value={f.perc_desconto_digitado} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, perc_desconto_digitado: num(v), valor_desconto_digitado: valorDe(num(v), base) }))} />
        </Campo>
        <Campo rotulo="Total Líquido:" className="col-span-2" dica="Prévia: o plano de pagamento entra ao gravar (Totalizar)">
          <ValorLeitura valor={r2(base + num(f.valor_acrescimo_digitado) - num(f.valor_desconto_digitado))} destaque />
        </Campo>
      </div>
    </Janela>
  );
};

// ============================================================ §5.2 Produto da venda

const ITEM_VAZIO = { id_produto: 0, descricao: '', referencia: '', qtdade: 1, estoque: 0, preco_lista: 0, preco_venda: 0, perc_acrescimo: 0, valor_acrescimo: 0, perc_desconto: 0, valor_desconto: 0 };

export const FormItem: React.FC<{ venda: Linha; item: Linha | null; onFechar: () => void; onGravado: () => void }> = ({ venda, item, onFechar, onGravado }) => {
  const [f, setF] = useState<Linha>(() =>
    item
      ? {
          id_produto: item.id_produto,
          descricao: item.descricao_produto ?? '',
          referencia: item.referencia ?? '',
          qtdade: num(item.qtdade),
          estoque: 0,
          preco_lista: num(item.preco_lista),
          preco_venda: num(item.preco_venda),
          perc_acrescimo: num(item.perc_acrescimo),
          valor_acrescimo: num(item.valor_acrescimo),
          perc_desconto: num(item.perc_desconto),
          valor_desconto: num(item.valor_desconto),
        }
      : ITEM_VAZIO,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [gravados, setGravados] = useState(0);
  const idRef = useRef<HTMLInputElement>(null);
  const bruto = r2(num(f.qtdade) * num(f.preco_venda));
  const liquido = r2(bruto + num(f.valor_acrescimo) - num(f.valor_desconto));

  // Estoque da empresa ativa na edição
  useEffect(() => {
    if (item?.id_produto)
      api
        .get(`/api/vendas/produto/${item.id_produto}`)
        .then((p) => setF((x) => ({ ...x, estoque: num(p.qtd_estoque) })))
        .catch(() => {});
  }, [item?.id_produto]);

  /** Carregar produto: preço lista = preço venda do cadastro, qtd 1, zera acréscimo e desconto */
  const escolher = (id: number, l: Linha | null) => {
    if (!id) return setF(ITEM_VAZIO);
    if (!l) {
      setErro(`Produto com ID ${id} não encontrado!`);
      return setF({ ...ITEM_VAZIO, id_produto: id });
    }
    setErro(null);
    setF({ ...ITEM_VAZIO, id_produto: id, descricao: l.descricao, referencia: l.referencia ?? '', preco_lista: num(l.preco_venda), preco_venda: r2(num(l.preco_venda)), estoque: num(l.qtd_estoque) });
  };

  const gravar = async () => {
    setErro(null);
    if (!f.id_produto) return setErro(`Produto com ID ${f.id_produto || 0} não encontrado!`);
    if (num(f.qtdade) <= 0) return setErro('Quantidade inválida!');
    if (liquido <= 0) return setErro('Preço/Valor inválido!');
    if (num(f.perc_desconto) > 90) return setErro('Desconto inválido! (máximo 90%)');
    setGravando(true);
    try {
      const corpo = { id_produto: f.id_produto, qtdade: f.qtdade, valor_acrescimo: f.valor_acrescimo, valor_desconto: f.valor_desconto };
      if (item) {
        await api.put(`/api/vendas/${venda.id}/itens/${item.id}`, corpo);
        onGravado();
        onFechar();
        return;
      }
      await api.post(`/api/vendas/${venda.id}/itens`, corpo);
      onGravado();
      // Como o Delphi: depois de gravar já abre um novo item
      setF(ITEM_VAZIO);
      setGravados((n) => n + 1);
      setGravando(false);
      setTimeout(() => idRef.current?.focus(), 0);
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };

  const mudarQtd = (q: number) =>
    setF((x) => {
      const b = r2(q * num(x.preco_venda));
      return { ...x, qtdade: q, valor_acrescimo: valorDe(num(x.perc_acrescimo), b), valor_desconto: valorDe(num(x.perc_desconto), b) };
    });

  return (
    <Janela
      titulo={item ? 'Alteração de Produto da Venda' : 'Inclusão de Produto da Venda'}
      subtitulo={`Venda nº ${venda.id} - ${venda.nome ?? ''}${gravados ? ` · ${gravados} produto(s) incluído(s)` : ''}`}
      onFechar={onFechar}
      largura="max-w-3xl"
      ocupado={gravando}
      rodape={<Rodape onCancelar={onFechar} onGravar={gravar} gravando={gravando} rotulo="Gravar Produto" />}
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        <Campo rotulo="Id Produto:" className="col-span-2 sm:col-span-4">
          <CampoPesquisa tipo="produtos" id={f.id_produto} nome={f.descricao} obrigatorio autoFocus={!item} inputRef={idRef} onEscolher={escolher} />
        </Campo>
        <Campo rotulo="Referência:" className="col-span-2">
          <input readOnly tabIndex={-1} className={INPUT_CLASS} value={f.referencia} />
        </Campo>
        <Campo rotulo="Qtdade:">
          <NumberField scale={2} value={f.qtdade} className={INPUT_CLASS} required onChange={(v) => mudarQtd(num(v))} />
        </Campo>
        <Campo rotulo="Estoque:">
          <input readOnly tabIndex={-1} className={`${INPUT_CLASS} text-right font-mono`} value={qtd(f.estoque)} />
        </Campo>
        <Campo rotulo="Preço Lista:">
          <ValorLeitura valor={f.preco_lista} />
        </Campo>
        <Campo rotulo="Preço Venda:">
          <ValorLeitura valor={f.preco_venda} />
        </Campo>
        <Campo rotulo="Total Bruto:" className="col-span-2">
          <ValorLeitura valor={bruto} />
        </Campo>
        <Campo rotulo="Acréscimos (%):">
          <NumberField scale={2} value={f.perc_acrescimo} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, perc_acrescimo: num(v), valor_acrescimo: valorDe(num(v), bruto) }))} />
        </Campo>
        <Campo rotulo="Acréscimos (R$):">
          <NumberField scale={2} value={f.valor_acrescimo} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, valor_acrescimo: num(v), perc_acrescimo: pctDe(num(v), bruto) }))} />
        </Campo>
        <Campo rotulo="Descontos (%):">
          <NumberField scale={2} value={f.perc_desconto} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, perc_desconto: num(v), valor_desconto: valorDe(num(v), bruto) }))} />
        </Campo>
        <Campo rotulo="Descontos (R$):">
          <NumberField scale={2} value={f.valor_desconto} className={INPUT_CLASS} onChange={(v) => setF((x) => ({ ...x, valor_desconto: num(v), perc_desconto: pctDe(num(v), bruto) }))} />
        </Campo>
        <Campo rotulo="Total Líquido:" className="col-span-2">
          <ValorLeitura valor={liquido} destaque />
        </Campo>
      </div>
    </Janela>
  );
};

// ============================================================ §3.10 Observações

export const FormObs: React.FC<{ venda: Linha; onFechar: () => void; onGravado: () => void }> = ({ venda, onFechar, onGravado }) => {
  const [obs, setObs] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  useEffect(() => {
    api
      .get(`/api/vendas/${venda.id}`)
      .then((v) => setObs(String(v.obs ?? '')))
      .catch((e) => setErro(e.message));
  }, [venda.id]);
  const gravar = async () => {
    setGravando(true);
    try {
      await api.put(`/api/vendas/${venda.id}/obs`, { obs });
      onGravado();
      onFechar();
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };
  return (
    <Janela titulo="Observações" subtitulo={`Venda nº ${venda.id} - ${venda.nome ?? ''}`} onFechar={onFechar} largura="max-w-5xl" ocupado={gravando} rodape={<Rodape onCancelar={onFechar} onGravar={gravar} gravando={gravando} rotulo="OK" />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <textarea autoFocus className={`${INPUT_CLASS} w-full h-[50vh] resize-none`} value={obs ?? ''} disabled={obs === null} onChange={(e) => setObs(e.target.value)} />
    </Janela>
  );
};

// ============================================================ Data/hora de saída (colunas editáveis da lista)

export const FormSaida: React.FC<{ venda: Linha; onFechar: () => void; onGravado: () => void }> = ({ venda, onFechar, onGravado }) => {
  const [data, setData] = useState(String(venda.data_saida ?? '').slice(0, 10));
  const [hora, setHora] = useState(String(venda.hora_saida ?? ''));
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const gravar = async () => {
    setGravando(true);
    try {
      await api.put(`/api/vendas/${venda.id}/saida`, { data_saida: data, hora_saida: hora });
      onGravado();
      onFechar();
    } catch (e: any) {
      setErro(e.message);
      setGravando(false);
    }
  };
  return (
    <Janela titulo="Saída da mercadoria" subtitulo={`Venda nº ${venda.id}`} onFechar={onFechar} largura="max-w-md" ocupado={gravando} rodape={<Rodape onCancelar={onFechar} onGravar={gravar} gravando={gravando} />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Data Saída:">
          <DateField value={data} onChange={setData} className={INPUT_CLASS} />
        </Campo>
        <Campo rotulo="Hora Saída:">
          <input
            className={`${INPUT_CLASS} text-center font-mono`}
            value={hora}
            placeholder="hh:mm"
            maxLength={5}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 4);
              setHora(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
            }}
          />
        </Campo>
      </div>
    </Janela>
  );
};
