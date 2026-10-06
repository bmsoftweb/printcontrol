-- PrintControl Web (Vendas/NF-e): o XML autorizado da NF-e passa de 64 KB em notas com muitos itens.
-- Sem esta mudança o sistema guarda o XML grande no armazenamento e grava "arquivo:<url>" na coluna.
ALTER TABLE vendas MODIFY nfe_XML MEDIUMTEXT;
ALTER TABLE nfe MODIFY nfe_XML MEDIUMTEXT;
-- Carta de correção: descrição completa do evento (hoje cabe só o começo)
ALTER TABLE nfe_eventos MODIFY descricao VARCHAR(255);
