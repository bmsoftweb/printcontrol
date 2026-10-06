/**
 * Registro central de metadados das tabelas do banco printcontrol (mesma estrutura do PrintControl Delphi).
 *
 * ÚNICA fonte de verdade das telas de manutenção:
 *  - o backend monta o SQL com whitelist de colunas (evita SQL injection);
 *  - o frontend recebe via GET /api/meta/resources e desenha as telas de CRUD.
 *
 * Os recursos ficam em server/recursos/<módulo>.ts. Escopo: o Delphi filtrava todo cadastro pelo id_grupo
 * da empresa ativa e os movimentos também pelo id_empresa; aqui o scopeSql usa :grupo e :empresa (trocados
 * pelo servidor pelos ids da sessão) e `tenant` diz quais colunas preencher na inclusão.
 */
import { RECURSOS_MODULOS } from './recursos/index.js';

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
  /** Nome da coluna no MySQL */
  name: string;
  /** Rótulo exibido na interface */
  label: string;
  type: FieldType;
  /** Campo de texto com endereço de imagem: a lista mostra a miniatura e o formulário, a prévia */
  miniatura?: boolean;
  /** Não aparece na ficha embaixo da lista (ex.: campos já resumidos em outro, como os de executor) */
  foraDaFicha?: boolean;
  /** Na exibição, o valor de outro campo vai antes deste ("Luis : Implementar..."); não é gravado */
  prefixo?: { campo: string; exceto?: string };
  /** Texto auxiliar exibido abaixo do campo no formulário */
  hint?: string;
  placeholder?: string;
  required?: boolean;
  /** Campo apenas leitura (gerado pelo banco ou pelo sistema): nunca vai em INSERT/UPDATE */
  readOnly?: boolean;
  /** Exibido na grade de listagem */
  listed?: boolean;
  /** Participa da busca textual (LIKE) da barra de busca rápida */
  searchable?: boolean;
  /** Aparece no painel de busca avançada */
  filterable?: boolean;
  /** Senha conferida em texto puro pelo PrintControl Delphi (mesma tabela): gravada como digitada, nunca devolvida */
  senhaLegada?: boolean;
  /** Sim/Não gravado como texto (o Delphi usa char(1) 'S'/'N'): [valor ligado, valor desligado]. A API troca por 1/0 */
  valores?: [string, string];
  /** Opções para type === 'enum' */
  options?: { value: string; label: string }[];
  /** Chave estrangeira: carrega o combo a partir de outro recurso */
  ref?: { resource: string; labelField: string };
  /** Casas decimais para type === 'decimal' */
  scale?: number;
  maxLength?: number;
  /** Desabilita (e zera) o campo quando outro campo tem o valor indicado */
  disabledWhen?: { field: string; equals: string };
  /** Campo numérico que aceita valor negativo (o sinal alterna ao digitar "-") */
  allowNegative?: boolean;
  /** Valor inicial na inclusão */
  default?: string | number | boolean;
  /** Largura sugerida da coluna na grade */
  width?: 'xs' | 'sm' | 'md' | 'lg';
  /** Colunas que o campo ocupa no formulário (de 4); sem isto vale a regra padrão */
  span?: number;
  /**
   * Coluna calculada só da lista: expressão SQL sobre o alias "t" (ex.: subconsulta).
   * Não existe na tabela, não é gravada e não aparece no formulário.
   */
  sql?: string;
  /** Título de seção mostrado no formulário antes do primeiro campo dela */
  secao?: string;
  /** Só aparece (e só é gravado) quando o campo indicado tem um destes valores; fora disso vai NULL */
  quando?: { campo: string; valores: string[] };
  /** Obrigatório quando o campo indicado tem um destes valores */
  obrigatorioQuando?: { campo: string; valores: string[] };
  /** Combo de chave estrangeira só com os registros em que esta coluna do recurso ligado tem o valor */
  refFiltro?: { campo: string; valor: string };
}

/** Grade filha exibida no rodapé da listagem quando uma linha é selecionada (mestre-detalhe) */
export interface DetailDef {
  resource: string;
  foreignKey: string;
  label: string;
  /** Campo decimal do filho totalizado no rodapé do painel */
  totalField?: string;
  /** Painel com incluir, editar e excluir (formulário genérico numa janela), com a chave do pai preenchida */
  editavel?: boolean;
  /** Filtro fixo além da chave (ex.: histórico de preços: tipo_item = 'INSUMO') */
  filtroFixo?: { field: string; op: 'eq'; value: string };
}

export interface ResourceDef {
  /** Identificador usado nas rotas: /api/crud/:resource */
  name: string;
  table: string;
  label: string;
  labelSingular: string;
  description: string;
  /** Ícone lucide-react renderizado na sidebar */
  icon: string;
  /** Agrupamento na sidebar */
  group: string;
  /** Nível mínimo (letra de usuarios.nivel; menor = mais poder, como no Delphi: libera se nivel <= este). Padrão 'A' */
  nivel?: string;
  /** Colunas preenchidas pelo servidor na inclusão com o grupo/empresa da sessão (nunca vêm do navegador) */
  tenant?: { grupo?: string; empresa?: string };
  /** Não aparece no menu (só como detalhe de outro recurso) */
  oculto?: boolean;
  /** Chave primária */
  pk: string[];
  /** PK numerada pelo MySQL (AUTO_INCREMENT) */
  autoIncrement: boolean;
  /** Campo usado como rótulo em combos de chave estrangeira */
  labelField: string;
  /** SELECT próprio para os combos (colunas value e label), quando o rótulo depende de outra tabela */
  optionsSql?: string;
  /** Filtro sobre o alias "t" aplicado em toda consulta; :grupo e :empresa = ids da sessão */
  scopeSql?: string;
  defaultSort: { field: string; dir: 'asc' | 'desc' };
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Campo Sim/Não com filtro rápido Todas/Sim/Não na barra da lista (ex.: ativo) */
  filtroRapido?: string;
  /** Valor com que o filtro rápido abre: '1' = Sim, '0' = Não (sem ele: Todas) */
  filtroRapidoPadrao?: '1' | '0';
  details?: DetailDef[];
  /** Ao clicar numa linha, mostra embaixo a ficha com todos os campos (textos longos por inteiro) */
  ficha?: boolean;
  fields: FieldDef[];
}

export const RESOURCES: ResourceDef[] = RECURSOS_MODULOS;

export const RESOURCE_MAP: Record<string, ResourceDef> = Object.fromEntries(
  RESOURCES.map((r) => [r.name, r]),
);

export function getResource(name: string): ResourceDef | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_MAP, name) ? RESOURCE_MAP[name] : null;
}

/** Colunas graváveis: exclui readOnly e a PK */
export function writableFields(resource: ResourceDef): FieldDef[] {
  return resource.fields.filter((f) => !f.readOnly && !resource.pk.includes(f.name));
}

/** Expressão SQL da coluna: a própria coluna da tabela ou a expressão da coluna calculada */
export function colunaSql(resource: ResourceDef, nome: string): string {
  return resource.fields.find((f) => f.name === nome)?.sql ?? `t.${nome}`;
}

/** Todas as colunas conhecidas — whitelist de ordenação e filtros */
export function columnNames(resource: ResourceDef): string[] {
  return resource.fields.map((f) => f.name);
}
