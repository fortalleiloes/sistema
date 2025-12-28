---
description: Refatoração do Sistema para Modelo de Assessoria Imobiliária
---

# Refatoração: Sistema de Assessoria Imobiliária

## Objetivo
Transformar o sistema de gestão individual de imóveis em uma plataforma para assessores imobiliários gerenciarem múltiplos clientes (assessorados), onde cada cliente possui sua própria carteira de imóveis.

## Arquitetura Nova

### Hierarquia de Dados
```
Assessor (Usuário Principal)
└── Carteiras de Clientes
    └── Imóveis do Cliente
        └── Custos/Cálculos
```

### Mudanças Principais

1. **Nível de Assessor**
   - O usuário logado é o assessor
   - Dashboard mostra visão consolidada de todos os clientes
   - Acesso a todas as carteiras que gerencia

2. **Carteiras de Clientes**
   - Cada assessorado tem uma carteira individual
   - Dados do cliente: nome, CPF, contato, observações
   - Status da assessoria (ativo, inativo, prospecto)
   - Data de início da assessoria

3. **Imóveis dentro da Carteira**
   - "Meus Imóveis" agora fica dentro de cada carteira
   - Cada imóvel pertence a um cliente específico
   - Mantém todas as funcionalidades atuais (cálculos, custos, etc)

## Fases de Implementação

### FASE 1: Estrutura de Banco de Dados

#### 1.1 Criar nova tabela `clientes`
```sql
CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessor_id INTEGER NOT NULL,
    nome TEXT NOT NULL,
    cpf TEXT,
    email TEXT,
    telefone TEXT,
    status TEXT DEFAULT 'ativo', -- ativo, inativo, prospecto
    data_inicio DATE,
    observacoes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assessor_id) REFERENCES users(id) ON DELETE CASCADE
);
```

#### 1.2 Adicionar índices
```sql
CREATE INDEX IF NOT EXISTS idx_clientes_assessor ON clientes(assessor_id);
CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes(status);
```

#### 1.3 Migrar tabela `carteira_imoveis`
- Adicionar coluna `cliente_id`
- Manter `user_id` (assessor) para queries rápidas
- Criar índice composto

```sql
ALTER TABLE carteira_imoveis ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_carteira_cliente ON carteira_imoveis(cliente_id);
CREATE INDEX IF NOT EXISTS idx_carteira_assessor_cliente ON carteira_imoveis(user_id, cliente_id);
```

#### 1.4 Script de migração de dados
- Criar cliente "default" para cada assessor
- Migrar imóveis existentes para esse cliente default
- Permitir que assessor reorganize depois

### FASE 2: Backend (API Routes)

#### 2.1 Rotas de Clientes
- `GET /api/clientes` - Listar todos os clientes do assessor
- `POST /api/clientes` - Criar novo cliente
- `GET /api/clientes/:id` - Detalhes de um cliente
- `PUT /api/clientes/:id` - Atualizar cliente
- `DELETE /api/clientes/:id` - Remover cliente (soft delete?)
- `GET /api/clientes/:id/dashboard` - Dashboard do cliente específico

#### 2.2 Modificar Rotas Existentes
- `/api/carteira/imoveis` → Adicionar filtro por `cliente_id`
- `/api/carteira/dashboard` → Pode mostrar visão consolidada ou por cliente
- `/historico` → Filtrar por cliente
- Todas as rotas de imóveis precisam validar `cliente_id`

#### 2.3 Middleware de Autorização
- Verificar se o assessor tem acesso ao cliente
- Verificar se o imóvel pertence ao cliente correto
- Logs de auditoria para ações em carteiras de clientes

### FASE 3: Frontend - Nova Navegação

#### 3.1 Dashboard Principal do Assessor
- Card para cada cliente com resumo:
  - Nome do cliente
  - Quantidade de imóveis
  - Valor total investido
  - ROI médio
  - Status da assessoria
- Botão "Adicionar Novo Cliente"
- Filtros: status, data, valor
- Busca por nome/CPF

#### 3.2 Página de Carteira do Cliente
- Acessada ao clicar em um cliente
- Header com dados do cliente
- Tabs:
  - **Imóveis** (antiga "Meus Imóveis")
  - **Dashboard** (KPIs do cliente)
  - **Histórico de Custos**
  - **Relatórios**
  - **Configurações do Cliente**

#### 3.3 Breadcrumb/Navegação
```
Dashboard → Cliente: João Silva → Imóveis
```

#### 3.4 Modificar Views Existentes
- `carteira.ejs` → Agora é dashboard de clientes
- Criar `cliente-detalhes.ejs` → Carteira individual
- `historico.ejs` → Filtrado por cliente
- Adicionar seletor de cliente onde necessário

### FASE 4: UX/UI

#### 4.1 Nova Sidebar
```
- Dashboard (visão geral de todos os clientes)
- Clientes (lista de clientes)
- Calculadora (mantém)
- Relatórios Consolidados
- Configurações
```

#### 4.2 Componentes Novos
- Card de Cliente
- Modal de Criar/Editar Cliente
- Seletor de Cliente (dropdown)
- Badge de Status do Cliente

#### 4.3 Cores/Identidade Visual
- Manter tema macOS
- Adicionar cor de destaque para "cliente ativo"
- Ícones para diferentes status

### FASE 5: Funcionalidades Adicionais

#### 5.1 Relatórios por Cliente
- Exportar carteira do cliente em PDF
- Histórico de evolução patrimonial
- Comparativo entre clientes

#### 5.2 Notificações
- Vencimentos de IPTU/Condomínio por cliente
- Metas de ROI atingidas
- Novos imóveis adicionados

#### 5.3 Permissões (Futuro)
- Compartilhar acesso read-only com o cliente
- Link público para o cliente ver sua carteira
- Exportação automática mensal

## Ordem de Execução

1. ✅ Criar tabela `clientes`
2. ✅ Migrar `carteira_imoveis` (adicionar `cliente_id`)
3. ✅ Script de migração de dados existentes
4. ✅ Criar rotas de API para clientes
5. ✅ Modificar rotas existentes para suportar `cliente_id`
6. ✅ Criar dashboard de clientes (nova `carteira.ejs`)
7. ✅ Criar página de detalhes do cliente
8. ✅ Modificar sidebar e navegação
9. ✅ Testar fluxo completo
10. ✅ Ajustes de UX/UI

## Considerações Importantes

### Compatibilidade
- Manter dados existentes funcionando
- Migração automática na primeira execução
- Rollback possível se necessário

### Performance
- Índices adequados para queries por assessor + cliente
- Cache de dashboards consolidados
- Paginação em listas de clientes

### Segurança
- Validar sempre que assessor tem acesso ao cliente
- Logs de todas as ações em carteiras
- Isolamento total entre assessores

## Próximos Passos Imediatos

1. Confirmar estrutura com usuário
2. Criar backup do banco de dados
3. Implementar FASE 1 (banco de dados)
4. Testar migração com dados de exemplo
5. Implementar FASE 2 (backend)
