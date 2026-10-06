-- PrintControl Web: índices para as consultas mais usadas (medidos com EXPLAIN ANALYZE no printcontrol_000001).
-- Só acrescenta índices: não muda dados nem colunas, e o PrintControl Delphi também se beneficia.

-- Última leitura do contador ao lançar leitura (Locações): era varredura de contratos + ordenação, ~70 ms por leitura
ALTER TABLE locacao_leituras ADD INDEX idx_leit_serie_cor_data (nr_serie, color, data_leitura, id);
-- Pré-faturamento (leituras ainda não faturadas)
ALTER TABLE locacao_leituras ADD INDEX idx_leit_status_fatur (status_fatur, id_cliente);

-- Leituras SNMP (equipamentos_leituras é a tabela que mais cresce: o coletor grava sem parar)
-- "Todas"/histórico por data: era varredura da tabela inteira + ordenação, ~130 ms
ALTER TABLE equipamentos_leituras ADD INDEX idx_eqleit_inclusao (datahora_inclusao, id);
-- Captura da pré-leitura e histórico de um equipamento (substitui o índice só por equip_ns)
ALTER TABLE equipamentos_leituras ADD INDEX idx_eqleit_ns_data (equip_ns, data_leitura, datahora_inclusao);
ALTER TABLE equipamentos_leituras DROP INDEX IDX_equipamentos_leituras_equi;

-- Listas filtradas pelo grupo/empresa ativos
ALTER TABLE locacao_contratos ADD INDEX idx_contr_grupo_empresa (id_grupo, id_empresa, ativo);
ALTER TABLE locacao_contratos ADD INDEX idx_contr_serie (nr_serie, color);
ALTER TABLE fatur_notas ADD INDEX idx_notas_grupo_empresa (id_grupo, id_empresa, status);
ALTER TABLE fatur ADD INDEX idx_fatur_grupo_empresa (id_grupo, id_empresa);

-- Busca de cliente por CPF/CNPJ
ALTER TABLE pessoas ADD INDEX idx_pessoas_cpf_cnpj (cpf_cnpj);
