# 🔧 Guia de Troubleshooting - EasyPanel Deploy

## Erro: "Service is not reachable"

### ✅ Checklist de Verificação

#### 1. **Variáveis de Ambiente no EasyPanel**
No painel do EasyPanel, vá em **Environment Variables** e configure:

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=sua-chave-secreta-minimo-32-caracteres-aqui-use-gerador
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-chave-publica-anon
SUPABASE_SERVICE_KEY=sua-chave-service-role
ADMIN_EMAILS=seu-email@exemplo.com
```

**⚠️ IMPORTANTE:** O `SESSION_SECRET` deve ter no mínimo 32 caracteres aleatórios.

#### 2. **Configuração de Porta no EasyPanel**

- Vá em **Settings** → **Port**
- Configure para: **3000**
- Protocolo: **HTTP**

#### 3. **Verificar Logs do Container**

No EasyPanel, vá em **Logs** e procure por:

✅ **Logs de Sucesso:**
```
✅ SQLite otimizado com WAL mode e cache aumentado
✅ Compressão GZIP ativada
✅ Helmet (segurança) ativado
✅ Tabelas verificadas/criadas com sucesso
✅ Índices criados com sucesso
Servidor rodando em http://localhost:3000
```

❌ **Logs de Erro Comuns:**

**Erro 1: "Error: Cannot find module"**
```
Solução: Rebuild da imagem Docker (force rebuild no EasyPanel)
```

**Erro 2: "SQLITE_CANTOPEN"**
```
Solução: Verificar permissões da pasta /app/db
O Dockerfile já cria com permissões corretas (chown node:node)
```

**Erro 3: "SESSION_SECRET is required"**
```
Solução: Adicionar SESSION_SECRET nas variáveis de ambiente
```

#### 4. **Testar Localmente com Docker**

Execute localmente para verificar se o problema é no EasyPanel ou no código:

```bash
# Build da imagem
docker build -t arremata-test .

# Executar com variáveis de ambiente
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e SESSION_SECRET=test-secret-min-32-chars-here-ok \
  -e SUPABASE_URL=sua-url \
  -e SUPABASE_ANON_KEY=sua-key \
  -e SUPABASE_SERVICE_KEY=sua-service-key \
  arremata-test

# Testar acesso
curl http://localhost:3000/login
```

#### 5. **Verificar Health Check**

O Dockerfile tem um healthcheck que verifica `/login`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/login || exit 1
```

**Mudanças aplicadas:**
- ✅ `start-period` aumentado de 5s para 30s (SQLite precisa de tempo para inicializar)
- ✅ Imagem otimizada para `node:20-slim` (menor e mais rápida)

#### 6. **Configuração de Volumes (Persistência)**

No EasyPanel, configure volumes para:
- `/app/db` → Para o banco SQLite
- `/app/public/uploads` → Para uploads de usuários

#### 7. **Rebuild Forçado**

Se nada funcionar:
1. No EasyPanel, vá em **Settings**
2. Clique em **Rebuild** (force rebuild)
3. Aguarde o build completar
4. Verifique os logs novamente

#### 8. **Verificar Domínio/DNS**

Se o deploy funcionar mas o domínio não:
- Verifique se o domínio está apontando corretamente no EasyPanel
- Aguarde propagação DNS (pode levar até 24h)
- Teste com o domínio temporário do EasyPanel primeiro

---

## 🚀 Deploy Rápido

### Ordem de Configuração Recomendada:

1. **Commit e Push** das mudanças no Dockerfile
2. **Configurar Variáveis de Ambiente** no EasyPanel
3. **Configurar Porta** (3000)
4. **Configurar Volumes** (/app/db e /app/public/uploads)
5. **Trigger Deploy** (ou aguardar auto-deploy)
6. **Verificar Logs** em tempo real
7. **Testar Acesso** via domínio temporário

---

## 📞 Suporte

Se o erro persistir, verifique:
- Logs completos do container
- Status do healthcheck
- Recursos disponíveis (RAM/CPU)
- Limites do plano do EasyPanel
