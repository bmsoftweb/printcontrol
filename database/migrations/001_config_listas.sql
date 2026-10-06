-- PrintControl Web: preferências das listas (larguras, ordem e colunas visíveis) por usuário.
-- Sem esta coluna o app funciona com as listas no padrão; só não grava "Salvar Configuração".
-- O PrintControl Delphi não usa esta coluna (ele tinha a tabela grids, sem uso).
ALTER TABLE usuarios ADD COLUMN config_listas TEXT NULL;
