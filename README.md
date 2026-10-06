# PrintControl Web

Controle de locação de impressoras — conversão do PrintControl Delphi (UniGUI, `D:\bmsoftweb\printcontrol`)
para a mesma stack, layout e padrões do crmweb: Express + Vite + React 19 + Tailwind 4 + mysql2, com telas de
cadastro dirigidas por metadados.

## Como rodar

```bash
npm install
npm run dev
```

Sobe em <http://localhost:3000> (`PORT` muda a porta). Build de produção: `npm run build` e `npm start`.
Copie `.env.example` para `.env` e preencha o MySQL, `SESSION_SECRET` e o SMTP.

## Banco

Usa **a mesma estrutura** do banco do Delphi (`../extras/printcontrol_origem_schema.sql`), para os dois sistemas
poderem rodar juntos durante a migração. Por isso:

- `usuarios.senha` e `pessoas.senha` continuam em texto puro (o Delphi confere assim);
- sim/não continuam como `char(1)` `'S'`/`'N'` (a API troca por 1/0 para as telas);
- as triggers do Delphi (`bi_log`, `bi_fatur`, `bi_equipamentos_leituras`) continuam valendo: toda gravação passa
  por `comUsuario()` (`server/db.ts`), que define `@id_usuario`, `@id_grupo`, `@id_empresa` e `@ip_usuario`.

Mudanças de estrutura sugeridas ficam em `database/migrations/` e são rodadas à mão:

| Script | O que faz |
| --- | --- |
| `001_config_listas.sql` | `usuarios.config_listas` (larguras/ordem das colunas por usuário). Sem ela as listas funcionam no padrão |
| `002_consulta_contratos_duplicados.sql` | Reescreve a consulta "Contratos Duplicados" sem tabela temporária (a web só executa SELECT/WITH nas Consultas) |
| `003_nfe_xml.sql` | XML da NF-e em MEDIUMTEXT e descrição do evento com 255 caracteres |
| `004_nivel_tecnico.sql` | Nível T (técnico) em `usuarios_niveis` |
| `005_indices.sql` | Índices para as consultas mais usadas (última leitura, pré-faturamento, leituras SNMP, listas por grupo/empresa) |

Desenvolvimento: servidor 1 (`printcontrol_xdemo`, seed `database/seed_desenvolvimento.sql`). Dados reais: servidor 2 (`printcontrol_000001`, cópia do banco do Delphi).

## Acesso

- **Servidor** (como no bi): o primeiro campo do login é o número do servidor. As credenciais do banco de trabalho
  vêm de `printcontrol_admin.servidores` (id, descricao, mysql_host/port/user/password/database), no MySQL do `.env`
  (`MYSQL_ADMIN_DATABASE`). O token guarda o servidor e cada requisição usa o banco dele (`server/db.ts`: o `pool`
  aponta para o banco da requisição via AsyncLocalStorage). Hoje: 1 = `printcontrol_xdemo`, 2 = `printcontrol_000001`.
- **Usuário interno**: e-mail + senha (`usuarios`). Liberado para mais de uma empresa (`empresas_usuarios`)? A tela
  pede a escolha, como o "Escolha a Empresa" do Delphi. O grupo ativo é o da empresa escolhida.
- **Cliente** (Área do Cliente): código do cliente (`pessoas.id`) + senha (`pessoas.senha`).
- Token assinado (HMAC, 30 dias) em `Authorization: Bearer`; usuário, empresa e liberação são relidos a cada requisição.
- **Níveis**: letra de `usuarios.nivel`; quanto menor, mais acesso (A vê tudo). Cada opção do menu tem a letra mínima
  do Delphi (`src/utils/menu.ts`) e o servidor recusa quem não tem o nível (`nivel` nos recursos).
- Todo cadastro é filtrado pelo grupo ativo e os movimentos também pela empresa ativa (`scopeSql` com `:grupo`/`:empresa`).

## Estrutura

| Onde | O quê |
| --- | --- |
| `server/app.ts` | Login, sessão, Meus Dados, preferências das listas |
| `server/crud.ts`, `server/schema.ts` | CRUD genérico por metadados (escopo, níveis, S/N, senha legada) |
| `server/recursos/<módulo>.ts` | Metadados das tabelas de cada módulo |
| `server/<módulo>.ts` | Regras e rotas próprias de cada módulo (registrados em `server/rotas.ts`) |
| `src/modulos/<módulo>.tsx` | Telas de cada módulo (registradas em `src/modulos/index.ts`) |
| `src/utils/menu.ts` | Menu principal (ordem e níveis do Delphi) |
| `../extras/specs/` | Especificação funcional de cada tela do Delphi, usada na conversão |

## Menu

| Opção | Nível | Delphi |
| --- | --- | --- |
| Clientes, Equipamentos, Produtos, Tabelas | A | ufrmClientes, ufrmEquip, ufrmProdutos, ufrmTabelas |
| Locações | A | ufrmContratos |
| Faturamento | A | ufrmFatur |
| Financeiro | A | ufrmReceber |
| Ordens Serviço, Consultas | T | ufrmOS, ufrmConsultas |
| Empresas, Usuários | A | ufrmEmpresas, ufrmUsuarios |
| Vendas, Estoque, Requisições | só com `VITE_MENU_DEV=1` | no Delphi, só com `dev.txt` |

**Início** abre a página inicial do usuário (`usuarios.pagina_web`), como a aba Home do Delphi. **Meus Dados**
(ícone ao lado do nome) troca e-mail, senha e página inicial.

## Testes

`npx vitest run` (cálculos de locação, boletos BB/Santander/Ailos, CNAB, fórmulas de imposto, vendas, OS, VOID, Área do Cliente).

## NF-e

Código trazido do nfeWeb em `server/nfe/` (XML, assinatura, validação XSD, SOAP, DANFE, eventos). Certificado A1 de
`empresas_filiais.arquivo_pfx`/`senha_pfx`; ambiente e UF da empresa. Envio real à SEFAZ ainda não testado (sem certificado na base de testes).

## Pré-leituras e Scan Impressoras

"Capturar Leitura" / "Capturar Todas" (Locações › Pré-Leituras) buscam a última coleta do Scan Impressoras SNMP até o
dia da leitura no banco `PRINTERS_DATABASE` (padrão `printers_000000`, mesmo host do banco de trabalho), ligando
`impressora.numero_serie` ao nr. de série do contrato. Impressora monocromática: contador de vida (`paginas`);
colorida: `paginas_preto` / `paginas_color`. Sem coleta, a linha fica ZERADO. "Listar Leituras" (pré-leitura e contrato)
mostra as coletas do mesmo banco, com cliente e setor do contrato da série.
