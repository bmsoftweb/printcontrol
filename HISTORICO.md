# Histórico de versões — PrintControl Web

## 0.0.3 — 05/10/2026
- Banco mais rápido: índices novos (database/migrations/005_indices.sql) para a última leitura do contador, o pré-faturamento, o histórico SNMP e as listas por grupo/empresa.
- Histórico SNMP ("Todas") reescrito para usar o índice por data: de ~130 ms para ~4 ms.

## 0.0.2 — 05/10/2026 (primeira versão publicada)
- Conversão completa do PrintControl Delphi (UniGUI) para a stack do crmweb (Express + Vite + React + Tailwind + MySQL), sobre a mesma estrutura de banco do Delphi.
- Login com Servidor (printcontrol_admin.servidores), usuário interno ou código do cliente, escolha da empresa, níveis de acesso do Delphi.
- Cadastros: Clientes (contrato HTML, mapa, inventário), Equipamentos, Produtos (árvore de grupos), Tabelas (planos, séries, bancos, cidades, etiquetas VOID), Empresas e Usuários.
- Locações: contratos, leituras com franquia/excedente, agrupamento, conferência, pré-leituras com captura SNMP.
- Faturamento e Financeiro: notas de débito, boletos BB/Santander/Ailos, remessa e retorno CNAB240, contas a receber.
- Ordens de Serviço, Requisições e Consultas configuráveis; Área do Cliente; Vendas com NF-e (menu de desenvolvimento).

## 0.0.1 — 05/10/2026
- Início da conversão.
