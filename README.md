# Arremata App - Sistema de Gestão de Leilões Imobiliários

Este é um sistema completo para gestão de investimentos em leilões de imóveis, incluindo funcionalidades de cálculo de viabilidade, gestão de carteira, CRM de clientes e relatórios financeiros.

## 🚀 Como Iniciar

### Pré-requisitos
- Node.js (v18 ou superior)
- NPM ou Yarn

### Instalação

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/arremata-app.git
cd arremata-app
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
Crie um arquivo `.env` na raiz do projeto e configure as chaves necessárias (veja `.env.example` se disponível, ou configure suas chaves do Supabase e sessão).
```env
SESSION_SECRET=sua_chave_secreta_aqui
PORT=3000
```

4. Inicie o servidor:
```bash
# Modo desenvolvimento (com auto-reload)
npm run dev

# Modo produção
npm start
```

5. Acesse a aplicação:
Abra `http://localhost:3000` no seu navegador.

## 🛠️ Tecnologias Utilizadas

- **Frontend:** EJS, CSS (MacOS Theme), JavaScript (Vanilla)
- **Backend:** Node.js, Express
- **Banco de Dados:** SQLite (com otimizações WAL) / Supabase (Auth)
- **Segurança:** Helmet, Rate Limit, Express Session

## 📱 Principais Funcionalidades

- **Calculadora de Viabilidade:** Ferramenta para calcular custos e retorno de arrematações.
- **Carteira de Imóveis:** Gestão completa dos imóveis arrematados.
- **CRM de Clientes:** Gestão de investidores e suas respectivas carteiras.
- **Relatórios:** Dashboards com KPIs de ROI, Lucro Estimado e Ticket Médio.
