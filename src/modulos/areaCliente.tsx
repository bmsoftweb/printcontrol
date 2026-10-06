import React, { useCallback, useEffect, useState } from 'react';
import { Printer, LogOut, Droplet, Wrench, Gauge, FileText, Star, Pencil, Loader2 } from 'lucide-react';
import type { ClienteSessao } from '../types';
import type { ThemeMode } from '../utils/theme';
import { ThemeToggle } from '../components/ThemeToggle';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../components/Janela';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NumberField } from '../components/NumberField';
import { AvisoErro } from '../components/AvisoErro';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../utils/formStyles';
import { api } from '../services/api';
import { lerSessao } from '../utils/session';

/** Contrato ativo do cliente (query base da Área do Cliente) */
interface Contrato {
  id: number;
  id_equip: number;
  marca_descricao: string | null;
  modelo: string | null;
  nr_serie: string | null;
  setor: string | null;
  rede_usb: string | null;
}

/** Colunas de rascunho do Delphi (qtdade_req, qtdade_cil, nome_req, os_problema, leituras), só no navegador */
interface Rascunho {
  qtdade: number;
  qtdadeCil: number;
  nome: string;
  obs: string;
  leituraPb: number;
  leituraColor: number;
}
const VAZIO: Rascunho = { qtdade: 0, qtdadeCil: 0, nome: '', obs: '', leituraPb: 0, leituraColor: 0 };

type Pagina = 'inicio' | 'pedido' | 'reparo' | 'leituras';
type Tipo = Exclude<Pagina, 'inicio'>;

const MSG_ENVIO: Record<Tipo, string> = {
  pedido: 'Sua requisição foi registrada! Agora é só aguardar!',
  reparo: 'Sua solicitação foi registrada! Agora é só aguardar!',
  leituras: 'Suas leituras foram enviadas!',
};
const CABECALHO: Record<Tipo, string> = { pedido: 'Requisição de Cartucho', reparo: 'Solicitação de Reparo', leituras: 'Leituras' };
const BOTAO_ENVIAR: Record<Tipo, string> = { pedido: 'Enviar Pedido', reparo: 'Enviar Solicitação', leituras: 'Enviar Leituras' };

const inteiroBR = (n: number) => n.toLocaleString('pt-BR');
const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const focar = (id: string) => setTimeout(() => document.getElementById(id)?.focus(), 0);

/** Área do Cliente (login com o código do cliente): pedidos de cartucho, reparos, leituras e impressoras */
export const AreaCliente: React.FC<{ cliente: ClienteSessao; onSair: () => void; theme: ThemeMode; onToggleTheme: () => void }> = ({
  cliente,
  onSair,
  theme,
  onToggleTheme,
}) => {
  const [pagina, setPagina] = useState<Pagina>('inicio');
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [rascunho, setRascunho] = useState<Record<number, Rascunho>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [editando, setEditando] = useState<Contrato | null>(null);
  const [avaliar, setAvaliar] = useState<{ tipo: Tipo; itens: Record<number, Rascunho> } | null>(null);
  const [confirmarAbandono, setConfirmarAbandono] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const mostrar = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const r = (id: number) => rascunho[id] ?? VAZIO;

  /** Cada opção recarrega os contratos e começa com o rascunho limpo (como o Delphi reabrindo a query) */
  const abrir = async (p: Tipo) => {
    setErro(null);
    setCarregando(true);
    try {
      setContratos(await api.get<Contrato[]>('/api/cliente/contratos'));
      setRascunho({});
      setPagina(p);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  const minhasImpressoras = async () => {
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch('/api/cliente/minhas-impressoras', { headers: { Authorization: `Bearer ${lerSessao()?.token ?? ''}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Falha ao gerar o relatório (HTTP ${res.status}).`);
      setPdfUrl(URL.createObjectURL(await res.blob()));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };

  const fecharPdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
  };

  /** Há algo a enviar nesta opção? */
  const temItem = (tipo: Tipo, x: Rascunho) =>
    tipo === 'pedido' ? x.qtdade > 0 || x.qtdadeCil > 0 : tipo === 'reparo' ? x.obs.trim() !== '' : x.leituraPb + x.leituraColor > 0;

  const pedirEnvio = (tipo: Tipo, itens: Record<number, Rascunho>) => {
    if (!Object.values(itens).some((x) => temItem(tipo, x))) {
      setErro('Nenhuma impressora foi preenchida. Clique 2x na impressora para informar.');
      return;
    }
    setAvaliar({ tipo, itens });
  };

  const enviar = async (nota: number, obsAvaliacao: string) => {
    if (!avaliar) return;
    const itens = Object.entries(avaliar.itens).map(([id, x]) => ({ contratoId: Number(id), ...x }));
    await api.post('/api/cliente/enviar', { tipo: avaliar.tipo, itens, nota, obsAvaliacao });
    const tipo = avaliar.tipo;
    setAvaliar(null);
    setRascunho({});
    setPagina('inicio');
    mostrar(MSG_ENVIO[tipo]);
  };

  const cancelar = () => {
    setErro(null);
    // Pedido com cartucho ou cilindro informado pede confirmação (o Delphi só olhava cartucho)
    if (pagina === 'pedido' && Object.values(rascunho).some((x) => x.qtdade > 0 || x.qtdadeCil > 0)) setConfirmarAbandono(true);
    else setPagina('inicio');
  };

  const tipo = pagina === 'inicio' ? null : pagina;

  return (
    <div className="min-h-screen bg-stone-100/70 dark:bg-stone-950 text-stone-900 dark:text-stone-100 flex flex-col font-sans antialiased">
      {toast && (
        <div className="fixed bottom-5 right-5 z-[70] bg-stone-900 text-white text-xs font-semibold py-3 px-4 rounded-xl shadow-2xl border border-stone-800 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      <header className="h-[var(--altura-topo)] min-h-14 shrink-0 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
        <div className="h-full max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black tracking-wider uppercase text-stone-800 dark:text-stone-100 leading-tight">PrintControl</div>
              <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">Área do Cliente{cliente.grupoApelido ? ` • ${cliente.grupoApelido}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="hidden sm:block text-sm font-bold truncate" title={cliente.nome}>
              {cliente.fantasia || cliente.nome}
            </span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="header" />
            <button type="button" onClick={onSair} title="Sair" className={BOTAO_SECUNDARIO}>
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        <div className="sm:hidden text-sm font-bold text-center">{cliente.fantasia || cliente.nome}</div>
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

        {pagina === 'inicio' && (
          <div className="max-w-md w-full mx-auto flex flex-col gap-3 mt-4">
            <BotaoInicio icone={Droplet} titulo="Pedido de Cartuchos" descricao="Cartuchos e cilindros para as suas impressoras" onClick={() => abrir('pedido')} />
            <BotaoInicio icone={Wrench} titulo="Solicitação de Reparos" descricao="Abra um chamado técnico" onClick={() => abrir('reparo')} />
            <BotaoInicio icone={Gauge} titulo="Digitar Leituras" descricao="Informe os contadores P/B e Color" onClick={() => abrir('leituras')} />
            <BotaoInicio icone={FileText} titulo="Minhas Impressoras" descricao="Relatório das impressoras locadas (PDF)" onClick={minhasImpressoras} />
            <BotaoInicio icone={LogOut} titulo="Sair" onClick={onSair} />
            {carregando && (
              <div className="flex items-center justify-center gap-2 text-xs text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
              </div>
            )}
          </div>
        )}

        {tipo && (
          <section className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-xs flex flex-col min-h-0">
            <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800">
              <h2 className="text-base font-bold">{CABECALHO[tipo]}</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">Selecione a Impressora (clique 2x)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold [&>th]:text-left">
                    {tipo === 'leituras' && <th className="!text-right">ID#</th>}
                    <th>Marca</th>
                    <th>Modelo</th>
                    <th>Setor</th>
                    {tipo === 'pedido' && (
                      <>
                        <th className="!text-right">Qtd.Cart.</th>
                        <th className="!text-right">Qtd.Cil.</th>
                      </>
                    )}
                    {tipo === 'reparo' && <th>Problema</th>}
                    {tipo === 'leituras' && (
                      <>
                        <th className="!text-right">P/B</th>
                        <th className="!text-right">Color</th>
                        <th className="!text-center">Tipo</th>
                      </>
                    )}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {contratos.map((c) => {
                    const x = r(c.id);
                    return (
                      <tr
                        key={c.id}
                        onDoubleClick={() => setEditando(c)}
                        className={`border-t border-stone-100 dark:border-stone-800 cursor-pointer select-none hover:bg-blue-50/60 dark:hover:bg-stone-800/60 [&>td]:px-3 [&>td]:py-2 ${
                          temItem(tipo, x) ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        {tipo === 'leituras' && <td className="text-right font-mono">{c.id_equip}</td>}
                        <td>{c.marca_descricao}</td>
                        <td>{c.modelo}</td>
                        <td>{c.setor}</td>
                        {tipo === 'pedido' && (
                          <>
                            <td className="text-right font-mono">{x.qtdade}</td>
                            <td className="text-right font-mono">{x.qtdadeCil}</td>
                          </>
                        )}
                        {tipo === 'reparo' && <td className="max-w-[240px] truncate">{x.obs}</td>}
                        {tipo === 'leituras' && (
                          <>
                            <td className="text-right font-mono">{inteiroBR(x.leituraPb)}</td>
                            <td className="text-right font-mono">{inteiroBR(x.leituraColor)}</td>
                            <td className="text-center">
                              <span
                                className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold text-white"
                                style={{ background: c.rede_usb === 'R' ? '#2E8B57' : '#FFD700' }}
                              >
                                {c.rede_usb === 'R' ? 'REDE' : 'USB'}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="text-right">
                          <button
                            type="button"
                            title="Informar"
                            onClick={() => setEditando(c)}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!contratos.length && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-stone-500">
                        Nenhuma impressora locada ativa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t border-stone-100 dark:border-stone-800 flex justify-end gap-2.5">
              <button type="button" className={BOTAO_SECUNDARIO} onClick={cancelar}>
                Cancelar
              </button>
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => pedirEnvio(tipo, rascunho)} disabled={!contratos.length}>
                {BOTAO_ENVIAR[tipo]}
              </button>
            </div>
          </section>
        )}
      </main>

      {editando && tipo && (
        <EditorLinha
          tipo={tipo}
          contrato={editando}
          atual={r(editando.id)}
          onFechar={() => setEditando(null)}
          onGravar={(novo) => {
            const proximo = { ...rascunho, [editando.id]: novo };
            setRascunho(proximo);
            setEditando(null);
            // Reparo: gravar já envia (como o Delphi)
            if (tipo === 'reparo') pedirEnvio('reparo', proximo);
          }}
        />
      )}

      {avaliar && <Avaliacao onEnviar={enviar} onFechar={() => setAvaliar(null)} />}

      {confirmarAbandono && (
        <ConfirmDialog
          titulo="Cancelar pedido"
          mensagem="Confirma abandonar as requisições feitas?"
          confirmar="Sim"
          tom="normal"
          onCancelar={() => setConfirmarAbandono(false)}
          onConfirmar={() => {
            setConfirmarAbandono(false);
            setRascunho({});
            setPagina('inicio');
          }}
        />
      )}

      {pdfUrl && (
        <Janela
          titulo="Minhas Impressoras"
          largura="max-w-5xl"
          onFechar={fecharPdf}
          rodape={
            <>
              <button type="button" className={BOTAO_SECUNDARIO} onClick={fecharPdf}>
                Fechar
              </button>
              <button
                type="button"
                className={BOTAO_PRIMARIO}
                onClick={() => (document.getElementById('pdf-minhas-impressoras') as HTMLIFrameElement | null)?.contentWindow?.print()}
              >
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            </>
          }
        >
          <iframe id="pdf-minhas-impressoras" title="Minhas Impressoras" src={pdfUrl} className="w-full h-[70vh] rounded-lg border border-stone-200 dark:border-stone-800" />
        </Janela>
      )}
    </div>
  );
};

const BotaoInicio: React.FC<{ icone: React.FC<{ className?: string }>; titulo: string; descricao?: string; onClick: () => void }> = ({
  icone: Icone,
  titulo,
  descricao,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-4 text-left p-4 rounded-2xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-md transition-all cursor-pointer"
  >
    <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 flex items-center justify-center shrink-0">
      <Icone className="w-5 h-5" />
    </div>
    <div className="min-w-0">
      <div className="text-sm font-bold">{titulo}</div>
      {descricao && <div className="text-xs text-stone-500 dark:text-stone-400">{descricao}</div>}
    </div>
  </button>
);

/** Popups do duplo clique: quantidades do pedido, problema do reparo ou leituras */
const EditorLinha: React.FC<{ tipo: Tipo; contrato: Contrato; atual: Rascunho; onFechar: () => void; onGravar: (r: Rascunho) => void }> = ({
  tipo,
  contrato,
  atual,
  onFechar,
  onGravar,
}) => {
  // Pedido: os valores digitados são SOMADOS à linha (negativo subtrai), começando com 1 cartucho e 0 cilindro.
  // Reparo: campos limpos ao abrir. Leituras: começam com o valor atual da linha.
  const [cart, setCart] = useState(tipo === 'pedido' ? '1' : '0');
  const [cil, setCil] = useState('0');
  const [nome, setNome] = useState(tipo === 'pedido' ? atual.nome : '');
  const [obs, setObs] = useState(tipo === 'pedido' ? atual.obs : '');
  const [pb, setPb] = useState(String(atual.leituraPb));
  const [color, setColor] = useState(String(atual.leituraColor));
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    focar('area-cliente-campo1');
  }, []);

  const gravar = () => {
    if (tipo === 'pedido') {
      onGravar({
        ...atual,
        qtdade: limitar(atual.qtdade + limitar(Number(cart) || 0, -99, 99), 0, 99),
        qtdadeCil: limitar(atual.qtdadeCil + limitar(Number(cil) || 0, -99, 99), 0, 99),
        nome: nome.trim(),
        obs: obs.trim(),
      });
    } else if (tipo === 'reparo') {
      if (!obs.trim()) {
        setErro('Digite brevemente o problema por favor!');
        focar('area-cliente-campo1');
        return;
      }
      onGravar({ ...atual, obs: obs.trim(), nome: nome.trim() });
    } else {
      onGravar({ ...atual, leituraPb: Math.max(0, Number(pb) || 0), leituraColor: Math.max(0, Number(color) || 0) });
    }
  };

  const campo = (rotulo: string, el: React.ReactNode) => (
    <label className={FIELD_CLASS}>
      <span className={LABEL_CLASS}>{rotulo}</span>
      {el}
    </label>
  );
  const input = `${INPUT_CLASS} w-full h-[38px]`;

  return (
    <Janela
      titulo={[contrato.marca_descricao, contrato.modelo].filter(Boolean).join(' ') || 'Impressora'}
      subtitulo={[contrato.setor, contrato.nr_serie && `Série ${contrato.nr_serie}`].filter(Boolean).join(' • ')}
      largura="max-w-md"
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar}>
            Cancelar
          </button>
          <button type="submit" form="form-area-cliente" className={BOTAO_PRIMARIO}>
            {tipo === 'reparo' ? 'Gravar e Enviar' : 'Gravar'}
          </button>
        </>
      }
    >
      <form
        id="form-area-cliente"
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          gravar();
        }}
      >
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        {tipo === 'pedido' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {campo('Cartucho(s):', <NumberField id="area-cliente-campo1" value={cart} onChange={setCart} allowNegative className={input} />)}
              {campo('Cilindro(s):', <NumberField value={cil} onChange={setCil} allowNegative className={input} />)}
            </div>
            <p className="text-[11px] text-stone-400 -mt-1">
              Somado ao que já está na linha ({atual.qtdade} cart. / {atual.qtdadeCil} cil.); negativo diminui. Digite “-” para trocar o sinal.
            </p>
            {campo('Digite Seu Nome:', <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={50} className={input} />)}
            {campo('Observação:', <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={255} className={input} />)}
          </>
        )}
        {tipo === 'reparo' && (
          <>
            {campo(
              'Descreva Brevemente o Problema:',
              <input id="area-cliente-campo1" required value={obs} onChange={(e) => setObs(e.target.value)} maxLength={255} className={input} />,
            )}
            {campo('Digite Seu Nome:', <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={50} className={input} />)}
          </>
        )}
        {tipo === 'leituras' && (
          <div className="grid grid-cols-2 gap-3">
            {campo('Leitura Preto e Branco:', <NumberField id="area-cliente-campo1" value={pb} onChange={setPb} className={input} />)}
            {campo('Leitura Color:', <NumberField value={color} onChange={setColor} className={input} />)}
          </div>
        )}
      </form>
    </Janela>
  );
};

/** ufrmAvaliacao: 1 a 5 estrelas + comentário; sempre começa zerada (o Delphi reaproveitava a anterior) */
const Avaliacao: React.FC<{ onEnviar: (nota: number, obs: string) => Promise<void>; onFechar: () => void }> = ({ onEnviar, onFechar }) => {
  const [nota, setNota] = useState(0);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (n: number, o: string) => {
    setOcupado(true);
    setErro(null);
    try {
      await onEnviar(n, o);
    } catch (e: any) {
      setErro(e.message);
      setOcupado(false);
    }
  };

  return (
    <Janela
      titulo="Como está o nosso atendimento ?"
      largura="max-w-md"
      ocupado={ocupado}
      onFechar={onFechar}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} disabled={ocupado} onClick={() => executar(0, '')}>
            Avaliar Depois
          </button>
          <button type="button" className={BOTAO_PRIMARIO} disabled={ocupado} onClick={() => executar(nota, obs.trim())}>
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />} Enviar
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        <div className="flex justify-center gap-2" role="radiogroup" aria-label="Nota do atendimento">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={nota === n}
              title={`${n} estrela${n > 1 ? 's' : ''}`}
              onClick={() => setNota(n)}
              className="p-1 cursor-pointer"
            >
              <Star className={`w-9 h-9 ${n <= nota ? 'fill-amber-400 text-amber-400' : 'text-stone-300 dark:text-stone-600'}`} />
            </button>
          ))}
        </div>
        <label className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Fique a vontade para fazer um comentário:</span>
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={255} rows={3} className={`${INPUT_CLASS} w-full resize-none`} />
        </label>
      </div>
    </Janela>
  );
};
