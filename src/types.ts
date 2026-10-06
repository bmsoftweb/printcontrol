export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'enum'
  | 'boolean'
  | 'password'
  /** CPF ou CNPJ (máscara pelo tamanho, dígitos verificadores conferidos); gravado só com dígitos */
  | 'cnpj'
  /** CEP: ao completar 8 dígitos, busca no ViaCEP e preenche logradouro, bairro, cidade e UF */
  | 'cep'
  /** Cor #RRGGBB */
  | 'cor'
  /** Imagem enviada para o storage; a coluna guarda o caminho público (/imagens/...) */
  | 'imagem';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  /** Campo de texto com endereço de imagem: a lista mostra a miniatura e o formulário, a prévia */
  miniatura?: boolean;
  /** Não aparece na ficha embaixo da lista (ex.: campos já resumidos em outro, como os de executor) */
  foraDaFicha?: boolean;
  /** Na exibição, o valor de outro campo vai antes deste ("Luis : Implementar..."); não é gravado */
  prefixo?: { campo: string; exceto?: string };
  hint?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  listed?: boolean;
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  /** Senha em texto puro (compatível com o Delphi) */
  senhaLegada?: boolean;
  /** Sim/Não gravado como texto: [ligado, desligado]. A API já entrega 1/0 */
  valores?: [string, string];
  options?: { value: string; label: string }[];
  ref?: { resource: string; labelField: string };
  scale?: number;
  maxLength?: number;
  /** Desabilita (e zera) o campo quando outro campo tiver o valor indicado */
  disabledWhen?: { field: string; equals: string };
  /** Campo numérico que aceita valor negativo */
  allowNegative?: boolean;
  /** Valor inicial na inclusão */
  default?: string | number | boolean;
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
  /** Título de seção mostrado no formulário antes do primeiro campo dela */
  secao?: string;
  /** Só aparece (e só é gravado) quando o campo indicado tem um destes valores; fora disso vai NULL */
  quando?: { campo: string; valores: string[] };
  /** Obrigatório quando o campo indicado tem um destes valores */
  obrigatorioQuando?: { campo: string; valores: string[] };
  /** Combo de chave estrangeira só com os registros em que esta coluna do recurso ligado tem o valor */
  refFiltro?: { campo: string; valor: string };
}

export type ResourceGroup = string;

/** Grade filha exibida ao selecionar uma linha da listagem (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  totalField?: string;
  editavel?: boolean;
  /** Filtro fixo além da chave (ex.: histórico de preços: tipo_item = 'INSUMO') */
  filtroFixo?: { field: string; op: 'eq'; value: string };
}

export interface ResourceDef {
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  icon: string;
  group: ResourceGroup;
  oculto?: boolean;
  /** Nível mínimo (letra; libera se usuarios.nivel <= este). Padrão A */
  nivel?: string;
  pk: string[];
  autoIncrement: boolean;
  labelField: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  details?: DetailDef[];
  /** Ao clicar numa linha, mostra embaixo a ficha com todos os campos (textos longos por inteiro) */
  ficha?: boolean;
  /** Atividades: além da lista, visões Semana e Mês (data_vencimento, hora_vencimento, duracao, assunto) */
  calendario?: boolean;
  /** Filtro aplicado só na visão Lista (o calendário mostra tudo), com o aviso que aparece no contador */
  filtroLista?: FiltroAvancado & { aviso: string };
  /**
   * Lista em árvore: registros com o mesmo `grupo` formam uma família; o de menor `ordem`
   * é a raiz e os demais aparecem como filhos (ex.: versões de uma proposta).
   */
  arvore?: { grupo: string; ordem: string };
  /** A lista tem o filtro "Só as minhas" (as do usuário logado) */
  minhas?: boolean;
  /** Campo Sim/Não com filtro rápido Todas/Sim/Não na barra da lista */
  filtroRapido?: string;
  /** Valor com que o filtro rápido abre: '1' = Sim, '0' = Não (sem ele: Todas) */
  filtroRapidoPadrao?: '1' | '0';
  fields: FieldDef[];
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  /** Letra de usuarios.nivel (A = administrador; menor = mais acesso) */
  nivel: string;
  /** Endereço aberto na tela inicial (usuarios.pagina_web) */
  paginaWeb: string | null;
}

/** Servidor (printcontrol_admin.servidores) escolhido no login: define o banco de trabalho */
export interface ServidorSessao {
  id: number;
  descricao: string;
}

export interface EmpresaSessao {
  id: number;
  apelido: string;
  nome: string;
  grupoId: number;
  grupoApelido: string;
  grupoNome: string;
}

/** Cliente logado na Área do Cliente (pessoas.id) */
export interface ClienteSessao {
  id: number;
  nome: string;
  fantasia: string | null;
  grupoId: number;
  grupoApelido: string;
}

/** Chave primária: INT AUTO_INCREMENT (chega como número do servidor) */
export type Id = number | string;

export type RegistroCrud = Record<string, any>;

/** Operadores aceitos pela busca avançada */
export type FiltroOp = 'contains' | 'eq' | 'ne' | 'gte' | 'lte';

export interface FiltroAvancado {
  field: string;
  op: FiltroOp;
  value: string;
}

export interface ListaPaginada {
  data: RegistroCrud[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OpcaoRef {
  value: string;
  label: string;
}

export interface DbConnectionStatus {
  connected: boolean;
  latencyMs: number;
  version?: string;
  database?: string;
  host?: string;
  port?: number;
  user?: string;
  error?: string;
  tableCounts?: Record<string, number>;
}

