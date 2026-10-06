import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, Loader2, PackageCheck, Search } from 'lucide-react';
import { api } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { AvisoErro } from '../../components/AvisoErro';
import { NumberField } from '../../components/NumberField';
import { DateField } from '../../components/DateField';
import { Toggle } from '../../components/Toggle';
import { INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { Botao, Carregando, Grade, dataBR, moeda, num, qtd, type Coluna, type Linha } from './comum';

const Rodape: React.FC<{ onCancelar: () => void; onOk: () => void; ocupado: boolean }> = ({ onCancelar, onOk, ocupado }) => (
  <>
    <button type="button" className={BOTAO_SECUNDARIO} onClick={onCancelar} disabled={ocupado}>
      Cancelar
    </button>
    <button type="button" className={BOTAO_PRIMARIO} onClick={onOk} disabled={ocupado}>
      {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
      Capturar para NF
    </button>
  </>
);

/** Rola até a linha do produto e a seleciona ("Pesquisar"/"Localizar") */
function localizar(linhas: Linha[], idProduto: string, setSel: (id: number) => void): string | null {
  const l = linhas.find((x) => String(x.id_produto) === idProduto.trim());
  if (!l) return `Produto ${idProduto} não está na lista.`;
  setSel(l.id_vendas_produtos);
  setTimeout(() => document.querySelector(`tr[data-id="${l.id_vendas_produtos}"]`)?.scrollIntoView({ block: 'center' }), 0);
  return null;
}

// ============================================================ §5.3 Escolher Quantidades Devolvidas

export const Devolucao: React.FC<{ venda: Linha; onFechar: () => void; onGravado: () => void }> = ({ venda, onFechar, onGravado }) => {
  const [dados, setDados] = useState<{ cliente: Linha; linhas: Linha[] } | null>(null);
  const [agora, setAgora] = useState<Record<number, number>>({});
  const [sel, setSel] = useState<number | null>(null);
  const [idProd, setIdProd] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api
      .get(`/api/vendas/${venda.id}/devolucao`)
      .then((d) => {
        setDados(d);
        // O que já foi capturado nesta devolução aparece como "devolvido agora"
        setAgora(Object.fromEntries(d.linhas.filter((l: Linha) => num(l.qtdade_nesta) > 0).map((l: Linha) => [l.id_vendas_produtos, num(l.qtdade_nesta)])));
      })
      .catch((e) => setErro(e.message));
  }, [venda.id]);

  const disponivel = (l: Linha) => num(l.qtdade) - num(l.qtdade_devol) + num(l.qtdade_nesta);
  const colunas: Coluna<Linha>[] = [
    { chave: 'data_venda', titulo: 'Data Venda', alinhar: 'centro', render: (r) => dataBR(r.data_venda) },
    { chave: 'vendedor1_idnome', titulo: 'Vendedor' },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Número', alinhar: 'dir' },
    { chave: 'id_produto', titulo: 'Id Prod.', alinhar: 'dir' },
    { chave: 'referencia', titulo: 'Referência' },
    { chave: 'descricao', titulo: 'Produto' },
    { chave: 'qtdade', titulo: 'Qtdade.', alinhar: 'dir', render: (r) => qtd(r.qtdade) },
    { chave: 'qtdade_devol', titulo: 'Qtd. Já Devol.', alinhar: 'dir', render: (r) => qtd(num(r.qtdade_devol) - num(r.qtdade_nesta)) },
    {
      chave: 'agora',
      titulo: 'Qtd. Devol. Agora',
      largura: 110,
      render: (r) => (
        <NumberField
          scale={2}
          value={agora[r.id_vendas_produtos] ?? 0}
          className={`${INPUT_CLASS} w-24 !py-1 ${num(agora[r.id_vendas_produtos]) > disponivel(r) + 1e-9 ? '!bg-rose-50 dark:!bg-rose-950/60' : ''}`}
          onChange={(v) => setAgora((a) => ({ ...a, [r.id_vendas_produtos]: num(v) }))}
        />
      ),
    },
    { chave: 'preco_unit_venda', titulo: 'Preço Unit.', alinhar: 'dir', render: (r) => moeda(r.preco_unit_venda) },
    { chave: 'valor_total_liquido_final', titulo: 'Valor Total', alinhar: 'dir', render: (r) => moeda(r.valor_total_liquido_final) },
    { chave: 'id_vendas_produtos', titulo: 'Id', alinhar: 'dir' },
  ];

  const capturar = async () => {
    setErro(null);
    const linhas = (dados?.linhas ?? []).filter((l) => num(agora[l.id_vendas_produtos]) > 0 || num(l.qtdade_nesta) > 0);
    for (const l of linhas) if (num(agora[l.id_vendas_produtos]) > disponivel(l) + 1e-9) return setErro('Qtdade. devolvida maior que quantidade da nota (+já devolvida)!');
    const enviar = linhas.filter((l) => num(agora[l.id_vendas_produtos]) > 0).map((l) => ({ id_vendas_produtos: l.id_vendas_produtos, qtd: num(agora[l.id_vendas_produtos]) }));
    if (!enviar.length) return setErro('Informe a quantidade devolvida de ao menos um produto.');
    setOcupado(true);
    try {
      await api.post(`/api/vendas/${venda.id}/devolucao`, { linhas: enviar });
      onGravado();
      onFechar();
    } catch (e: any) {
      setErro(e.message);
      setOcupado(false);
    }
  };

  return (
    <Janela titulo="Escolher Quantidades Devolvidas" onFechar={onFechar} largura="max-w-[95vw]" ocupado={ocupado} rodape={<Rodape onCancelar={onFechar} onOk={capturar} ocupado={ocupado} />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="flex flex-wrap items-end gap-3 mb-3 text-xs">
        <div>
          <div className={LABEL_CLASS}>Cliente:</div>
          <div className="font-semibold py-2">{dados ? `${dados.cliente.id} - ${dados.cliente.nome}` : '...'}</div>
        </div>
        <div className="ml-auto flex items-end gap-1.5">
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Id Produto:</span>
            <input className={`${INPUT_CLASS} w-24`} value={idProd} onChange={(e) => setIdProd(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && setErro(localizar(dados?.linhas ?? [], idProd, setSel))} />
          </label>
          <Botao icone={Search} onClick={() => setErro(localizar(dados?.linhas ?? [], idProd, setSel))}>
            Pesquisar
          </Botao>
        </div>
      </div>
      <div className="h-[60vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        {dados ? (
          <Grade colunas={colunas} linhas={dados.linhas} chave="id_vendas_produtos" selecionado={sel} onSelecionar={(r) => setSel(r.id_vendas_produtos)} agrupar={{ campo: 'grupo' }} vazio="Nenhuma venda finalizada deste cliente." />
        ) : (
          !erro && <Carregando />
        )}
      </div>
    </Janela>
  );
};

// ============================================================ §5.4 Captura e Fechamento de Pedidos

export const CapturaPedidos: React.FC<{ venda: Linha; onFechar: () => void; onGravado: () => void }> = ({ venda, onFechar, onGravado }) => {
  const [d1, setD1] = useState('2001-01-01');
  const [d2, setD2] = useState('2099-12-31');
  const [dados, setDados] = useState<{ cliente: Linha; linhas: Linha[] } | null>(null);
  const [cap, setCap] = useState<Record<number, boolean>>({});
  const [naoFat, setNaoFat] = useState<Record<number, number>>({});
  const [sel, setSel] = useState<number | null>(null);
  const [idProd, setIdProd] = useState('');
  const [pedido, setPedido] = useState('');
  const [menu, setMenu] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const carregar = () => {
    setCarregando(true);
    api
      .get(`/api/vendas/${venda.id}/pedidos?d1=${d1}&d2=${d2}`)
      .then((d) => {
        setDados(d);
        setCap({});
        setNaoFat({});
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [venda.id]);

  const linhas = dados?.linhas ?? [];
  const marcarPedido = (nr: string, valor: boolean) => setCap((c) => ({ ...c, ...Object.fromEntries(linhas.filter((l) => String(l.numero) === nr).map((l) => [l.id_vendas_produtos, valor])) }));
  const totalGeral = useMemo(() => linhas.reduce((s, l) => s + num(l.valor_total_liquido), 0), [linhas]);

  const colunas: Coluna<Linha>[] = [
    { chave: 'data_venda', titulo: 'Data Pedido', alinhar: 'centro', render: (r) => dataBR(r.data_venda) },
    { chave: 'vendedor1_idnome', titulo: 'Vendedor' },
    { chave: 'serie', titulo: 'Série', alinhar: 'centro' },
    { chave: 'numero', titulo: 'Número', alinhar: 'dir' },
    { chave: 'id_produto', titulo: 'Id. Prod.', alinhar: 'dir' },
    { chave: 'referencia', titulo: 'Referência' },
    { chave: 'descricao', titulo: 'Produto' },
    { chave: 'qtdade', titulo: 'Qtdade.', alinhar: 'dir', render: (r) => qtd(num(r.qtdade)) },
    {
      chave: 'cap',
      titulo: 'Cap.',
      alinhar: 'centro',
      render: (r) => (
        <span onDoubleClick={(e) => e.stopPropagation()}>
          <Toggle size="sm" checked={!!cap[r.id_vendas_produtos]} onChange={(v) => setCap((c) => ({ ...c, [r.id_vendas_produtos]: v }))} />
        </span>
      ),
    },
    {
      chave: 'naofat',
      titulo: 'Qtd. Devolv.',
      dica: 'Quantidade que NÃO será faturada agora',
      largura: 110,
      render: (r) => (
        <span onDoubleClick={(e) => e.stopPropagation()}>
          <NumberField scale={2} value={naoFat[r.id_vendas_produtos] ?? 0} className={`${INPUT_CLASS} w-24 !py-1`} onChange={(v) => setNaoFat((a) => ({ ...a, [r.id_vendas_produtos]: num(v) }))} />
        </span>
      ),
    },
    { chave: 'preco_unit_venda', titulo: 'Preço Un.', alinhar: 'dir', render: (r) => moeda(r.preco_unit_venda) },
    { chave: 'valor_total_liquido', titulo: 'Valor Total', alinhar: 'dir', render: (r) => moeda(r.valor_total_liquido) },
  ];

  const capturar = async () => {
    setErro(null);
    const marcadas = linhas.filter((l) => cap[l.id_vendas_produtos]);
    for (const l of marcadas) if (num(naoFat[l.id_vendas_produtos]) > num(l.qtdade)) return setErro('Qtdade. devolvida maior que quantidade do pedido!');
    if (!marcadas.length) return setErro('Marque ao menos um produto para capturar.');
    setOcupado(true);
    try {
      await api.post(`/api/vendas/${venda.id}/pedidos`, { linhas: marcadas.map((l) => ({ id_vendas_produtos: l.id_vendas_produtos, qtd_nao_faturar: num(naoFat[l.id_vendas_produtos]) })) });
      onGravado();
      onFechar();
    } catch (e: any) {
      setErro(e.message);
      setOcupado(false);
    }
  };

  return (
    <Janela titulo="Captura e Fechamento de Pedidos" onFechar={onFechar} largura="max-w-[95vw]" ocupado={ocupado} rodape={<Rodape onCancelar={onFechar} onOk={capturar} ocupado={ocupado} />}>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      <div className="flex flex-wrap items-end gap-3 mb-3 text-xs">
        <div>
          <div className={LABEL_CLASS}>Cliente:</div>
          <div className="font-semibold py-2">{dados ? `${dados.cliente.id} - ${dados.cliente.nome}` : '...'}</div>
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Localizar Produto Id:</span>
          <input className={`${INPUT_CLASS} w-24`} value={idProd} onChange={(e) => setIdProd(e.target.value.replace(/\D/g, ''))} />
        </label>
        <Botao icone={Search} onClick={() => setErro(localizar(linhas, idProd, setSel))}>
          Localizar
        </Botao>
        <Botao onClick={carregar} carregando={carregando}>
          Pesquisar
        </Botao>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Filtrar de:</span>
          <DateField value={d1} onChange={setD1} className={`${INPUT_CLASS} w-36`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>até:</span>
          <DateField value={d2} onChange={setD2} className={`${INPUT_CLASS} w-36`} />
        </label>
        <Botao icone={Filter} onClick={carregar}>
          Filtrar
        </Botao>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Marcar Pedido:</span>
          <input className={`${INPUT_CLASS} w-24`} value={pedido} onChange={(e) => setPedido(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div className="relative flex">
          <button type="button" onClick={() => marcarPedido(pedido, true)} className="h-[38px] px-3 rounded-l-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            Marcar
          </button>
          <button type="button" onClick={() => setMenu((m) => !m)} className="h-[38px] px-1.5 rounded-r-lg border border-l-0 border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer" title="Mais opções">
            <ChevronDown className="w-4 h-4" />
          </button>
          {menu && (
            <div className="absolute right-0 top-10 z-20 min-w-44 py-1 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl" onMouseLeave={() => setMenu(false)}>
              {[
                ['Marcar Todos', () => setCap(Object.fromEntries(linhas.map((l) => [l.id_vendas_produtos, true])))],
                ['Desmarcar Todos', () => setCap({})],
                ['Desmarcar Este', () => marcarPedido(pedido, false)],
              ].map(([t, fn]) => (
                <button
                  key={t as string}
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                  onClick={() => {
                    (fn as () => void)();
                    setMenu(false);
                  }}
                >
                  {t as string}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="h-[58vh] flex flex-col border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
        {dados ? (
          <Grade
            colunas={colunas}
            linhas={linhas}
            chave="id_vendas_produtos"
            carregando={carregando}
            selecionado={sel}
            onSelecionar={(r) => setSel(r.id_vendas_produtos)}
            onDuploClique={(r) => {
              // Duplo clique: põe o nº em "Marcar Pedido" e marca (ou desmarca) o pedido inteiro
              setPedido(String(r.numero));
              marcarPedido(String(r.numero), !cap[r.id_vendas_produtos]);
            }}
            agrupar={{ campo: 'grupo', resumo: (ls) => `Total do pedido: ${moeda(ls.reduce((s, l) => s + num(l.valor_total_liquido), 0))}` }}
            vazio="Nenhum pedido em aberto deste cliente."
            rodape={
              <tr>
                <td colSpan={colunas.length} className="px-2.5 py-1.5 text-right text-xs font-bold text-blue-900 dark:text-blue-300 bg-stone-50 dark:bg-stone-950 border-t border-stone-200 dark:border-stone-800">
                  Total geral: {moeda(totalGeral)}
                </td>
              </tr>
            }
          />
        ) : (
          !erro && <Carregando />
        )}
      </div>
    </Janela>
  );
};
