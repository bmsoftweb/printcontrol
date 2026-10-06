import {
  Home,
  Users,
  Printer,
  Package,
  Table2,
  FileSignature,
  Receipt,
  ShoppingCart,
  Boxes,
  Wallet,
  ClipboardList,
  Wrench,
  BarChart3,
  Building2,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { Usuario } from '../types';

export interface ItemMenu {
  id: string;
  label: string;
  descricao: string;
  icone: LucideIcon;
  /**
   * Nível mínimo, como o Hint dos itens do menu do Delphi: o item aparece se usuarios.nivel <= nivel
   * (letra menor = mais acesso; A = administrador vê tudo)
   */
  nivel: string;
  /** Só aparece com VITE_MENU_DEV=1 (no Delphi: arquivo dev.txt na pasta do sistema) */
  dev?: boolean;
}

const MENU_DEV = import.meta.env.VITE_MENU_DEV === '1';

/** Menu principal do PrintControl, na ordem do Delphi */
const GRUPOS: { titulo: string; itens: ItemMenu[] }[] = [
  {
    titulo: 'Visão Geral',
    itens: [{ id: 'inicio', label: 'Início', descricao: 'Página inicial do usuário', icone: Home, nivel: 'Z' }],
  },
  {
    titulo: 'Cadastros',
    itens: [
      { id: 'clientes', label: 'Clientes', descricao: 'Clientes e fornecedores, contrato, mapa e inventário', icone: Users, nivel: 'A' },
      { id: 'equipamentos', label: 'Equipamentos', descricao: 'Impressoras, marcas e tipos', icone: Printer, nivel: 'A' },
      { id: 'produtos', label: 'Produtos', descricao: 'Produtos, famílias e grupos', icone: Package, nivel: 'A' },
      { id: 'tabelas', label: 'Tabelas', descricao: 'Planos, séries, bancos, cidades e etiquetas VOID', icone: Table2, nivel: 'A' },
    ],
  },
  {
    titulo: 'Movimento',
    itens: [
      { id: 'locacoes', label: 'Locações', descricao: 'Contratos de locação, leituras e pré-leituras', icone: FileSignature, nivel: 'A' },
      { id: 'faturamento', label: 'Faturamento', descricao: 'Faturamento das leituras, notas de débito e boletos', icone: Receipt, nivel: 'A' },
      { id: 'vendas', label: 'Vendas', descricao: 'Vendas, devoluções e NF-e', icone: ShoppingCart, nivel: 'A', dev: true },
      { id: 'estoque', label: 'Estoque', descricao: 'Kardex e custo médio', icone: Boxes, nivel: 'A', dev: true },
      { id: 'financeiro', label: 'Financeiro', descricao: 'Contas a receber, baixas e retorno bancário', icone: Wallet, nivel: 'A' },
      { id: 'requisicoes', label: 'Requisições', descricao: 'Requisições de material', icone: ClipboardList, nivel: 'A', dev: true },
      { id: 'os', label: 'Ordens Serviço', descricao: 'Ordens de serviço, peças e pedidos dos clientes', icone: Wrench, nivel: 'T' },
      { id: 'consultas', label: 'Consultas', descricao: 'Consultas e relatórios configuráveis', icone: BarChart3, nivel: 'T' },
    ],
  },
  {
    titulo: 'Sistema',
    itens: [
      { id: 'empresas', label: 'Empresas', descricao: 'Empresas do grupo e modelo de contrato', icone: Building2, nivel: 'A' },
      { id: 'usuarios', label: 'Usuários', descricao: 'Usuários, níveis e empresas liberadas', icone: UserCog, nivel: 'A' },
    ],
  },
];

const ITENS = GRUPOS.flatMap((g) => g.itens);

/** Letra do nível do usuário (vazio = sem acesso a nada além do Início) */
const nivelDe = (u: Usuario | null) => String(u?.nivel || 'Z').charAt(0).toUpperCase();

/** O usuário acessa a opção: mesma regra do menu do Delphi (Hint >= nível); itens de desenvolvimento só com a flag */
export function podeAcessar(usuario: Usuario | null, id: string): boolean {
  const item = ITENS.find((i) => i.id === id);
  if (!usuario || !item) return false;
  if (item.dev && !MENU_DEV) return false;
  return nivelDe(usuario) <= item.nivel;
}

/** Opções do menu visíveis para o usuário, agrupadas como na barra lateral */
export function gruposDoMenu(usuario: Usuario | null): { titulo: string; itens: ItemMenu[] }[] {
  return GRUPOS.map((g) => ({ ...g, itens: g.itens.filter((i) => podeAcessar(usuario, i.id)) })).filter((g) => g.itens.length);
}

export const itemDoMenu = (id: string) => ITENS.find((i) => i.id === id);
