import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { createRecord, getRecord, updateRecord } from '../../services/api';
import { Janela, BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from '../../components/Janela';
import { Toggle } from '../../components/Toggle';
import { AvisoErro } from '../../components/AvisoErro';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../../utils/formStyles';
import { documentoValido, mascaraDocumento } from '../../lib/documento';
import type { Cliente, OpcoesClientes } from './tipos';

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

/** Novo registro (OnNewRecord do Delphi): pessoa física, cliente */
const NOVO: Cliente = { fj: 'F', cliente_flag: 1, fornec_flag: 0 };

const ABAS = ['Dados', 'Endereço', 'Contato', 'Cobrança', 'Observações'] as const;
type Aba = (typeof ABAS)[number];

const maiusculo = (v: unknown, max: number) => String(v ?? '').toUpperCase().slice(0, max);

/**
 * Cadastro do cliente/fornecedor. No Delphi a edição era direto na grade; aqui é uma janela com abas,
 * com busca de CEP (ViaCEP) e conferência do CPF/CNPJ.
 */
export const FormCliente: React.FC<{
  registro: Cliente | null;
  opcoes: OpcoesClientes | null;
  onFechar: () => void;
  onGravou: (id: number) => void;
}> = ({ registro, opcoes, onFechar, onGravou }) => {
  const [d, setD] = useState<Cliente | null>(registro ? null : { ...NOVO });
  const orig = useRef<Cliente>(registro ? {} : { ...NOVO });
  const [aba, setAba] = useState<Aba>('Dados');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const ultimoCep = useRef('');

  useEffect(() => {
    if (!registro) return;
    getRecord('pessoas', registro.id)
      .then((r) => {
        // CPF/CNPJ antigo gravado com máscara: compara só os dígitos (sem mudar, não é reenviado nem reconferido)
        orig.current = { ...r, cpf_cnpj: String(r.cpf_cnpj ?? '').replace(/\D/g, '') };
        ultimoCep.current = String(r.endereco_cep ?? '');
        setD(r);
      })
      .catch((e) => setErro(e.message));
  }, [registro]);

  const set = (campo: string, valor: unknown) => setD((a) => ({ ...a!, [campo]: valor }));

  const buscarCep = async (cep: string) => {
    ultimoCep.current = cep;
    setErro(null);
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (r.erro) throw new Error('CEP não encontrado.');
      setD((a) => ({
        ...a!,
        endereco: maiusculo(r.logradouro, 50) || a!.endereco,
        endereco_bairro: maiusculo(r.bairro, 30) || a!.endereco_bairro,
        endereco_cidade: maiusculo(r.localidade, 30) || a!.endereco_cidade,
        endereco_uf: maiusculo(r.uf, 2) || a!.endereco_uf,
        endereco_id_cidade: String(r.ibge ?? '').slice(0, 7) || a!.endereco_id_cidade,
      }));
    } catch (e: any) {
      setErro(e.message === 'CEP não encontrado.' ? e.message : 'Não foi possível consultar o CEP (ViaCEP).');
    } finally {
      setBuscandoCep(false);
    }
  };

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d) return;
    setErro(null);
    const doc = String(d.cpf_cnpj ?? '').replace(/\D/g, '');
    if (!String(d.nome ?? '').trim()) return setErro('Informe o nome.'), setAba('Dados');
    if (doc && !documentoValido(doc) && doc !== String(orig.current.cpf_cnpj ?? '').replace(/\D/g, '')) {
      return setErro('CPF/CNPJ inválido: confira os dígitos.'), setAba('Dados');
    }
    const dados: Cliente = { ...d, cpf_cnpj: doc };
    // Alteração: só os campos mudados (um CPF antigo inválido não impede gravar o resto); inclusão: só os preenchidos
    const payload: Cliente = {};
    for (const [k, v] of Object.entries(dados)) {
      if (k === 'id' || k === 'contrato' || k === 'id_grupo') continue;
      if (k === 'senha') {
        if (v) payload.senha = v;
      } else if (registro ? String(v ?? '') !== String(orig.current[k] ?? '') : v !== '' && v !== null && v !== undefined) payload[k] = v;
    }
    if (registro && !Object.keys(payload).length) return onFechar();
    setGravando(true);
    try {
      const id = registro ? (await updateRecord('pessoas', registro.id, payload), Number(registro.id)) : Number((await createRecord('pessoas', payload)).id);
      onGravou(id);
    } catch (err: any) {
      setErro(err.message);
      setGravando(false);
    }
  };

  const texto = (campo: string, rotulo: string, max: number, extra: { span?: string; required?: boolean; autoFocus?: boolean; tipo?: string; hint?: string } = {}) => (
    <label className={`${FIELD_CLASS} ${extra.span ?? ''}`}>
      <span className={LABEL_CLASS}>{rotulo}</span>
      <input
        type={extra.tipo ?? 'text'}
        className={`${INPUT_CLASS} w-full`}
        value={d?.[campo] ?? ''}
        maxLength={max}
        required={extra.required}
        autoFocus={extra.autoFocus}
        autoComplete={extra.tipo === 'password' ? 'new-password' : 'off'}
        onChange={(e) => set(campo, e.target.value)}
      />
      {extra.hint && <span className={HINT_CLASS}>{extra.hint}</span>}
    </label>
  );

  const combo = (campo: string, rotulo: string, itens: { value: string; label: string }[], vazio: string, nenhum = '') => {
    const atual = String(d?.[campo] ?? '');
    const valor = atual === vazio ? '' : atual;
    return (
      <label className={FIELD_CLASS}>
        <span className={LABEL_CLASS}>{rotulo}</span>
        <select className={`${INPUT_CLASS} w-full cursor-pointer`} value={valor} onChange={(e) => set(campo, e.target.value || vazio)}>
          <option value="">{nenhum || '(nenhum)'}</option>
          {valor && !itens.some((i) => i.value === valor) && <option value={valor}>{valor}</option>}
          {itens.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const doc = String(d?.cpf_cnpj ?? '').replace(/\D/g, '');
  const docRuim = doc.length > 0 && !documentoValido(doc);

  return (
    <Janela
      titulo={registro ? `Cliente nº ${registro.id}` : 'Novo cliente / fornecedor'}
      subtitulo={registro ? registro.nome : 'Clientes / Fornecedores'}
      onFechar={onFechar}
      ocupado={gravando}
      largura="max-w-4xl"
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={gravando}>
            Cancelar
          </button>
          <button type="submit" form="form-cliente" className={BOTAO_PRIMARIO} disabled={gravando || !d}>
            {gravando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Gravar
          </button>
        </>
      }
    >
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mb-3" />}
      {!d ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
        </div>
      ) : (
        <form id="form-cliente" onSubmit={gravar} noValidate>
          <div className="flex gap-1 border-b border-stone-200 dark:border-stone-800 mb-4">
            {ABAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAba(a)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px cursor-pointer ${
                  aba === a ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          <div className={aba === 'Dados' ? 'grid grid-cols-1 sm:grid-cols-4 gap-3' : 'hidden'}>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>Pessoa</span>
              <select className={`${INPUT_CLASS} w-full cursor-pointer`} value={d.fj ?? 'F'} onChange={(e) => set('fj', e.target.value)}>
                <option value="F">Física</option>
                <option value="J">Jurídica</option>
              </select>
            </label>
            <div className={`${FIELD_CLASS} justify-end pb-2`}>
              <Toggle checked={Number(d.cliente_flag) === 1} onChange={(v) => set('cliente_flag', v ? 1 : 0)} label="Cliente" />
            </div>
            <div className={`${FIELD_CLASS} justify-end pb-2 sm:col-span-2`}>
              <Toggle checked={Number(d.fornec_flag) === 1} onChange={(v) => set('fornec_flag', v ? 1 : 0)} label="Fornecedor" />
            </div>
            {texto('nome', 'Nome', 50, { span: 'sm:col-span-2', required: true, autoFocus: !registro })}
            {texto('fantasia', 'Fantasia', 50, { span: 'sm:col-span-2' })}
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>CPF/CNPJ</span>
              <input
                className={`${INPUT_CLASS} w-full font-mono`}
                value={mascaraDocumento(d.cpf_cnpj)}
                inputMode="numeric"
                onChange={(e) => set('cpf_cnpj', e.target.value.replace(/\D/g, '').slice(0, 14))}
              />
              {docRuim && <span className="text-[11px] font-medium text-rose-600">{doc.length === 11 || doc.length === 14 ? 'Dígitos não conferem' : 'Incompleto'}</span>}
            </label>
            {texto('rg', 'RG/IE', 25)}
            {texto('id_integracao', 'Integração', 25)}
          </div>

          <div className={aba === 'Endereço' ? 'grid grid-cols-1 sm:grid-cols-4 gap-3' : 'hidden'}>
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>CEP</span>
              <div className="relative">
                <input
                  className={`${INPUT_CLASS} w-full font-mono pr-8`}
                  value={d.endereco_cep ?? ''}
                  inputMode="numeric"
                  onChange={(e) => {
                    const cep = e.target.value.replace(/\D/g, '').slice(0, 8);
                    set('endereco_cep', cep);
                    if (cep.length === 8 && cep !== ultimoCep.current) buscarCep(cep);
                  }}
                />
                <button
                  type="button"
                  title="Buscar o endereço pelo CEP (ViaCEP)"
                  onClick={() => String(d.endereco_cep ?? '').length === 8 && buscarCep(d.endereco_cep)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-blue-600 cursor-pointer"
                >
                  {buscandoCep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </button>
              </div>
            </label>
            {texto('endereco', 'Endereço', 50, { span: 'sm:col-span-2' })}
            {texto('endereco_nr', 'Nr.', 10)}
            {texto('endereco_complemento', 'Complemento', 50, { span: 'sm:col-span-2' })}
            {texto('endereco_bairro', 'Bairro', 30, { span: 'sm:col-span-2' })}
            {texto('endereco_cidade', 'Cidade', 30, { span: 'sm:col-span-2' })}
            <label className={FIELD_CLASS}>
              <span className={LABEL_CLASS}>UF</span>
              <select className={`${INPUT_CLASS} w-full cursor-pointer`} value={d.endereco_uf ?? ''} onChange={(e) => set('endereco_uf', e.target.value)}>
                <option value="" />
                {d.endereco_uf && !UFS.includes(d.endereco_uf) && <option value={d.endereco_uf}>{d.endereco_uf}</option>}
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            {texto('endereco_id_cidade', 'ID Cidade (IBGE)', 7)}
            {combo(
              'regiao',
              'Região',
              (opcoes?.regioes ?? []).map((r) => ({ value: String(r.id), label: r.descricao ? `${r.id} - ${r.descricao}` : String(r.id) })),
              '',
            )}
          </div>

          <div className={aba === 'Contato' ? 'grid grid-cols-1 sm:grid-cols-3 gap-3' : 'hidden'}>
            {texto('fone_fixo', 'Fone (1)', 25)}
            {texto('fone_celular1', 'Fone (2)', 25)}
            {texto('fone_celular2', 'Fone (3)', 25)}
            {texto('email', 'e-Mail', 100, { span: 'sm:col-span-2', hint: 'Vários e-mails: separe com ";"' })}
            {texto('senha', 'Senha (Área do Cliente)', 15, {
              tipo: 'password',
              hint: registro ? (registro.tem_senha === 'S' ? 'Definida. Em branco: mantém a atual' : 'Sem senha') : undefined,
            })}
            {texto('representante_legal_nome', 'Nome Repres. Legal', 50, { span: 'sm:col-span-2' })}
            {texto('representante_legal_cpf', 'CPF Repres. Legal', 20)}
          </div>

          <div className={aba === 'Cobrança' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'hidden'}>
            {combo(
              'id_banco',
              'Banco',
              (opcoes?.bancos ?? []).map((b) => ({ value: String(b.id), label: b.apelido || b.nome })),
              '0',
            )}
            {combo(
              'id_plano',
              'Cobrança',
              (opcoes?.planos ?? []).map((p) => ({ value: String(p.id), label: p.descricao || String(p.id) })),
              '0',
            )}
            {texto('obs_nf', 'Observação para NF', 255, { span: 'sm:col-span-2' })}
          </div>

          <div className={aba === 'Observações' ? '' : 'hidden'}>
            <textarea
              className={`${INPUT_CLASS} w-full min-h-[220px] resize-y`}
              value={d.obs ?? ''}
              onChange={(e) => set('obs', e.target.value)}
              aria-label="Observações"
            />
          </div>
        </form>
      )}
    </Janela>
  );
};
