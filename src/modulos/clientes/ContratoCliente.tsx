import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Loader2, Mail, Printer, Save } from 'lucide-react';
import { api, baixarArquivo, getRecord, updateRecord } from '../../services/api';
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EditorHtml } from '../../components/EditorHtml';
import { AvisoErro } from '../../components/AvisoErro';
import { paginaContrato, VARIAVEIS_CONTRATO_CLIENTE } from './contrato';
import type { Cliente } from './tipos';

/**
 * Aba Contrato: contrato HTML do cliente (pessoas.contrato). Grava sozinho a cada 5 s quando muda
 * (timer TTcontratos do Delphi) e também ao voltar (o Delphi perdia os últimos segundos).
 */
export const ContratoCliente: React.FC<{ cliente: Cliente; onVoltar: () => void; onToast: (m: string) => void }> = ({ cliente, onVoltar, onToast }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [situacao, setSituacao] = useState<'gravado' | 'pendente' | 'gravando'>('gravado');
  const [erro, setErro] = useState<string | null>(null);
  const [confirmaCopia, setConfirmaCopia] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const atual = useRef('');
  const sujo = useRef(false);
  const id = cliente.id;

  useEffect(() => {
    getRecord('pessoas', id)
      .then((r) => {
        atual.current = String(r.contrato ?? '');
        setHtml(atual.current);
      })
      .catch((e) => setErro(e.message));
  }, [id]);

  const gravar = useCallback(async () => {
    if (!sujo.current) return;
    sujo.current = false;
    setSituacao('gravando');
    try {
      await updateRecord('pessoas', id, { contrato: atual.current });
      setSituacao(sujo.current ? 'pendente' : 'gravado');
    } catch (e: any) {
      sujo.current = true;
      setSituacao('pendente');
      setErro(e.message);
      throw e;
    }
  }, [id]);

  useEffect(() => {
    const t = window.setInterval(() => gravar().catch(() => {}), 5000);
    return () => {
      window.clearInterval(t);
      gravar().catch(() => {}); // saiu da tela por outro caminho (menu): não perde o que falta gravar
    };
  }, [gravar]);

  const mudou = (novo: string) => {
    atual.current = novo;
    sujo.current = true;
    setSituacao('pendente');
  };

  const executar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    setErro(null);
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  const voltar = () => executar('voltar', async () => {
    await gravar();
    onVoltar();
  });

  const copiarPadrao = async () => {
    const r = await api.get<{ html: string }>(`/api/clientes/${id}/contrato-padrao`);
    mudou(r.html);
    setHtml(r.html);
    setVersao((v) => v + 1);
    setConfirmaCopia(false);
  };

  /** Impressão do navegador (o Delphi chamava print() no iframe do editor) */
  const imprimir = () => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    f.srcdoc = paginaContrato(atual.current, `Contrato - ${cliente.nome}`);
    f.onload = () => {
      f.contentWindow?.print();
      setTimeout(() => f.remove(), 60_000);
    };
    document.body.appendChild(f);
  };

  const enviar = () => executar('email', async () => {
    await gravar();
    const r = await api.post<{ enviado: boolean; para?: string; motivo?: string }>(`/api/clientes/${id}/contrato/email`);
    if (r.enviado) return onToast(`Contrato enviado para ${r.para}.`);
    await baixarArquivo(`/api/clientes/${id}/contrato.pdf`, `contrato_${String(id).padStart(6, '0')}.pdf`);
    onToast(r.motivo || 'PDF do contrato baixado.');
  });

  const rotuloSituacao = { gravado: 'Gravado', pendente: 'Alterações a gravar…', gravando: 'Gravando…' }[situacao];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center gap-2">
        <button type="button" className={BOTAO_SECUNDARIO} onClick={voltar} disabled={!!ocupado}>
          {ocupado === 'voltar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4" />}
          Voltar
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={imprimir} disabled={html === null}>
          <Printer className="w-4 h-4" />
          Imprimir Contrato
        </button>
        <button type="button" className={BOTAO_PRIMARIO} onClick={() => executar('salvar', async () => { sujo.current = true; await gravar(); onToast('Contrato gravado.'); })} disabled={html === null || !!ocupado}>
          {ocupado === 'salvar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={() => setConfirmaCopia(true)} disabled={html === null || !!ocupado}>
          <Copy className="w-4 h-4" />
          Copiar Padrão
        </button>
        <button type="button" className={BOTAO_SECUNDARIO} onClick={enviar} disabled={html === null || !!ocupado}>
          {ocupado === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Enviar por Email
        </button>
        <div className="ml-auto text-right min-w-0">
          <div className="text-xs font-semibold text-stone-700 dark:text-stone-200 truncate">Contrato do Cliente: {cliente.nome}</div>
          <div className={`text-[11px] ${situacao === 'gravado' ? 'text-emerald-600' : 'text-amber-600'}`}>{rotuloSituacao}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
        {html === null ? (
          !erro && (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
            </div>
          )
        ) : (
          <EditorHtml key={versao} valor={html} onChange={mudou} variaveis={VARIAVEIS_CONTRATO_CLIENTE} altura="min-h-[480px] max-h-[calc(100vh-260px)]" />
        )}
      </div>
      {confirmaCopia && (
        <ConfirmDialog
          titulo="Copiar o contrato padrão?"
          mensagem="Confirma sobrepor o contrato? O texto atual será trocado pelo contrato padrão da empresa ativa, com os dados deste cliente."
          confirmar="Sobrepor"
          tom="normal"
          onConfirmar={copiarPadrao}
          onCancelar={() => setConfirmaCopia(false)}
        />
      )}
    </div>
  );
};
