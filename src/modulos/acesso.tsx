import React, { useEffect, useRef, useState } from 'react';
import { Building2, FileText, KeyRound, Loader2, Save } from 'lucide-react';
import type { Tela } from './tipos';
import type { RegistroCrud } from '../types';
import { api, getRecord, updateRecord } from '../services/api';
import { BotaoAcao } from '../components/MenuAcoes';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../components/Janela';
import { Toggle } from '../components/Toggle';
import { EditorHtml } from '../components/EditorHtml';
import { AvisoErro } from '../components/AvisoErro';
import { VARIAVEIS_CONTRATO_CLIENTE } from './clientes/contrato';


/** "Liberar Usuário para as Empresas": um toggle por empresa do grupo, gravado na hora */
const EmpresasLiberadas: React.FC<{ usuario: RegistroCrud; onFechar: () => void }> = ({ usuario, onFechar }) => {
  const [lista, setLista] = useState<{ id: number; apelido: string; nome_comercial: string; acesso: boolean }[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState<number | null>(null);

  useEffect(() => {
    api.get(`/api/usuarios/${usuario.id}/empresas`).then(setLista).catch((e) => setErro(e.message));
  }, [usuario.id]);

  const mudar = async (id: number, acesso: boolean) => {
    setGravando(id);
    setErro(null);
    try {
      await api.put(`/api/usuarios/${usuario.id}/empresas/${id}`, { acesso });
      setLista((l) => l?.map((e) => (e.id === id ? { ...e, acesso } : e)) ?? null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setGravando(null);
    }
  };

  return (
    <Janela titulo="Liberar usuário para as empresas" subtitulo={`${usuario.nome} (${usuario.email})`} onFechar={onFechar} largura="max-w-lg">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {!lista ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
              <th className="py-2 font-semibold">Empresa</th>
              <th className="py-2 font-semibold text-center w-36">Pode acessar?</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((e) => (
              <tr key={e.id} className="border-b border-stone-100 dark:border-stone-800/70">
                <td className="py-2">
                  <div className="font-semibold text-stone-800 dark:text-stone-100">{e.apelido}</div>
                  <div className="text-stone-500 dark:text-stone-400">{e.nome_comercial}</div>
                </td>
                <td className="py-2">
                  <div className="flex justify-center">
                    {gravando === e.id ? <Loader2 className="w-4 h-4 animate-spin text-stone-400" /> : <Toggle checked={e.acesso} onChange={(v) => mudar(e.id, v)} size="sm" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Janela>
  );
};

/** Botão "Contrato" de Empresas: edita o modelo de contrato (empresas_filiais.contrato_padrao) */
const ContratoPadrao: React.FC<{ empresa: RegistroCrud; onFechar: () => void; onToast: (m: string) => void }> = ({ empresa, onFechar, onToast }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    getRecord('empresas', empresa.id)
      .then((r) => setHtml(String(r.contrato_padrao ?? '')))
      .catch((e) => setErro(e.message));
  }, [empresa.id]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await updateRecord('empresas', empresa.id, { contrato_padrao: html ?? '' });
      onToast('Contrato padrão gravado.');
      onFechar();
    } catch (e: any) {
      setErro(e.message);
      setSalvando(false);
    }
  };

  return (
    <Janela
      titulo="Contrato padrão"
      subtitulo={`${empresa.apelido} — modelo copiado para o contrato de cada cliente`}
      onFechar={onFechar}
      largura="max-w-5xl"
      ocupado={salvando}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={salvando}>
            Voltar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={salvar} disabled={salvando || html === null}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
      {html === null ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
        </div>
      ) : (
        <EditorHtml valor={html} onChange={setHtml} variaveis={VARIAVEIS_CONTRATO_CLIENTE} />
      )}
    </Janela>
  );
};

/** Botão "Upload .PFX": envia o certificado da empresa da linha */
const UploadPfx: React.FC<{ empresa: RegistroCrud; recarregar: () => void; onToast: (m: string) => void }> = ({ empresa, recarregar, onToast }) => {
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviando(true);
    try {
      await api.arquivo(`/api/empresas/${empresa.id}/pfx?nome=${encodeURIComponent(arquivo.name)}`, arquivo);
      onToast(`Certificado ${arquivo.name} enviado.`);
      recarregar();
    } catch (e: any) {
      onToast(e.message);
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => enviar(e.target.files?.[0])} />
      <BotaoAcao icone={KeyRound} titulo="Upload .PFX" descricao="Envia o certificado digital (.pfx) da empresa" carregando={enviando} onClick={() => input.current?.click()} />
    </>
  );
};

const AcoesUsuario: React.FC<{ row: RegistroCrud }> = ({ row }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <BotaoAcao icone={Building2} titulo="Empresas" descricao="Empresas que o usuário pode acessar" onClick={() => setAberto(true)} />
      {aberto && <EmpresasLiberadas usuario={row} onFechar={() => setAberto(false)} />}
    </>
  );
};

const AcoesEmpresa: React.FC<{ row: RegistroCrud; recarregar: () => void; onToast: (m: string) => void }> = ({ row, recarregar, onToast }) => {
  const [contrato, setContrato] = useState(false);
  return (
    <>
      <BotaoAcao icone={FileText} titulo="Contrato" descricao="Modelo de contrato da empresa" onClick={() => setContrato(true)} />
      <UploadPfx empresa={row} recarregar={recarregar} onToast={onToast} />
      {contrato && <ContratoPadrao empresa={row} onFechar={() => setContrato(false)} onToast={onToast} />}
    </>
  );
};

export const TELAS_ACESSO: Record<string, Tela> = {
  usuarios: {
    recurso: 'usuarios',
    ganchos: () => ({ acoesLinha: (row) => <AcoesUsuario row={row} /> }),
  },
  empresas: {
    recurso: 'empresas',
    ganchos: ({ onToast }) => ({ acoesLinha: (row, { recarregar }) => <AcoesEmpresa row={row} recarregar={recarregar} onToast={onToast} /> }),
  },
};
