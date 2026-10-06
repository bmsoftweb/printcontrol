import type { FieldDef } from '../schema.js';

/** Cadastro comum: PK id numerada pelo MySQL, todas as operações liberadas */
export const BASE = { pk: ['id'], autoIncrement: true, canCreate: true, canUpdate: true, canDelete: true };

/** Cadastro do grupo (o Delphi filtrava toda tabela com id_grupo pelo grupo da empresa ativa) */
export const DO_GRUPO = { scopeSql: 't.id_grupo = :grupo', tenant: { grupo: 'id_grupo' } };

/** Movimento da empresa ativa (contratos, faturamento, OS...) */
export const DA_EMPRESA = { scopeSql: 't.id_grupo = :grupo AND t.id_empresa = :empresa', tenant: { grupo: 'id_grupo', empresa: 'id_empresa' } };

export const opcoes = (pares: [string, string][]) => pares.map(([value, label]) => ({ value, label }));

export const ID: FieldDef = { name: 'id', label: 'ID', type: 'number', readOnly: true, listed: true, width: 'xs' };

/** Sim/Não em char(1) 'S'/'N' (padrão do Delphi), mostrado como toggle */
export const sn = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, type: 'boolean', valores: ['S', 'N'], ...extra });

export const UFS = opcoes(
  'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ').map((u) => [u, u] as [string, string]),
);
