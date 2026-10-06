import type { ResourceDef } from '../schema.js';
import { BASE, DO_GRUPO, ID, UFS, opcoes, sn } from './comum.js';

/**
 * Clientes / Fornecedores (ufrmClientes, tabela pessoas). A tela é própria (src/modulos/clientes.tsx), mas
 * a gravação passa pelo CRUD genérico (/api/crud/pessoas) e outros módulos usam o recurso nos combos:
 * ref: { resource: 'pessoas', labelField: 'nome' }.
 * Banco, cobrança e região não usam `ref` (os recursos são de outros módulos): os combos vêm de /api/clientes/opcoes.
 */
export const RECURSOS_CLIENTES: ResourceDef[] = [
  {
    ...BASE,
    ...DO_GRUPO,
    name: 'pessoas',
    table: 'pessoas',
    label: 'Clientes / Fornecedores',
    labelSingular: 'Cliente',
    description: 'Clientes e fornecedores do grupo',
    icon: 'Users',
    group: 'cadastros',
    oculto: true,
    labelField: 'nome',
    defaultSort: { field: 'nome', dir: 'asc' },
    fields: [
      ID,
      { name: 'fj', label: 'Pessoa', type: 'enum', options: opcoes([['F', 'Física'], ['J', 'Jurídica']]), default: 'F', listed: true, width: 'xs', secao: 'Dados' },
      sn('cliente_flag', 'Cliente', { default: true, listed: true, secao: 'Dados' }),
      sn('fornec_flag', 'Fornecedor', { default: false, listed: true, secao: 'Dados' }),
      { name: 'nome', label: 'Nome', type: 'text', required: true, maxLength: 50, listed: true, searchable: true, secao: 'Dados' },
      { name: 'fantasia', label: 'Fantasia', type: 'text', maxLength: 50, listed: true, searchable: true, secao: 'Dados' },
      { name: 'cpf_cnpj', label: 'CPF/CNPJ', type: 'cnpj', listed: true, searchable: true, secao: 'Dados' },
      { name: 'rg', label: 'RG/IE', type: 'text', maxLength: 25, secao: 'Dados' },
      { name: 'id_integracao', label: 'Integração', type: 'text', maxLength: 25, secao: 'Dados' },
      { name: 'endereco_cep', label: 'CEP', type: 'text', maxLength: 8, secao: 'Endereço' },
      { name: 'endereco', label: 'Endereço', type: 'text', maxLength: 50, secao: 'Endereço' },
      { name: 'endereco_nr', label: 'Nr.', type: 'text', maxLength: 10, secao: 'Endereço' },
      { name: 'endereco_complemento', label: 'Complemento', type: 'text', maxLength: 50, secao: 'Endereço' },
      { name: 'endereco_bairro', label: 'Bairro', type: 'text', maxLength: 30, secao: 'Endereço' },
      { name: 'endereco_cidade', label: 'Cidade', type: 'text', maxLength: 30, listed: true, searchable: true, filterable: true, secao: 'Endereço' },
      { name: 'endereco_uf', label: 'UF', type: 'enum', options: UFS, listed: true, filterable: true, width: 'xs', secao: 'Endereço' },
      { name: 'endereco_id_cidade', label: 'ID Cidade (IBGE)', type: 'text', maxLength: 7, secao: 'Endereço' },
      { name: 'regiao', label: 'Região', type: 'text', maxLength: 5, filterable: true, secao: 'Endereço' },
      { name: 'endereco_lat', label: 'Latitude', type: 'decimal', scale: 7, allowNegative: true, secao: 'Endereço' },
      { name: 'endereco_lon', label: 'Longitude', type: 'decimal', scale: 7, allowNegative: true, secao: 'Endereço' },
      { name: 'fone_fixo', label: 'Fone (1)', type: 'text', maxLength: 25, listed: true, secao: 'Contato' },
      { name: 'fone_celular1', label: 'Fone (2)', type: 'text', maxLength: 25, secao: 'Contato' },
      { name: 'fone_celular2', label: 'Fone (3)', type: 'text', maxLength: 25, secao: 'Contato' },
      { name: 'email', label: 'e-Mail', type: 'text', maxLength: 100, listed: true, searchable: true, secao: 'Contato' },
      {
        name: 'senha',
        label: 'Senha (Área do Cliente)',
        type: 'password',
        senhaLegada: true,
        maxLength: 15,
        secao: 'Contato',
        hint: 'Em branco na alteração: mantém a atual. Gravada como no PrintControl Delphi',
      },
      { name: 'id_banco', label: 'Banco', type: 'number', secao: 'Cobrança' },
      { name: 'id_plano', label: 'Cobrança', type: 'text', maxLength: 3, secao: 'Cobrança' },
      { name: 'obs_nf', label: 'Observação para NF', type: 'text', maxLength: 255, span: 4, secao: 'Cobrança' },
      { name: 'representante_legal_nome', label: 'Nome Repres. Legal', type: 'text', maxLength: 50, secao: 'Representante legal' },
      { name: 'representante_legal_cpf', label: 'CPF Repres. Legal', type: 'text', maxLength: 20, secao: 'Representante legal' },
      { name: 'obs', label: 'Observações', type: 'textarea', span: 4, secao: 'Observações' },
      { name: 'contrato', label: 'Contrato (HTML)', type: 'textarea', span: 4, secao: 'Contrato' },
    ],
  },
];
