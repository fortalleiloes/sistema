# 🚀 Guia Completo de Deploy - EasyPanel via Terminal

## 📋 Pré-requisitos

- Git instalado e configurado
- Repositório GitHub conectado ao EasyPanel
- Acesso ao terminal

---

## 🔄 Passo a Passo Completo

### **PASSO 1: Verificar Status Atual do Git**

```bash
cd /Users/erickyan/Desktop/macos
git status
```

**O que esperar:** Lista de arquivos modificados (server.js, Dockerfile, etc.)

---

### **PASSO 2: Adicionar Todas as Mudanças**

```bash
# Adicionar arquivos modificados
git add server.js
git add Dockerfile
git add .dockerignore
git add TROUBLESHOOTING.md
git add DEPLOY-GUIDE.md

# OU adicionar tudo de uma vez
git add .
```

---

### **PASSO 3: Verificar o que Será Commitado**

```bash
git status
```

**Verifique se aparecem:**
- ✅ `modified: server.js` (SESSION_SECRET com fallback)
- ✅ `modified: Dockerfile` (healthcheck otimizado)
- ✅ `new file: .dockerignore`
- ✅ `new file: TROUBLESHOOTING.md`
- ✅ `new file: DEPLOY-GUIDE.md`

---

### **PASSO 4: Fazer Commit das Mudanças**

```bash
git commit -m "fix: corrigir deploy EasyPanel - healthcheck otimizado e SESSION_SECRET com fallback"
```

**Mensagem de sucesso esperada:**
```
[main abc1234] fix: corrigir deploy EasyPanel...
 5 files changed, 150 insertions(+), 20 deletions(-)
```

---

### **PASSO 5: Verificar Branch Atual**

```bash
git branch
```

**Deve mostrar:** `* main` ou `* master`

Se estiver em outra branch, mude para main:
```bash
git checkout main
```

---

### **PASSO 6: Fazer Push para o GitHub**

```bash
# Se for a primeira vez ou branch nova
git push -u origin main

# OU se já existe
git push
```

**Possíveis problemas e soluções:**

❌ **Erro: "Updates were rejected"**
```bash
# Solução: Fazer pull primeiro
git pull origin main --rebase
git push
```

❌ **Erro: "Authentication failed"**
```bash
# Solução: Verificar credenciais do GitHub
# Use Personal Access Token se necessário
```

---

### **PASSO 7: Verificar Push no GitHub**

Abra o navegador e acesse:
```
https://github.com/SEU-USUARIO/SEU-REPOSITORIO/commits
```

Confirme que o último commit aparece lá.

---

### **PASSO 8: Configurar Variáveis de Ambiente no EasyPanel**

**⚠️ CRÍTICO:** Antes de fazer o rebuild, configure as variáveis de ambiente.

1. Acesse o EasyPanel
2. Vá em seu serviço → **Environment**
3. Adicione/Atualize:

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=gere-chave-aleatoria-32-chars-minimo
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-anon
SUPABASE_SERVICE_KEY=sua-chave-service
ADMIN_EMAILS=seu-email@exemplo.com
```

**💡 Gerar SESSION_SECRET seguro:**
```bash
# No terminal, execute:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copie o resultado e use como SESSION_SECRET.

---

### **PASSO 9: Configurar Porta no EasyPanel**

1. Vá em **Settings** → **Networking**
2. Configure:
   - **Port:** `3000`
   - **Protocol:** `HTTP`

---

### **PASSO 10: Configurar Volumes (Persistência)**

1. Vá em **Settings** → **Volumes**
2. Adicione dois volumes:

**Volume 1:**
- **Container Path:** `/app/db`
- **Size:** 1GB (ou conforme necessário)

**Volume 2:**
- **Container Path:** `/app/public/uploads`
- **Size:** 2GB (ou conforme necessário)

---

### **PASSO 11: Forçar Rebuild no EasyPanel**

**Opção A - Via Interface:**
1. Vá em **Deployments**
2. Clique em **Rebuild**
3. Marque **Force rebuild** (limpa cache)
4. Clique em **Deploy**

**Opção B - Via Git (Auto-deploy):**
Se o auto-deploy estiver ativado, o push já deve ter iniciado o build.

---

### **PASSO 12: Monitorar Logs em Tempo Real**

No EasyPanel:
1. Vá em **Logs**
2. Ative **Auto-scroll**
3. Aguarde as mensagens:

**✅ Build bem-sucedido:**
```
Step 1/12 : FROM node:20-slim AS builder
...
Successfully built abc123def456
Successfully tagged ...
```

**✅ Container iniciando:**
```
⚙️  Configurando otimizações do SQLite...
✅ SQLite otimizado com WAL mode e cache aumentado
✅ Compressão GZIP ativada
✅ Helmet (segurança) ativado
✅ Tabelas verificadas/criadas com sucesso
✅ Índices criados com sucesso
Servidor rodando em http://localhost:3000
```

---

### **PASSO 13: Verificar Health Check**

Aguarde ~30 segundos (tempo do start-period do healthcheck).

No EasyPanel, vá em **Overview**:
- **Status:** Deve mudar de "Starting" → "Healthy" (verde)

---

### **PASSO 14: Testar Acesso**

**Teste 1 - Domínio Temporário:**
```bash
# Copie o domínio temporário do EasyPanel (ex: app-xyz.easypanel.host)
curl -I https://seu-app.easypanel.host/login
```

**Resposta esperada:**
```
HTTP/2 200
content-type: text/html; charset=utf-8
```

**Teste 2 - Navegador:**
Abra: `https://seu-app.easypanel.host/login`

Deve carregar a página de login.

---

## 🔧 Troubleshooting

### ❌ **Erro: "Service is not reachable" persiste**

```bash
# 1. Verificar logs do container
# No EasyPanel → Logs → procure por erros

# 2. Verificar se o processo está rodando
# No EasyPanel → Terminal → execute:
ps aux | grep node

# 3. Testar porta internamente
curl http://localhost:3000/login
```

### ❌ **Erro: "SQLITE_CANTOPEN"**

```bash
# Verificar permissões
ls -la /app/db

# Deve mostrar: drwxr-xr-x node node
```

**Solução:** Rebuild com volumes configurados corretamente.

### ❌ **Erro: "Cannot find module"**

```bash
# Limpar cache do Docker e rebuild
# No EasyPanel → Settings → Rebuild (marcar Force rebuild)
```

### ❌ **Erro: "Port 3000 already in use"**

**Solução:** Isso não deve acontecer no EasyPanel (containers isolados).
Se acontecer, verifique se não há múltiplas instâncias rodando.

---

## 📊 Checklist Final

Antes de considerar o deploy concluído:

- [ ] Commit e push realizados com sucesso
- [ ] Variáveis de ambiente configuradas (especialmente SESSION_SECRET)
- [ ] Porta configurada para 3000
- [ ] Volumes configurados (/app/db e /app/public/uploads)
- [ ] Build completado sem erros
- [ ] Container com status "Healthy"
- [ ] Página /login acessível
- [ ] Login funcional (testar com usuário)
- [ ] Dados persistindo após restart (testar criando algo e reiniciando)

---

## 🎯 Comandos Rápidos (Resumo)

```bash
# 1. Navegar para o projeto
cd /Users/erickyan/Desktop/macos

# 2. Verificar status
git status

# 3. Adicionar mudanças
git add .

# 4. Commit
git commit -m "fix: corrigir deploy EasyPanel - healthcheck otimizado"

# 5. Push
git push

# 6. Gerar SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 7. Monitorar logs (no EasyPanel web interface)
```

---

## 📞 Próximos Passos

Após deploy bem-sucedido:

1. **Configurar domínio customizado** (se tiver)
2. **Configurar SSL** (EasyPanel faz automaticamente)
3. **Testar todas as funcionalidades**
4. **Configurar backups** dos volumes
5. **Monitorar performance** e logs

---

**✅ Deploy Completo!** 🎉
