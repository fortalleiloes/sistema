import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
// bcrypt removed: authentication is handled by Supabase now
import { open } from 'sqlite';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import ViabilityCalculator from './ViabilityCalculator.js'; // Force restart
import { body, validationResult } from 'express-validator';
// import { createClient } from '@supabase/supabase-js'; // Removed
import nodemailer from 'nodemailer';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// ========================================
// OTIMIZAÇÕES FASE 1 - Imports
// ========================================
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
// ========================================

// ========================================
// SEGURANÇA AVANÇADA - Imports
// ========================================
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
// ========================================

const app = express();
app.enable('trust proxy'); // CRUCIAL para EasyPanel/Traefik para reconhecer HTTPS, corrige loop de login
console.log('✅ Trust Proxy habilitado para EasyPanel');
const PORT = process.env.PORT || 3000;

// --- Proxy para Caixa (Bypass X-Frame-Options) ---

const caixaProxyOptions = {
    target: 'https://venda-imoveis.caixa.gov.br',
    changeOrigin: true,
    secure: false,
    onProxyReq: function (proxyReq, req, res) {
        proxyReq.setHeader('Referer', 'https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    },
    onProxyRes: function (proxyRes, req, res) {
        delete proxyRes.headers['x-frame-options'];
        delete proxyRes.headers['content-security-policy'];
        if (proxyRes.headers['set-cookie']) {
            proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie => {
                return cookie.replace(/Domain=[^;]+;/, '').replace(/Secure;/, '');
            });
        }
    }
};

app.use('/sistema', createProxyMiddleware({
    ...caixaProxyOptions,
    pathRewrite: { '^/': '/sistema/' }
}));

// Proxy para recursos estáticos (Imagens, CSS, JS que estejam na raiz)
app.use('/fotos', createProxyMiddleware(caixaProxyOptions));
app.use('/imagens', createProxyMiddleware(caixaProxyOptions));
app.use('/assets', createProxyMiddleware(caixaProxyOptions));
app.use('/fotos/*', createProxyMiddleware(caixaProxyOptions)); // Tentativa de capturar subpastas de fotos
app.use('/imagens/*', createProxyMiddleware(caixaProxyOptions));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Conexão com o Banco de Dados ---
const db = await open({
    filename: path.join(__dirname, './db/database.sqlite'),
    driver: sqlite3.Database
});

// ========================================
// OTIMIZAÇÕES SQLITE - Performance
// ========================================
console.log('⚙️  Configurando otimizações do SQLite...');
await db.run('PRAGMA journal_mode = WAL'); // Write-Ahead Logging
await db.run('PRAGMA synchronous = NORMAL'); // Menos fsync
await db.run('PRAGMA cache_size = -64000'); // 64MB de cache
await db.run('PRAGMA temp_store = MEMORY'); // Temp em RAM
await db.run('PRAGMA mmap_size = 30000000000'); // Memory-mapped I/O
await db.run('PRAGMA page_size = 4096'); // Tamanho de página otimizado
console.log('✅ SQLite otimizado com WAL mode e cache aumentado');
// ========================================

// --- Middlewares ---

// ========================================
// OTIMIZAÇÕES FASE 1 - Middlewares
// ========================================

// 1. Compressão GZIP
app.use(compression({
    level: 6, // Nível de compressão (0-9, 6 é bom balanço)
    threshold: 1024, // Só comprimir respostas > 1KB
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}));
console.log('✅ Compressão GZIP ativada');

// 2. Helmet - Segurança
app.use(helmet({
    contentSecurityPolicy: false, // DESABILITADO TEMPORARIAMENTE PARA DEBUG
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
console.log('✅ Helmet (segurança) ativado - CSP DESABILITADO para debug');

// 3. Logging
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined')); // Log completo em produção
    console.log('✅ Logging (production mode) ativado');
} else {
    app.use(morgan('dev')); // Log simplificado em desenvolvimento
    console.log('✅ Logging (dev mode) ativado');
}

// ========================================

// ========================================
// SEGURANÇA AVANÇADA - Middlewares
// ========================================

// 4. CORS - Controle de Acesso
const corsOptions = {
    origin: true, // Permitir todas as origens em desenvolvimento
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
console.log('✅ CORS configurado - PERMISSIVO para debug');

// 5. Proteção contra poluição de parâmetros HTTP
app.use((req, res, next) => {
    // Limitar tamanho de arrays em query strings
    for (const key in req.query) {
        if (Array.isArray(req.query[key]) && req.query[key].length > 10) {
            return res.status(400).json({ error: 'Muitos parâmetros na query string' });
        }
    }
    next();
});

// 6. Sanitização básica de inputs
const sanitizeInput = (str) => {
    if (typeof str !== 'string') return str;
    // Remove caracteres perigosos
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
};

app.use((req, res, next) => {
    // Sanitizar body
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') {
                req.body[key] = sanitizeInput(req.body[key]);
            }
        }
    }

    // Sanitizar query params
    if (req.query && typeof req.query === 'object') {
        for (const key in req.query) {
            if (typeof req.query[key] === 'string') {
                req.query[key] = sanitizeInput(req.query[key]);
            }
        }
    }

    next();
});
console.log('✅ Sanitização de inputs ativada');

// 7. Headers de segurança adicionais
app.use((req, res, next) => {
    // HSTS - Force HTTPS em produção
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions Policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // X-Permitted-Cross-Domain-Policies
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    // Cache Control para páginas sensíveis
    if (req.path.includes('/perfil') || req.path.includes('/admin')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }

    next();
});
console.log('✅ Headers de segurança adicionais configurados');

// 8. Proteção contra timing attacks em comparações
const crypto = await import('crypto');
const safeCompare = (a, b) => {
    try {
        return crypto.timingSafeEqual(
            Buffer.from(String(a)),
            Buffer.from(String(b))
        );
    } catch {
        return false;
    }
};

// Disponibilizar globalmente
app.locals.safeCompare = safeCompare;

// ========================================

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' })); // Limite de 10MB para JSON
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Limite de 10MB para form data

// --- Configuração do Multer para Upload de Arquivos ---
// Tipos de arquivo permitidos
const ALLOWED_FILE_TYPES = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf'
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/'); // Garanta que a pasta 'public/uploads' exista
    },
    filename: function (req, file, cb) {
        // Sanitizar nome do arquivo
        const sanitizedOriginalName = path.basename(file.originalname)
            .replace(/[^a-zA-Z0-9.-]/g, '_') // Remove caracteres especiais
            .substring(0, 100); // Limita tamanho do nome

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = ALLOWED_FILE_TYPES[file.mimetype] || path.extname(sanitizedOriginalName);

        cb(null, `${req.session.userId}-${uniqueSuffix}${ext}`);
    }
});

// Filtro de arquivos
const fileFilter = (req, file, cb) => {
    // Verificar tipo MIME
    if (ALLOWED_FILE_TYPES[file.mimetype]) {
        cb(null, true);
    } else {
        cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}. Apenas imagens e PDFs são aceitos.`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo por arquivo
        files: 10 // Até 10 arquivos por requisição
    }
});

console.log('✅ Upload de arquivos configurado com segurança');

// --- Configuração da Sessão ---
const SQLiteStoreSession = SQLiteStore(session);
app.use(session({
    store: new SQLiteStoreSession({
        db: 'database.sqlite',
        dir: path.join(__dirname, 'db'),
        table: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'arremata.sid', // Nome customizado do cookie (dificulta ataques)
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 1 semana
        httpOnly: true, // Não acessível via JavaScript (proteção XSS)
        secure: process.env.NODE_ENV === 'production', // HTTPS apenas em produção
        sameSite: 'strict', // Proteção CSRF
        path: '/'
    },
    rolling: true // Renova o cookie a cada requisição (mantém sessão ativa)
}));

console.log('✅ Sessão configurada com segurança');

// --- Configuração do Template Engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Expor chaves necessárias para views (APENAS a anon key será usada no cliente)
app.use((req, res, next) => {
    res.locals.supabaseUrl = '';
    res.locals.supabaseAnonKey = '';
    res.locals.username = req.session?.username || '';
    res.locals.email = req.session?.email || '';
    res.locals.profile_pic_url = req.session?.profile_pic_url || '';
    res.locals.isAdmin = req.session?.isAdmin || false;
    next();
});


// --- Auto-migrations (simples) ---
async function ensureTables() {
    console.log('⚙️  Verificando integridade do banco de dados...');

    // 1. Tabela Users
    const tblUsers = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    if (!tblUsers) {
        console.log('Criando tabela users...');
        await db.run(`CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            password TEXT,
            profile_pic_url TEXT,
            email TEXT,
            supabase_id TEXT,
            is_admin INTEGER DEFAULT 0,
            supabase_metadata TEXT
        )`);
    } else {
        // Checa colunas e adiciona se necessário
        const cols = await db.all("PRAGMA table_info('users')");
        const colNames = cols.map(c => c.name);
        if (!colNames.includes('email')) await db.run("ALTER TABLE users ADD COLUMN email TEXT");
        if (!colNames.includes('supabase_id')) await db.run("ALTER TABLE users ADD COLUMN supabase_id TEXT");
        if (!colNames.includes('is_admin')) await db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
        if (!colNames.includes('supabase_metadata')) await db.run("ALTER TABLE users ADD COLUMN supabase_metadata TEXT");
    }
    await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)");
    await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");

    // 2. Tabela Saved Calculations
    await db.run(`CREATE TABLE IF NOT EXISTS saved_calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. Tabela Arremates
    await db.run(`CREATE TABLE IF NOT EXISTS arremates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        descricao_imovel TEXT,
        endereco TEXT,
        data_arremate DATE,
        valor_arremate REAL,
        leiloeiro TEXT,
        edital TEXT,
        calc_valor_avaliacao REAL,
        calc_custo_itbi REAL,
        calc_custo_registro REAL,
        calc_custo_leiloeiro REAL,
        calc_custo_reforma REAL,
        calc_outros_custos REAL,
        calc_valor_venda REAL,
        calc_custo_corretagem REAL,
        calc_imposto_ganho_capital REAL,
        calc_lucro_liquido REAL,
        calc_roi_liquido REAL
    )`);

    // 4. Tabela de Clientes (Assessorados)
    await db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessor_id INTEGER NOT NULL,
        nome TEXT NOT NULL,
        cpf TEXT,
        email TEXT,
        telefone TEXT,
        status TEXT DEFAULT 'ativo',
        data_inicio DATE,
        observacoes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(assessor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // 5. Tabelas da Carteira
    await db.run(`CREATE TABLE IF NOT EXISTS carteira_imoveis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        descricao TEXT,
        endereco TEXT,
        valor_compra REAL,
        data_aquisicao DATE,
        valor_venda_estimado REAL,
        status TEXT DEFAULT 'Arrematado'
    )`);

    // MIGRATION: Ensure columns exist (for existing databases)
    try {
        const tableInfo = await db.all("PRAGMA table_info(carteira_imoveis)");
        const columns = tableInfo.map(c => c.name);
        if (!columns.includes('condominio_estimado')) {
            await db.run("ALTER TABLE carteira_imoveis ADD COLUMN condominio_estimado REAL DEFAULT 0");
            console.log('✅ Coluna condominio_estimado adicionada.');
        }
        if (!columns.includes('iptu_estimado')) {
            await db.run("ALTER TABLE carteira_imoveis ADD COLUMN iptu_estimado REAL DEFAULT 0");
            console.log('✅ Coluna iptu_estimado adicionada.');
        }
        if (!columns.includes('cliente_id')) {
            await db.run("ALTER TABLE carteira_imoveis ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE");
            console.log('✅ Coluna cliente_id adicionada à carteira_imoveis.');
        }
        if (!columns.includes('lucro_estimado')) {
            await db.run("ALTER TABLE carteira_imoveis ADD COLUMN lucro_estimado REAL DEFAULT 0");
            console.log('✅ Coluna lucro_estimado adicionada à carteira_imoveis.');
        }
        if (!columns.includes('roi_estimado')) {
            await db.run("ALTER TABLE carteira_imoveis ADD COLUMN roi_estimado REAL DEFAULT 0");
            console.log('✅ Coluna roi_estimado adicionada à carteira_imoveis.');
        }
    } catch (e) {
        console.error('Erro na migração de carteira_imoveis:', e);
    }

    await db.run(`CREATE TABLE IF NOT EXISTS carteira_custos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        imovel_id INTEGER,
        tipo_custo TEXT,
        valor REAL,
        data_custo DATE,
        descricao TEXT
    )`);



    // 6. Tabela Invites
    await db.run(`CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        token TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        used INTEGER DEFAULT 0
    )`);

    console.log('✅ Tabelas verificadas/criadas com sucesso.');

    // --- MIGRATIONS ADICIONAIS (originadas de initializeDatabase) ---
    // Garantir colunas na tabela arremates
    try {
        const arrematesInfo = await db.all("PRAGMA table_info(arremates)");
        const arrematesColumns = arrematesInfo.map(c => c.name);
        const calcColumns = [
            'calc_valor_avaliacao', 'calc_custo_itbi', 'calc_custo_registro', 'calc_custo_leiloeiro',
            'calc_custo_reforma', 'calc_outros_custos', 'calc_valor_venda', 'calc_custo_corretagem',
            'calc_imposto_ganho_capital', 'calc_lucro_liquido', 'calc_roi_liquido'
        ];

        for (const colName of calcColumns) {
            if (!arrematesColumns.includes(colName)) {
                await db.exec(`ALTER TABLE arremates ADD COLUMN ${colName} REAL`);
                console.log(`✅ Coluna "${colName}" adicionada à tabela de arremates.`);
            }
        }
    } catch (e) {
        console.error('Erro na migração de arremates:', e);
    }

    // Garantir colunas na tabela carteira_imoveis
    try {
        const carteiraInfo = await db.all("PRAGMA table_info(carteira_imoveis)");
        const carteiraCols = carteiraInfo.map(c => c.name);
        const newCols = [
            { name: 'condominio_estimado', type: 'REAL DEFAULT 0' },
            { name: 'iptu_estimado', type: 'REAL DEFAULT 0' },
            { name: 'observacoes', type: 'TEXT' },
            { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' }
        ];

        for (const col of newCols) {
            if (!carteiraCols.includes(col.name)) {
                await db.exec(`ALTER TABLE carteira_imoveis ADD COLUMN ${col.name} ${col.type}`);
                console.log(`✅ Coluna "${col.name}" adicionada à tabela carteira_imoveis.`);
            }
        }
    } catch (e) {
        console.error('Erro na migração de carteira_imoveis (extra):', e);
    }

    // Tabela de Leads (Funil de Vendas)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT,
            whatsapp TEXT,
            
            -- Dados de Qualificação
            objetivo TEXT, -- 'morar' | 'investir'
            experiencia TEXT, -- 'primeira_vez' | 'experiente'
            restricao_nome BOOLEAN, -- 1 (sujo) | 0 (limpo)
            
            -- Financeiro
            capital_entrada REAL,
            capital_vista REAL,
            preferencia_pgto TEXT, -- 'vista' | 'financiado'
            
            -- Localização
            estado TEXT,
            cidade TEXT,

            -- Metadados
            score INTEGER DEFAULT 0,
            status TEXT DEFAULT 'novo', -- 'novo', 'contatado', 'convertido', 'desqualificado'
            claimed_by INTEGER, -- ID do assessor que pegou o lead
            
            -- Segurança
            ip_address TEXT,
            fingerprint TEXT,
            
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabela de Oportunidades (Imóveis Estudados)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS oportunidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, -- Assessor que cadastrou
            titulo TEXT,
            descricao TEXT,
            
            -- Dados Principais
            valor_arremate REAL,
            valor_venda REAL,
            lucro_estimado REAL,
            roi_estimado REAL,
            cidade TEXT,
            estado TEXT,
            tipo_imovel TEXT, -- Casa, Apto, etc
            
            -- Links e Midia
            link_caixa TEXT,
            foto_capa TEXT,
            pdf_proposta TEXT,
            pdf_matricula TEXT,
            
            -- Integração
            calculo_origem_id INTEGER, -- ID do cálculo salvo que gerou isso (opcional)
            
            status TEXT DEFAULT 'disponivel', -- disponivel, reservado, vendido
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Migração para adicionar colunas de localização se não existirem em saved_calculations (para facilitar importação)
    try {
        await db.exec("ALTER TABLE saved_calculations ADD COLUMN cidade TEXT");
        console.log("Coluna 'cidade' adicionada à tabela saved_calculations.");
    } catch (e) {
        // Ignora se já existir
    }

    // Migrações para adicionar IP e Fingerprint à tabela leads existente
    try {
        await db.exec("ALTER TABLE leads ADD COLUMN ip_address TEXT");
        console.log("Coluna 'ip_address' adicionada à tabela leads.");
    } catch (e) { }

    try {
        await db.exec("ALTER TABLE leads ADD COLUMN fingerprint TEXT");
        console.log("Coluna 'fingerprint' adicionada à tabela leads.");
    } catch (e) { }

    // Migração para adicionar coluna 'interesse' se não existir
    try {
        await db.exec("ALTER TABLE leads ADD COLUMN interesse TEXT");
        console.log("Coluna 'interesse' adicionada à tabela leads.");
    } catch (e) {
        // Ignora erro se coluna já existir
    }

    // Limpeza de tabelas antigas
    await db.exec('DROP TABLE IF EXISTS carteira_entries');
}

await ensureTables();

// ========================================
// CRIAÇÃO DE ÍNDICES - Performance
// ========================================
async function createIndexes() {
    console.log('📊 Criando índices para otimização...');

    try {
        // Índices para arremates
        await db.run('CREATE INDEX IF NOT EXISTS idx_arremates_user_id ON arremates(user_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_arremates_data ON arremates(data_arremate DESC)');

        // Índices para clientes
        await db.run('CREATE INDEX IF NOT EXISTS idx_clientes_assessor ON clientes(assessor_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes(status)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON clientes(cpf)');

        // Índices para carteira
        await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_imoveis_user_id ON carteira_imoveis(user_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_imoveis_cliente ON carteira_imoveis(cliente_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_assessor_cliente ON carteira_imoveis(user_id, cliente_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_custos_imovel_id ON carteira_custos(imovel_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_custos_user_id ON carteira_custos(user_id)');

        // Índices para cálculos salvos
        await db.run('CREATE INDEX IF NOT EXISTS idx_saved_calculations_user_id ON saved_calculations(user_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_saved_calculations_created ON saved_calculations(created_at DESC)');



        // Índices para invites
        await db.run('CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token)');

        // Migração: Atualizar status de imóveis de 'Em Análise' para 'Arrematado'
        const result = await db.run(
            "UPDATE carteira_imoveis SET status = 'Arrematado' WHERE status = 'Em Análise' OR status IS NULL"
        );

        if (result.changes > 0) {
            console.log(`✅ Migração: ${result.changes} imóvel(is) atualizado(s) para status 'Arrematado'`);
        }

        // Migração: Criar cliente padrão para cada assessor e vincular imóveis órfãos
        const assessores = await db.all("SELECT DISTINCT user_id FROM carteira_imoveis WHERE cliente_id IS NULL");

        for (const assessor of assessores) {
            if (!assessor.user_id) continue;

            // Verificar se já existe cliente padrão para este assessor
            const clienteExistente = await db.get(
                "SELECT id FROM clientes WHERE assessor_id = ? AND nome = 'Carteira Principal'",
                [assessor.user_id]
            );

            let clienteId;
            if (!clienteExistente) {
                // Criar cliente padrão
                const resultCliente = await db.run(
                    `INSERT INTO clientes (assessor_id, nome, status, data_inicio, observacoes) 
                     VALUES (?, 'Carteira Principal', 'ativo', date('now'), 'Carteira criada automaticamente na migração')`,
                    [assessor.user_id]
                );
                clienteId = resultCliente.lastID || resultCliente.stmt?.lastID;
                console.log(`✅ Cliente padrão criado para assessor ${assessor.user_id}`);
            } else {
                clienteId = clienteExistente.id;
            }

            // Vincular imóveis órfãos ao cliente padrão
            const resultVinculo = await db.run(
                "UPDATE carteira_imoveis SET cliente_id = ? WHERE user_id = ? AND cliente_id IS NULL",
                [clienteId, assessor.user_id]
            );

            if (resultVinculo.changes > 0) {
                console.log(`✅ ${resultVinculo.changes} imóvel(is) vinculado(s) ao cliente padrão do assessor ${assessor.user_id}`);
            }
        }

        console.log('✅ Índices criados com sucesso');
    } catch (error) {
        console.error('❌ Erro ao criar índices:', error);
    }
}

await createIndexes();

// ========================================
// RECOVERY: Garantir usuário admin no startup (VPS fix) moved down
// ========================================

// Helper: parse list of admin emails from env (comma separated)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// --- Password Security Helpers ---
const hashPassword = async (password) => {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scryptAsync(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
};

const verifyPassword = async (password, storedHash) => {
    if (!storedHash) return false;
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = await scryptAsync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
};

// ========================================
// RECOVERY: Garantir usuário admin no startup (VPS fix)
// ========================================
async function ensureAdminUser() {
    console.log('🛡️ Verificando usuário admin padrão...');
    const email = 'fortalestrutura@gmail.com';

    try {
        // Gera o hash da senha solicitada: 35153515
        const hashedPassword = await hashPassword('35153515');

        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            console.log('⚠️ Admin não encontrado. Criando...');
            await db.run('INSERT INTO users (username, password, email, is_admin, profile_pic_url) VALUES (?, ?, ?, 1, NULL)',
                ['Admin Fortal', hashedPassword, email]);
        } else {
            // Força a atualização da senha para garantir que o login funcione
            console.log('🔄 Atualizando credenciais do admin para garantir acesso...');
            await db.run('UPDATE users SET password = ?, is_admin = 1 WHERE email = ?', [hashedPassword, email]);
        }
        console.log('✅ Admin padrão configurado/restaurado com sucesso.');
    } catch (e) {
        console.error('❌ Erro ao configurar admin padrão:', e);
    }
}

await ensureAdminUser();
// ========================================

// --- Middleware de Autenticação ---
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// Helper para criar contexto de usuário consistente
const getUserContext = (session) => {
    return {
        username: session.username || 'Usuário',
        email: session.email || 'Sem email',
        profile_pic_url: session.profile_pic_url || null,
        isAdmin: session.isAdmin || false
    };
};

// ========================================
// RATE LIMITING - Proteção contra abuso
// ========================================

// Rate limiter para rotas de API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requisições por IP
    message: 'Muitas requisições deste IP, tente novamente em 15 minutos.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter para autenticação (mais restritivo)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 tentativas de login
    message: 'Muitas tentativas de login, tente novamente em 15 minutos.',
    skipSuccessfulRequests: true,
});

// Rate limiter para uploads (muito restritivo)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 uploads por hora
    message: 'Limite de uploads atingido, tente novamente em 1 hora.',
});

console.log('✅ Rate limiting configurado');
// ========================================

// --- Rotas ---

// Rota de Layout (Stories)
app.get('/layout', isAuthenticated, (req, res) => {
    const userContext = getUserContext(req.session);
    res.render('layout', { user: userContext, path: '/layout' });
});

// Rota de Notificação Extrajudicial
app.get('/notificacao', isAuthenticated, (req, res) => {
    const userContext = getUserContext(req.session);
    res.render('notificacao', { user: userContext, path: '/notificacao' });
});

// --- Rota de Análise de Documentos (IA) ---
// Configuração específica de Multer para memória (não salvar em disco)
const memoryUpload = multer({ storage: multer.memoryStorage() });

app.get('/analise-documentos', isAuthenticated, (req, res) => {
    const userContext = getUserContext(req.session);
    res.render('analise-documentos', { user: userContext, path: '/analise-documentos' });
});

app.post('/api/analise-documentos/process', isAuthenticated, memoryUpload.fields([{ name: 'edital', maxCount: 1 }, { name: 'matricula', maxCount: 1 }]), async (req, res) => {
    try {
        if (!req.files || !req.files['edital'] || !req.files['matricula']) {
            return res.status(400).json({ error: 'É necessário enviar o Edital e a Matrícula.' });
        }

        const webhookUrl = process.env.N8N_DOCUMENT_ANALYSIS_WEBHOOK;

        // Mock Response se WEBHOOK não estiver configurado
        if (!webhookUrl) {
            console.log('⚠️ N8N_DOCUMENT_ANALYSIS_WEBHOOK não configurado. Retornando mock.');
            // Simular delay
            await new Promise(resolve => setTimeout(resolve, 2000));
            return res.json({
                analysis: `# Análise Jurídica Preliminar (Simulação)\n\n**Atenção:** O webhook do n8n não está configurado. Adicione \`N8N_DOCUMENT_ANALYSIS_WEBHOOK\` ao seu arquivo .env.\n\n## 1. Análise do Edital\n- **Leiloeiro:** Leilão Exemplo S/A\n- **Data Prevista:** 15/02/2026\n- **Condições:** Pagamento à vista com 10% de desconto ou financiado em até 60x.\n\n## 2. Análise da Matrícula\n- **Proprietário:** João da Silva (Executado)\n- **Ônus Identificados:**\n  - R-3: Hipoteca em favor do Banco X (Objeto da execução).\n  - AV-4: Penhora trabalhista (Risco Médio - Necessário verificar se o valor da arrematação cobre).\n\n## 3. Conclusão\nDocumentação viável para arrematação, porém recomenda-se solicitar planilha de débitos atualizada do processo trabalhista antes do lance.`
            });
        }

        // SOLUÇÃO FINAL: Processamento Direto via Gemini (Server-Side)
        // Isso elimina o erro de timeout/upload do n8n para arquivos grandes/imagens.

        const { GoogleGenerativeAI } = await import('@google/generative-ai');

        // Verifica se tem chave API
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY não configurada no .env');
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        // "gemini-flash-latest" aponta para a versão estável com melhor cota gratuita
        const modelName = "gemini-flash-latest";
        const model = genAI.getGenerativeModel({ model: modelName });

        // Converter buffers para formato do Google
        const fileToPart = (buffer, mimeType) => {
            return {
                inlineData: {
                    data: buffer.toString("base64"),
                    mimeType
                }
            };
        };

        const editalPart = fileToPart(req.files['edital'][0].buffer, "application/pdf");
        const matriculaPart = fileToPart(req.files['matricula'][0].buffer, "application/pdf");

        const prompt = `
        Você é um Advogado Especialista em Leilões de Imóveis.
        Analise os arquivos PDF anexos (Edital e Matrícula).
        Eles podem ser texto digital ou imagens escaneadas (OCR necessário).

        Gere um RElATÓRIO JURÍDICO em MARKDOWN com:
        # Análise Jurídica de Viabilidade

        ## 1. Resumo do Imóvel
        - Endereço e Dados Básicos.

        ## 2. Análise da Matrícula
        - Proprietário.
        - Ônus e Gravames (quais caem no leilão?).
        - Riscos (Baixo/Médio/Alto).

        ## 3. Análise do Edital
        - Datas, Valores e Regras.
        - Débitos (IPTU/Condomínio).

        ## 4. CONCLUSÃO
        - Viável ou Inviável?
        `;

        console.log(`Enviando para Gemini (${modelName})...`);

        let responseText;
        try {
            const result = await model.generateContent([prompt, editalPart, matriculaPart]);
            const response = await result.response;
            responseText = response.text();
        } catch (error) {
            if (error.message.includes('429')) {
                console.warn('⚠️ Cota excedida (429). Aguardando 15s para tentar novamente...');
                await new Promise(resolve => setTimeout(resolve, 15000));

                // Segunda tentativa
                const resultRetry = await model.generateContent([prompt, editalPart, matriculaPart]);
                const responseRetry = await resultRetry.response;
                responseText = responseRetry.text();
            } else {
                throw error;
            }
        }

        res.json({ analysis: responseText });

    } catch (error) {
        console.error('Erro ao processar análise:', error);
        res.status(500).json({ error: error.message || 'Falha ao processar documentos.' });
    }
});

// Rota de Login
app.get('/login', (req, res) => {
    res.render('login', { message: req.query.message || null, error: req.query.error || null });
});

// Processar Login (Local)
app.post('/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        // Tenta buscar por email ou username
        const user = await db.get('SELECT * FROM users WHERE email = ? OR username = ?', [username, username]);

        if (!user) {
            return res.render('login', { message: null, error: 'Usuário ou senha incorretos.' });
        }

        // Verifica senha
        // Nota: Usuários migrados do Supabase sem senha definida no DB local não conseguirão logar por senha até redefinirem.
        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
            return res.render('login', { message: null, error: 'Usuário ou senha incorretos.' });
        }

        // Cria sessão
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.email = user.email;
        req.session.profile_pic_url = user.profile_pic_url;
        req.session.isAdmin = !!(user.is_admin || (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())));

        console.log('🔐 Login bem-sucedido:', {
            email: user.email,
            is_admin_db: user.is_admin,
            in_admin_list: user.email && ADMIN_EMAILS.includes(user.email.toLowerCase()),
            final_isAdmin: req.session.isAdmin
        });

        res.redirect('/');
    } catch (err) {
        console.error('Login Error:', err);
        // Debug: Mostrando erro real para o usuário
        res.render('login', { message: null, error: 'Erro: ' + err.message });
    }
});

// Logout Route
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }
        res.clearCookie('arremata.sid');
        res.redirect('/login');
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.redirect('/');
        }
        res.clearCookie('arremata.sid');
        res.redirect('/login');
    });
});

// Middleware de Verificação de Admin Estrita
const requireAdmin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');

    // Lista hardcoded de admins permitidos (Camada extra de segurança)
    const ALLOWED_ADMINS = ['fortalestrutura@gmail.com'];
    const isAdminEmail = req.session.email && ALLOWED_ADMINS.includes(req.session.email.toLowerCase());

    // Verifica flag do banco E lista de email
    if (req.session.isAdmin || isAdminEmail) {
        return next();
    }

    console.warn(`Tentativa de acesso não autorizado ao admin por: ${req.session.email}`);
    res.status(403).send('Acesso Negado: Apenas administradores podem acessar esta página.');
};

// Rota para listar convites (admin)
app.get('/admin/invites', requireAdmin, async (req, res) => {
    try {
        const invites = await db.all('SELECT * FROM invites ORDER BY created_at DESC');

        // Dados do usuário da sessão
        const username = req.session.username || 'Admin';
        const email = req.session.email || '';
        const profile_pic_url = req.session.profile_pic_url || null;

        res.render('admin_invites', {
            invites,
            user: { ...getUserContext(req.session) }, // Use helper to ensure consistency
            username,
            email,
            profile_pic_url,
            supabaseUrl: '',
            supabaseAnonKey: '',
            baseUrl: `${req.protocol}://${req.get('host')}`,
            message: req.query.message || null,
            previewUrl: req.query.previewUrl || null
        });
    } catch (err) {
        console.error('Erro ao buscar convites:', err);
        res.status(500).send('Erro ao buscar convites');
    }
});

// Rota de Diagnóstico de Versão
app.get('/version', (req, res) => {
    res.json({ version: '1.0.2', timestamp: new Date().toISOString() });
});

// Rota para criar convites (admin)
app.post('/admin/invites', requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).send('E-mail é obrigatório');

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.redirect('/admin/invites?message=' + encodeURIComponent('Erro: Formato de e-mail inválido.'));
        }

        // Check if user already exists with this email
        const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.redirect('/admin/invites?message=' + encodeURIComponent('Erro: Já existe um usuário com este e-mail.'));
        }

        const crypto = await import('crypto');
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

        await db.run('INSERT INTO invites (email, token, created_by, expires_at) VALUES (?, ?, ?, ?)', [email, token, req.session.userId, expiresAt.toISOString()]);

        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/accept?token=${token}`;

        // Não enviamos mais e-mail, apenas geramos o link
        console.log(`✅ Convite gerado para ${email}: ${inviteUrl}`);

        let message = 'Convite gerado com sucesso!';
        let previewUrl = null;

        // Tenta enviar e-mail via SMTP ou Ethereal (para testes)
        try {
            let transporter;

            if (process.env.SMTP_HOST) {
                transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: process.env.SMTP_PORT || 587,
                    secure: false,
                    auth: {
                        user: process.env.SMTP_USER,
                        pass: process.env.SMTP_PASS,
                    },
                });
            } else {
                console.log('⚠️ SMTP não configurado. Criando conta de teste no Ethereal...');
                const testAccount = await nodemailer.createTestAccount();
                transporter = nodemailer.createTransport({
                    host: testAccount.smtp.host,
                    port: testAccount.smtp.port,
                    secure: testAccount.smtp.secure,
                    auth: {
                        user: testAccount.user,
                        pass: testAccount.pass,
                    },
                });
            }

            const info = await transporter.sendMail({
                from: `"Arremata System" <${process.env.SMTP_USER || 'noreply@arremata.local'}>`,
                to: email,
                subject: "Seu Convite para o Arremata!",
                html: `
                    <div style="font-family: sans-serif; padding: 20px; color: #333; background: #f4f4f4;">
                        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <h2 style="color: #007bff;">Bem-vindo ao Arremata!</h2>
                            <p>Você foi convidado para acessar o sistema de gestão.</p>
                            <div style="padding: 20px 0; text-align: center;">
                                <a href="${inviteUrl}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                                    Aceitar Convite e Criar Conta
                                </a>
                            </div>
                            <p style="color: #666; font-size: 14px;">Ou copie este link:</p>
                            <p style="background: #eee; padding: 10px; border-radius: 4px; word-break: break-all; font-family: monospace;">${inviteUrl}</p>
                            <p style="font-size: 12px; color: #999; margin-top: 20px;">Este link expira em 7 dias.</p>
                        </div>
                    </div>
                `
            });

            console.log(`📧 E-mail de convite enviado para ${email}`);

            if (!process.env.SMTP_HOST) {
                previewUrl = nodemailer.getTestMessageUrl(info);
                console.log('🔗 Preview URL (Ethereal):', previewUrl);
                message = 'Convite gerado (Modo Simulação: SMTP Desligado)';
            } else {
                message = 'Convite gerado e e-mail enviado!';
            }

        } catch (emailErr) {
            console.error('❌ Falha ao enviar e-mail (mas convite foi criado):', emailErr);
            message = 'Convite criado, mas erro ao enviar email.';
        }

        res.redirect(`/admin/invites?message=${encodeURIComponent(message)}${previewUrl ? '&previewUrl=' + encodeURIComponent(previewUrl) : ''}`);
        return; // Ensure no fall-through
    } catch (err) {
        console.error('Erro ao criar convite:', err);
        res.status(500).send('Erro ao criar convite');
    }
});

// Página pública para aceitar convite (lead)
app.get('/invite/accept', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token inválido (vazio)');

    // Garantir que não há espaços extras
    const cleanToken = token.trim();

    console.log(`🔍 Tentativa de acesso com token: "${cleanToken}"`);

    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [cleanToken]);

        if (!invite) {
            console.error(`❌ Token não encontrado: "${cleanToken}"`);

            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Link Inválido | Arremata!</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-gray-100 h-screen flex items-center justify-center">
                    <div class="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                        <div class="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-8 h-8">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        </div>
                        <h1 class="text-2xl font-bold text-gray-800 mb-2">Link Inválido ou Expirado</h1>
                        <p class="text-gray-600 mb-6">Não encontramos este convite. Ele pode ter sido cancelado, expirado ou o link está incorreto.</p>
                        <p class="text-sm text-gray-500 mb-6 bg-gray-50 p-3 rounded border border-gray-200">
                            Dica: Peça ao administrador para gerar um novo link atualizado na tabela de convites.
                        </p>
                        <a href="/login" class="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">Voltar ao Login</a>
                    </div>
                </body>
                </html>
            `);
        }

        if (invite.used) {
            console.warn(`⚠️ Token já utilizado: "${cleanToken}" por ${invite.email}`);
            return res.status(400).send('Este convite já foi utilizado.');
        }

        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
            console.warn(`⚠️ Token expirado: "${cleanToken}"`);
            return res.status(400).send('Este convite expirou (validade de 7 dias).');
        }

        console.log(`✅ Convite válido encontrado para: ${invite.email}`);

        // renderiza página pedindo username e senha
        res.render('invite_accept', { token: token, email: invite.email, error: null });
    } catch (err) {
        console.error('Erro em invite/accept:', err);
        res.status(500).send('Erro interno');
    }
});

// Processa criação de conta a partir do convite (Local Auth)
app.post('/invite/accept', async (req, res) => {
    const { token, username, password } = req.body;
    if (!token || !username || !password) return res.status(400).send('Dados incompletos');

    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [token]);
        if (!invite) return res.status(400).send('Convite inválido');
        if (invite.used) return res.status(400).send('Convite já utilizado');
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(400).send('Convite expirado');

        // Check if email already exists
        const existing = await db.get('SELECT id FROM users WHERE email = ?', [invite.email]);
        if (existing) {
            return res.status(400).send('Este e-mail já está cadastrado.');
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Marca invite como usado
        await db.run('UPDATE invites SET used = 1 WHERE id = ?', [invite.id]);

        // Cria usuário local
        const result = await db.run(
            'INSERT INTO users (username, password, profile_pic_url, email, is_admin) VALUES (?, ?, ?, ?, 0)',
            [username, hashedPassword, null, invite.email]
        );
        const newId = result.lastID || result.stmt?.lastID;

        // Cria sessão
        req.session.userId = newId;
        req.session.username = username;
        req.session.email = invite.email;
        req.session.profile_pic_url = null;
        req.session.isAdmin = false;

        res.redirect('/perfil?success=registered');
    } catch (err) {
        console.error('Erro em POST /invite/accept:', err);
        return res.status(500).send('Erro interno ao criar conta.');
    }
});

// -----------------------
// Rotas do Chat / Integração com n8n - REMOVIDAS
// -----------------------

// Rota /session removida (Auth Local)

// Rota principal da aplicação (protegida)
app.get('/', isAuthenticated, async (req, res) => {
    const baseContext = {
        username: req.session.username || 'Usuário',
        email: req.session.email || 'Sem email',
        profile_pic_url: req.session.profile_pic_url || null,
        user: {
            username: req.session.username || 'Usuário',
            email: req.session.email || 'Sem email',
            profile_pic_url: req.session.profile_pic_url || null,
            isAdmin: req.session.isAdmin || false
        }
    };

    try {
        console.log('🔍 Dashboard: Iniciando carregamento para userId:', req.session.userId);

        if (!req.session.userId) {
            console.warn('⚠️ UserId não encontrado na sessão');
            return res.render('index', {
                ...baseContext,
                stats: null,
                recentProperties: [],
                growth: null
            });
        }

        // ADVISOR DASHBOARD LOGIC
        // 1. Fetch all clients managed by this advisor
        const clients = await db.all('SELECT id, status FROM clientes WHERE assessor_id = ?', [req.session.userId]);
        const clientIds = clients.map(c => c.id);
        const activeClients = clients.filter(c => c.status === 'ativo').length;

        let totalProperties = 0;
        let vgvManagement = 0;
        let recentProperties = [];
        let growthData = null;

        if (clientIds.length > 0) {
            // 2. Fetch all properties linked to these clients
            const placeholders = clientIds.map(() => '?').join(',');
            const properties = await db.all(
                `SELECT * FROM carteira_imoveis WHERE cliente_id IN (${placeholders}) ORDER BY data_aquisicao DESC`,
                clientIds
            );

            totalProperties = properties.length;
            vgvManagement = properties.reduce((sum, p) => sum + (p.valor_venda_estimado || 0), 0);

            // Get recent 5
            recentProperties = properties.slice(0, 5);

            // 3. Calculate Monthly Growth Data (Last 6 Months)
            const months = {};
            const today = new Date();
            for (let i = 5; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const key = d.toISOString().slice(0, 7); // YYYY-MM
                months[key] = {
                    label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
                    profit: 0,
                    volume: 0
                };
            }

            properties.forEach(imovel => {
                if (imovel.data_aquisicao) {
                    try {
                        const dateVal = new Date(imovel.data_aquisicao);
                        if (!isNaN(dateVal.getTime())) {
                            const dateKey = dateVal.toISOString().slice(0, 7);
                            if (months[dateKey]) {
                                months[dateKey].profit += parseFloat(imovel.lucro_estimado || 0);
                                months[dateKey].volume += 1;
                            }
                        }
                    } catch (e) {
                        // Ignore invalid dates
                    }
                }
            });

            growthData = {
                labels: Object.values(months).map(m => m.label),
                profitData: Object.values(months).map(m => m.profit),
                volumeData: Object.values(months).map(m => m.volume)
            };
        }

        // 6% Commission Assumption
        const estimatedCommission = vgvManagement * 0.06;

        const advisorStats = {
            vgv_gestao: vgvManagement,
            comissao_prevista: estimatedCommission,
            clientes_ativos: activeClients,
            total_imoveis: totalProperties
        };

        console.log('✅ Dashboard: Dados do ASSESSOR carregados com sucesso');

        res.render('index', {
            ...baseContext,
            stats: advisorStats,
            growth: growthData,
            recentProperties: recentProperties
        });
    } catch (error) {
        console.error('❌ ERRO CRÍTICO NO DASHBOARD:', error.message);
        console.error('Stack trace:', error.stack);

        // Renderizar versão simplificada sem dados
        res.render('index', {
            ...baseContext,
            stats: null,
            recentProperties: [],
            growth: null
        });
    }
});

// Rota para a página de perfil
app.get('/perfil', isAuthenticated, async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, profile_pic_url FROM users WHERE id = ?', [req.session.userId]);
        res.render('perfil', { user: user, success: req.query.success, error: req.query.error });
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        res.status(500).send("Erro ao carregar a página de perfil.");
    }
});

// Rota para atualizar a foto do perfil
app.post('/perfil/update-photo', uploadLimiter, isAuthenticated, upload.single('profilePhoto'), async (req, res) => {
    // Adiciona uma verificação para o caso de nenhum arquivo ser enviado
    if (!req.file) {
        return res.status(400).redirect('/perfil?error=photo');
    }

    const profilePhotoUrl = `/uploads/${req.file.filename}`;
    await db.run('UPDATE users SET profile_pic_url = ? WHERE id = ?', [profilePhotoUrl, req.session.userId]);
    req.session.profile_pic_url = profilePhotoUrl; // Atualiza a foto na sessão
    res.redirect('/perfil?success=photo');
});

// Rota para atualizar informações do perfil (nome)
app.post('/perfil/update-info', isAuthenticated, async (req, res) => {
    try {
        const { username } = req.body;
        await db.run('UPDATE users SET username = ? WHERE id = ?', [username, req.session.userId]);
        req.session.username = username; // Atualiza o nome na sessão
        res.redirect('/perfil?success=info');
    } catch (error) {
        console.error('Erro ao atualizar informações do perfil:', error);
        res.redirect('/perfil?error=server');
    }
});

// Rota para alterar senha (Local)
app.post('/perfil/change-password', isAuthenticated, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.redirect('/perfil?error=new_password_length');
    }

    try {
        const hashedPassword = await hashPassword(newPassword);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.userId]);
        res.redirect('/perfil?success=password_changed');
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.redirect('/perfil?error=server');
    }
});

// Note: password management is handled by Supabase. To change password, use Supabase account management flows.

// Rota para zerar todos os dados do usuário
app.post('/perfil/reset-all-data', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;

        // Deleta todos os dados do usuário
        await db.run('DELETE FROM saved_calculations WHERE user_id = ?', [userId]);
        await db.run('DELETE FROM arremates WHERE user_id = ?', [userId]);
        await db.run('DELETE FROM carteira_custos WHERE user_id = ?', [userId]);
        await db.run('DELETE FROM carteira_imoveis WHERE user_id = ?', [userId]);

        console.log(`✅ Todos os dados do usuário ${userId} foram zerados.`);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao zerar dados:', error);
        res.status(500).json({ success: false, error: 'Erro ao zerar dados' });
    }
});

// Rota para o Histórico de Arremates
app.get('/historico', isAuthenticated, async (req, res) => {
    try {
        const arremates = await db.all('SELECT * FROM arremates WHERE user_id = ? ORDER BY data_arremate DESC', [req.session.userId]);

        // Formata o valor do arremate para o padrão de moeda brasileiro (BRL)
        const arrematesFormatados = arremates.map(item => {
            return {
                ...item,
                valor_formatado: item.valor_arremate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
            };
        });
        res.render('historico', { arremates: arrematesFormatados, user: getUserContext(req.session), username: req.session.username, email: req.session.email || 'Acesso de Lead', profile_pic_url: req.session.profile_pic_url });
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).send("Erro ao carregar o histórico.");
    }
});

// Rota para adicionar um novo arremate
app.get('/historico/add', isAuthenticated, (req, res) => {
    // Pega os dados da calculadora da sessão, se existirem
    const calcData = req.session.calcData || {};
    delete req.session.calcData; // Limpa os dados da sessão após o uso

    res.render('adicionar-arremate', {
        user: {
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url
        },
        calcData: calcData,
        errors: []
    });
});

app.post('/historico/add', isAuthenticated, [
    // Validações básicas
    body('descricao_imovel').notEmpty().withMessage('A descrição do imóvel é obrigatória.'),
    body('data_arremate').isDate().withMessage('A data do arremate é inválida.'),
    body('valor_arremate').isFloat({ gt: 0 }).withMessage('O valor do arremate deve ser um número positivo.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Se houver erros, renderiza o formulário novamente com os erros e os dados inseridos
        return res.status(400).render('adicionar-arremate', {
            user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url },
            calcData: req.body, // Retorna os dados que o usuário já preencheu
            errors: errors.array()
        });
    }

    try {
        const {
            descricao_imovel,
            endereco,
            data_arremate,
            valor_arremate,
            leiloeiro,
            edital,
            calc_valor_venda,
            calc_custo_reforma,
            calc_custo_itbi,

            condominioMensal,
            iptuMensal,
            cliente_id, // Novo: suporte para vincular ao cliente
            ...calcFields
        } = req.body;

        console.log('📝 POST /historico/add - Payload:', {
            condominioMensal,
            iptuMensal,
            calc_valor_venda,
            cliente_id,
            calcFields_keys: Object.keys(calcFields)
        });

        // Helper para extrair números de strings formatadas (pt-BR) ou números puros
        const parseMonetary = (val) => {
            if (val === null || val === undefined || val === '') return 0;
            if (typeof val === 'number') return val;

            const strVal = val.toString().trim();

            // Se tiver vírgula, assume formato BRL (Ex: "1.000,00" ou "10,50")
            if (strVal.includes(',')) {
                // Remove pontos de milhar, mantém vírgula e sinal de menos e dígitos
                const clean = strVal.replace(/[^\d,-]/g, '');
                // Troca vírgula por ponto para converter
                return parseFloat(clean.replace(',', '.')) || 0;
            }

            // Se NÃO tiver vírgula, assume formato Standard/US (Ex: "1000.00" vindo de inputs hidden, ou "1000")
            // Apenas remove caracteres inválidos, mantendo o ponto
            const clean = strVal.replace(/[^\d.-]/g, '');
            return parseFloat(clean) || 0;
        };

        // 1. Salva no histórico de arremates
        const arremateResult = await db.run(
            `INSERT INTO arremates (
                user_id, descricao_imovel, endereco, data_arremate, valor_arremate, leiloeiro, edital,
                calc_valor_avaliacao, calc_custo_itbi, calc_custo_registro, calc_custo_leiloeiro,
                calc_custo_reforma, calc_outros_custos, calc_valor_venda, calc_custo_corretagem,
                calc_imposto_ganho_capital, calc_lucro_liquido, calc_roi_liquido
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.userId, descricao_imovel, endereco, data_arremate,
                parseMonetary(valor_arremate), leiloeiro, edital,
                parseMonetary(calcFields.calc_valor_avaliacao), parseMonetary(calc_custo_itbi),
                parseMonetary(calcFields.calc_custo_registro), parseMonetary(calcFields.calc_custo_leiloeiro),
                parseMonetary(calc_custo_reforma), parseMonetary(calcFields.calc_outros_custos),
                parseMonetary(calc_valor_venda), parseMonetary(calcFields.calc_custo_corretagem),
                parseMonetary(calcFields.calc_imposto_ganho_capital), parseMonetary(calcFields.calc_lucro_liquido),
                parseMonetary(calcFields.calc_roi_liquido)
            ]
        );

        // 2. Automaticamente adiciona à carteira (com cliente_id se fornecido)
        const carteiraResult = await db.run(
            'INSERT INTO carteira_imoveis (user_id, cliente_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, status, condominio_estimado, iptu_estimado, lucro_estimado, roi_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                req.session.userId,
                cliente_id ? parseInt(cliente_id) : null, // Vincula ao cliente se fornecido
                descricao_imovel,
                endereco || 'Endereço a definir',
                parseMonetary(valor_arremate) || 0,
                data_arremate,
                parseMonetary(calc_valor_venda) || 0,
                'Arrematado',
                parseMonetary(condominioMensal) || 0,
                parseMonetary(iptuMensal) || 0,
                parseMonetary(calcFields.calc_lucro_liquido) || 0,
                parseMonetary(calcFields.calc_roi_liquido) || 0
            ]
        );

        const imovelId = carteiraResult.lastID;

        // 3. Adiciona custos estimados na carteira (se existirem no cálculo)
        if (calc_custo_reforma && parseFloat(calc_custo_reforma) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Reforma', parseFloat(calc_custo_reforma), data_arremate, 'Estimativa de reforma (do cálculo)']
            );
        }

        if (calc_custo_itbi && parseFloat(calc_custo_itbi) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Impostos', parseFloat(calc_custo_itbi), data_arremate, 'ITBI (do cálculo)']
            );
        }

        if (calcFields.calc_custo_registro && parseFloat(calcFields.calc_custo_registro) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Documentação', parseFloat(calcFields.calc_custo_registro), data_arremate, 'Custos de registro (do cálculo)']
            );
        }

        if (calcFields.calc_custo_leiloeiro && parseFloat(calcFields.calc_custo_leiloeiro) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Comissão', parseFloat(calcFields.calc_custo_leiloeiro), data_arremate, 'Comissão Leiloeiro (do cálculo)']
            );
        }

        if (calcFields.calc_outros_custos && parseFloat(calcFields.calc_outros_custos) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Outros', parseFloat(calcFields.calc_outros_custos), data_arremate, 'Outros custos iniciais (do cálculo)']
            );
        }

        if (calcFields.calc_custo_assessoria && parseFloat(calcFields.calc_custo_assessoria) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Comissão', parseFloat(calcFields.calc_custo_assessoria), data_arremate, 'Assessoria (do cálculo)']
            );
        }

        if (calcFields.calc_debitos_pendentes && parseFloat(calcFields.calc_debitos_pendentes) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Outros', parseFloat(calcFields.calc_debitos_pendentes), data_arremate, 'Débitos Pendentes (do cálculo)']
            );
        }

        if (calcFields.calc_custo_desocupacao && parseFloat(calcFields.calc_custo_desocupacao) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Outros', parseFloat(calcFields.calc_custo_desocupacao), data_arremate, 'Desocupação / Advogado (do cálculo)']
            );
        }

        if (calcFields.calc_custo_seguro && parseFloat(calcFields.calc_custo_seguro) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Seguro', parseFloat(calcFields.calc_custo_seguro), data_arremate, 'Seguro Fixo (do cálculo)']
            );
        }

        // Adiciona custos mensais recorrentes (Condomínio e IPTU)
        // BUGFIX: Usar a variável extraída 'condominioMensal' e não 'calcFields.condominioMensal' (que é undefined)
        if (condominioMensal && parseFloat(condominioMensal) > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Condomínio', parseFloat(condominioMensal), data_arremate, 'Condomínio (Estimativa Mensal)']
            );
            console.log(`✅ Custo de Condomínio salvo: R$ ${condominioMensal}`);
        }

        let iptuMensalCalc = 0;
        if (iptuMensal && parseFloat(iptuMensal) > 0) {
            iptuMensalCalc = parseFloat(iptuMensal); // Usar variável extraída
        } else if (calcFields.iptuAnual && parseFloat(calcFields.iptuAnual) > 0) {
            iptuMensalCalc = parseFloat(calcFields.iptuAnual) / 12;
        }

        if (iptuMensalCalc > 0) {
            await db.run(
                'INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Impostos', iptuMensalCalc, data_arremate, 'IPTU (Estimativa Mensal)']
            );
            console.log(`✅ Custo de IPTU salvo: R$ ${iptuMensalCalc}/mês`);
        }

        console.log(`✅ Arremate salvo e adicionado à carteira automaticamente. Imóvel ID: ${imovelId}`);
        res.redirect('/historico');
    } catch (error) {
        console.error('Erro ao adicionar arremate:', error);
        res.status(500).send("Erro ao salvar o arremate.");
    }
});



// Rota para exibir o formulário de edição de um arremate
app.get('/historico/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const arremate = await db.get('SELECT * FROM arremates WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!arremate) {
            return res.status(404).send("Arremate não encontrado ou não pertence a você.");
        }
        // Passando o objeto 'user' completo para consistência
        const user = {
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url
        };
        res.render('editar-arremate', { arremate: arremate, user: user });
    } catch (error) {
        console.error('Erro ao carregar arremate para edição:', error);
        res.status(500).send("Erro ao carregar a página de edição.");
    }
});

// Rota para processar a edição de um arremate
app.post('/historico/edit/:id', isAuthenticated, async (req, res) => {
    const { descricao_imovel, endereco, data_arremate, valor_arremate, leiloeiro, edital } = req.body;
    try {
        await db.run(
            'UPDATE arremates SET descricao_imovel = ?, endereco = ?, data_arremate = ?, valor_arremate = ?, leiloeiro = ?, edital = ? WHERE id = ? AND user_id = ?',
            [descricao_imovel, endereco, data_arremate, valor_arremate, leiloeiro, edital, req.params.id, req.session.userId]
        );
        res.redirect('/historico');
    } catch (error) {
        console.error('Erro ao editar arremate:', error);
        res.status(500).send("Erro ao salvar as alterações.");
    }
});

// Rota para gerar o relatório
app.get('/historico/relatorio', isAuthenticated, async (req, res) => {
    try {
        const arremates = await db.all('SELECT *, printf("R$ %.2f", valor_arremate) as valor_formatado FROM arremates WHERE user_id = ? ORDER BY data_arremate ASC', [req.session.userId]);
        const user = await db.get('SELECT username FROM users WHERE id = ?', [req.session.userId]);
        res.render('relatorio', { arremates: arremates, user: user, dataGeracao: new Date().toLocaleDateString('pt-BR') });
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        res.status(500).send("Erro ao gerar o relatório.");
    }
});

// Rota para a Calculadora de Viabilidade
app.get('/calculadora', isAuthenticated, async (req, res) => {
    try {
        const savedCalculations = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);

        res.render('calculadora', {
            user: getUserContext(req.session),
            results: null, // Nenhum resultado no carregamento inicial
            inputData: {},
            savedCalculations: savedCalculations,
            success: req.query.success
        });
    } catch (error) {
        console.error('Erro ao carregar calculadora:', error);
        res.status(500).send("Erro ao carregar a página.");
    }
});

// API para buscar cálculos salvos (usado no modal de Meus Imóveis)
app.get('/api/saved-calculations', isAuthenticated, async (req, res) => {
    try {
        const savedCalculations = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
        res.json(savedCalculations);
    } catch (error) {
        console.error('Erro ao buscar cálculos salvos:', error);
        res.status(500).json({ error: 'Erro ao buscar cálculos.' });
    }
});

// Rota para atualizar cálculo salvo via API
app.put('/api/saved-calculations/:id', isAuthenticated, async (req, res) => {
    try {
        const calculoId = req.params.id;
        const { data } = req.body;

        // Verificar se o cálculo pertence ao usuário
        const calculo = await db.get(
            'SELECT * FROM saved_calculations WHERE id = ? AND user_id = ?',
            [calculoId, req.session.userId]
        );

        if (!calculo) {
            return res.status(404).json({ error: 'Cálculo não encontrado' });
        }

        // Atualizar apenas os dados, mantendo o nome
        await db.run(
            'UPDATE saved_calculations SET data = ? WHERE id = ? AND user_id = ?',
            [JSON.stringify(data), calculoId, req.session.userId]
        );

        res.json({ success: true, message: 'Cálculo atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar cálculo:', error);
        res.status(500).json({ error: 'Erro ao atualizar cálculo' });
    }
});

// Rota para excluir cálculo salvo via API
app.delete('/api/saved-calculations/:id', isAuthenticated, async (req, res) => {
    try {
        const calculoId = req.params.id;

        // Verificar e excluir
        // Note: db.run returns an object with 'changes' property indicating number of rows affected
        const result = await db.run(
            'DELETE FROM saved_calculations WHERE id = ? AND user_id = ?',
            [calculoId, req.session.userId]
        );

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Cálculo não encontrado' });
        }

        res.json({ success: true, message: 'Cálculo excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir cálculo:', error);
        res.status(500).json({ error: 'Erro ao excluir cálculo' });
    }
});

// Importar cálculo salvo para a carteira
app.post('/api/portfolio/import-calculation/:id', isAuthenticated, async (req, res) => {
    try {
        const calc = await db.get('SELECT * FROM saved_calculations WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!calc) return res.status(404).json({ error: 'Cálculo não encontrado' });

        const data = JSON.parse(calc.data);

        // Mapear dados do cálculo para a estrutura da carteira
        const descricao = calc.name;
        const valorCompra = data.valorArrematado || 0;
        const valorVendaEstimado = data.valorVendaFinal || 0;

        // Calcular lucro e ROI usando o ViabilityCalculator
        const calculator = new ViabilityCalculator();
        const results = calculator.calculateViability(data);

        // Usar a projeção de 4 meses como padrão para estimativas
        const lucroEstimado = results.projection4Months.resultadoLiquido || 0;
        const roiEstimado = results.projection4Months.roiLiquido || 0;

        // Inserir na carteira
        const result = await db.run(
            'INSERT INTO carteira_imoveis (user_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, status, condominio_estimado, iptu_estimado, lucro_estimado, roi_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                req.session.userId,
                descricao,
                'Endereço a definir',
                valorCompra,
                new Date().toISOString().split('T')[0],
                valorVendaEstimado,
                'Arrematado',
                parseFloat(data.condominioMensal) || 0,
                (parseFloat(data.iptuAnual) / 12) || (parseFloat(data.iptuMensal) || 0),
                lucroEstimado,
                roiEstimado
            ]
        );

        const imovelId = result.lastID;

        // Opcional: Inserir custos estimados iniciais baseados no cálculo
        if (data.reforma) {
            await db.run('INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Reforma', data.reforma, new Date().toISOString().split('T')[0], 'Estimativa Reforma']);
        }
        if (data.itbi) {
            const valorITBI = (valorCompra * (parseFloat(data.itbi) || 0)) / 100;
            await db.run('INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                [req.session.userId, imovelId, 'Impostos', valorITBI, new Date().toISOString().split('T')[0], 'ITBI']);
        }

        res.json({ success: true, imovelId });
    } catch (error) {
        console.error('Erro ao importar cálculo:', error);
        res.status(500).json({ error: 'Erro ao importar cálculo' });
    }
});

// --- Rota da Vitrine de Oportunidades (Imóveis Estudados) ---

// 1. Página de Listagem
// 1. Página de Listagem
app.get('/oportunidades', isAuthenticated, async (req, res) => {
    try {
        console.log('--- Acessando /oportunidades ---');

        // Busca oportunidades COM o nome do assessor (JOIN)
        const oportunidades = await db.all(`
            SELECT oportunidades.*, users.username as autor 
            FROM oportunidades 
            LEFT JOIN users ON oportunidades.user_id = users.id 
            ORDER BY oportunidades.created_at DESC
        `);

        console.log('Oportunidades encontradas:', oportunidades.length);

        if (typeof getUserContext !== 'function') {
            throw new Error('getUserContext não é uma função ou não está definida');
        }

        const context = {
            user: getUserContext(req.session),
            oportunidades: oportunidades
        };

        res.render('oportunidades', context, (err, html) => {
            if (err) {
                console.error('Erro de Renderização EJS:', err);
                return res.status(500).send('Erro de Renderização: ' + err.message);
            }
            res.send(html);
        });

    } catch (error) {
        console.error('Erro ao carregar oportunidades (catch block):', error);
        res.status(500).send("Erro ao carregar oportunidades: " + error.message);
    }
});

// 2. Criar Nova Oportunidade
app.post('/oportunidades', isAuthenticated, upload.any(), async (req, res) => {
    try {
        // Função helper para converter valores monetários
        const parseMonetary = (value) => {
            if (!value) return 0;
            if (typeof value === 'number') return value;
            // Remove R$, pontos (milhares) e substitui vírgula por ponto
            return parseFloat(String(value).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
        };

        const {
            titulo,
            descricao,
            valor_arremate,
            valor_venda,
            lucro_estimado,
            roi_estimado,
            cidade,
            estado,
            tipo_imovel,
            link_caixa,
            foto_capa, // URL "manual" via hidden input, se não houver upload
            calculo_origem_id
        } = req.body;

        // --- Processamento de Arquivos ---
        let finalFotoCapa = foto_capa;
        let pdfPropostaPath = null;
        let pdfMatriculaPath = null;

        // Com upload.any(), req.files é um array
        if (req.files && req.files.length > 0) {
            const fotoUpload = req.files.find(f => f.fieldname === 'foto_upload');
            const pdfProposta = req.files.find(f => f.fieldname === 'pdf_proposta');
            const pdfMatricula = req.files.find(f => f.fieldname === 'pdf_matricula');

            if (fotoUpload) {
                finalFotoCapa = '/uploads/' + fotoUpload.filename;
            }
            if (pdfProposta) {
                pdfPropostaPath = '/uploads/' + pdfProposta.filename;
            }
            if (pdfMatricula) {
                pdfMatriculaPath = '/uploads/' + pdfMatricula.filename;
            }
        }

        // Parse dos valores numéricos
        const valorArremateNum = parseMonetary(valor_arremate);
        const valorVendaNum = parseMonetary(valor_venda);
        const lucroEstimadoNum = parseMonetary(lucro_estimado);
        const roiEstimadoNum = parseFloat(roi_estimado) || 0;

        await db.run(
            `INSERT INTO oportunidades (
                user_id, titulo, descricao, valor_arremate, valor_venda, lucro_estimado, 
                roi_estimado, cidade, estado, tipo_imovel, link_caixa, foto_capa, calculo_origem_id,
                pdf_proposta, pdf_matricula
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.userId, titulo, descricao, valorArremateNum, valorVendaNum, lucroEstimadoNum,
                roiEstimadoNum, cidade, estado, tipo_imovel, link_caixa, finalFotoCapa, calculo_origem_id,
                pdfPropostaPath, pdfMatriculaPath
            ]
        );

        res.json({ success: true, message: 'Oportunidade publicada com sucesso!' });
    } catch (error) {
        console.error('Erro ao criar oportunidade:', error);
        console.error('Body recebido:', req.body);
        console.error('Files recebidos:', req.files);
        res.status(500).json({ error: 'Erro ao publicar oportunidade: ' + error.message });
    }
});

app.post('/api/oportunidades/save-from-proposal', isAuthenticated, upload.none(), async (req, res) => {
    try {
        const {
            titulo, valorArremate, valorVenda, lucroEstimado, roiEstimado,
            cidade, estado, tipoImovel, linkCaixa, fotoCapa, pdfPropostaData
        } = req.body;

        // Converter valores monetários
        const parseMoney = (val) => {
            if (typeof val === 'number') return val;
            if (!val) return 0;
            return parseFloat(val.toString().replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
        };

        const valorArremateNum = parseMoney(valorArremate);
        const valorVendaNum = parseMoney(valorVenda);
        const lucroEstimadoNum = parseMoney(lucroEstimado);

        // ROI já vem geralmente formatado, tentar limpar
        let roiEstimadoNum = roiEstimado;
        if (typeof roiEstimado === 'string') {
            roiEstimadoNum = parseFloat(roiEstimado.replace('%', '').replace(',', '.'));
        }

        // Salvar PDF se vier (opcional, pode ser implementado depois com upload de arquivo real)
        // Por enquanto, vamos focar nos dados estruturados.

        const result = await db.run(`
            INSERT INTO oportunidades (
                user_id, titulo, descricao, valor_arremate, valor_venda, 
                lucro_estimado, roi_estimado, cidade, estado, tipo_imovel, 
                link_caixa, foto_capa, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponivel')
        `, [
            req.session.userId,
            titulo || 'Oportunidade sem Título',
            `Imóvel estudado. ROI: ${roiEstimadoNum}%`,
            valorArremateNum,
            valorVendaNum,
            lucroEstimadoNum,
            roiEstimadoNum,
            cidade || '',
            estado || '',
            tipoImovel || 'Indefinido',
            linkCaixa || '',
            fotoCapa || '', // URL da imagem se disponível
        ]);

        res.json({ success: true, id: result.lastID, message: 'Oportunidade salva via proposta!' });

    } catch (error) {
        console.error('Erro ao salvar oportunidade via proposta:', error);
        res.status(500).json({ success: false, error: 'Erro ao salvar oportunidade.' });
    }
});

// Delete opportunity route (existing)
app.delete('/oportunidades/:id', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        await db.run('DELETE FROM oportunidades WHERE id = ?', [id]);
        res.json({ success: true, message: 'Oportunidade removida com sucesso.' });
    } catch (error) {
        console.error('Erro ao remover oportunidade:', error);
        res.status(500).json({ error: 'Erro ao remover oportunidade.' });
    }
});

app.post('/calculadora', isAuthenticated, async (req, res) => {
    const calculator = new ViabilityCalculator();

    // --- CORREÇÃO ---
    // Cria uma cópia dos dados do formulário para o cálculo, convertendo para número.
    // Isso evita modificar o req.body original, que é usado para salvar a simulação.
    const inputData = { ...req.body };
    for (const key in inputData) {
        if (key !== 'tipoPagamento') {
            inputData[key] = parseFloat(inputData[key]) || 0;
        }
    }

    // Preserve boolean flags submitted by checkboxes (e.g., incluirLeiloeiro)
    inputData.incluirLeiloeiro = !!(req.body && (req.body.incluirLeiloeiro === '1' || req.body.incluirLeiloeiro === 'on' || req.body.incluirLeiloeiro === 'true'));

    // A alíquota vem como porcentagem (ex: 15), precisa ser convertida para decimal (ex: 0.15)
    if (inputData.aliquotaIRGC) {
        inputData.aliquotaIRGC = inputData.aliquotaIRGC / 100;
    }

    const results = calculator.calculateViability(inputData);

    // Busca cálculos salvos para exibir na página
    const savedCalculations = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);

    res.render('calculadora', {
        user: {
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url,
        },
        results: results, // Passa os resultados para a view
        inputData: { ...req.body, ...inputData }, // Passa TODOS os dados, originais e calculados
        savedCalculations: savedCalculations,
        success: req.query.success,
        editMode: !!req.body.calculationId, // Preserva modo de edição se ID estiver presente
        editingId: req.body.calculationId,
        editingName: req.body.editingName
    });
});

// Rota para editar cálculo salvo
app.get('/calculadora/editar/:id', isAuthenticated, async (req, res) => {
    try {
        const calculoId = req.params.id;

        // Buscar o cálculo específico
        const calculo = await db.get(
            'SELECT * FROM saved_calculations WHERE id = ? AND user_id = ?',
            [calculoId, req.session.userId]
        );

        if (!calculo) {
            return res.status(404).send('Cálculo não encontrado');
        }

        // Parse dos dados salvos
        const inputData = JSON.parse(calculo.data);

        // Buscar todos os cálculos salvos para exibir na lista
        const savedCalculations = await db.all(
            'SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC',
            [req.session.userId]
        );

        // Renderizar a calculadora com os dados pré-preenchidos
        res.render('calculadora', {
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
            results: null, // Não calcular automaticamente, usuário pode modificar
            inputData: inputData, // Dados do cálculo para pré-preencher
            savedCalculations: savedCalculations,
            success: null,
            editMode: true, // Flag para indicar modo de edição
            editingId: calculoId, // ID do cálculo sendo editado
            editingName: calculo.name // Nome do cálculo sendo editado
        });
    } catch (error) {
        console.error('Erro ao carregar cálculo para edição:', error);
        res.status(500).send('Erro ao carregar cálculo');
    }
});

// Rota para o Relatório Da Vinci (Proposta)
app.get('/da-vinci', isAuthenticated, async (req, res) => {
    try {
        const savedCalculations = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);

        res.render('da-vinci', {
            user: getUserContext(req.session),
            savedCalculations: savedCalculations
        });
    } catch (error) {
        console.error('Erro ao carregar Relatório Da Vinci:', error);
        res.status(500).send("Erro ao carregar a página.");
    }
});


app.post('/calculadora/salvar', isAuthenticated, [
    body('calculationName').notEmpty().withMessage('O nome do cálculo é obrigatório.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Idealmente, renderizar a página da calculadora novamente com o erro
        return res.status(400).redirect('/calculadora?error=missing_name');
    }

    const { calculationName, calculationId, ...inputDataRaw } = req.body;

    // --- CORREÇÃO INICIA AQUI ---
    // Preserva os dados do formulário como estão, apenas garantindo que não haja valores indefinidos.
    // A conversão para número será feita quando os dados forem usados, não ao salvar.
    const inputData = { ...inputDataRaw };
    // --- FIM DA CORREÇÃO ---

    try {
        if (calculationId) {
            // Atualizar cálculo existente
            await db.run(
                'UPDATE saved_calculations SET name = ?, data = ? WHERE id = ? AND user_id = ?',
                [calculationName, JSON.stringify(inputData), calculationId, req.session.userId]
            );
        } else {
            // Salvar novo cálculo
            await db.run(
                `INSERT INTO saved_calculations (user_id, name, data) VALUES (?, ?, ?)`,
                [req.session.userId, calculationName, JSON.stringify(inputData)] // Salva o objeto de dados brutos
            );
        }

        // Apenas salva o cálculo e redireciona. 
        // A importação para a carteira agora é feita manualmente via "Meus Imóveis" -> "Carregar Cálculo".

        return res.redirect('/calculadora?success=saved');
    } catch (error) {
        console.error('Erro ao salvar cálculo:', error);
        res.status(500).send("Erro ao salvar o cálculo.");
    }
});

// -----------------------------------
// Novas Funcionalidades (DESATIVADAS)
// -----------------------------------

// app.get('/loja', isAuthenticated, (req, res) => {
//     res.render('loja', {
//         user: {
//             username: req.session.username,
//             profile_pic_url: req.session.profile_pic_url,
//             email: req.session.email
//         }
//     });
// });

// app.get('/mineracao', isAuthenticated, (req, res) => {
//     res.render('mineracao', {
//         user: {
//             username: req.session.username,
//             profile_pic_url: req.session.profile_pic_url,
//             email: req.session.email
//         }
//     });
// });

// app.get('/mineracao/navegador', isAuthenticated, (req, res) => {
//     res.render('mineracao_browser', {
//         user: {
//             username: req.session.username,
//             profile_pic_url: req.session.profile_pic_url,
//             email: req.session.email
//         }
//     });
// });

// -----------------------------------
// Carteira / Dashboard do Lead
// -----------------------------------

// Helper: Consolidated Portfolio Data Fetching & Healing
async function getPortfolioData(userId) {
    // 1. Fetch Imoveis with Aggregated Costs
    const imoveis = await db.all(`
        SELECT
            i.*,
            (i.valor_compra + IFNULL((SELECT SUM(c.valor) FROM carteira_custos c WHERE c.imovel_id = i.id), 0)) as total_investido,
            IFNULL((SELECT SUM(c.valor) FROM carteira_custos c WHERE c.imovel_id = i.id), 0) as total_custos
        FROM carteira_imoveis i
        WHERE i.user_id = ?
        ORDER BY i.data_aquisicao DESC
    `, [userId]);

    // 2. Fetch Helper Data for Healing
    const savedCalcs = await db.all('SELECT data FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [userId]);
    const arremates = await db.all('SELECT descricao_imovel, calc_valor_venda FROM arremates WHERE user_id = ?', [userId]);

    // 3. Deep Healing Logic (In-Memory & DB Update)
    for (let imovel of imoveis) {
        let dataUpdated = false;

        // Check if vital financial data is missing
        const needsHealing = (!imovel.valor_venda_estimado || imovel.valor_venda_estimado === 0) ||
            (!imovel.condominio_estimado || imovel.condominio_estimado === 0) ||
            (!imovel.iptu_estimado || imovel.iptu_estimado === 0);

        if (needsHealing) {
            // Level 1: Match by Description in Arremates
            const arremate = arremates.find(a => a.descricao_imovel === imovel.descricao);
            if (arremate && arremate.calc_valor_venda > 0) {
                if (!imovel.valor_venda_estimado) {
                    imovel.valor_venda_estimado = arremate.calc_valor_venda;
                    dataUpdated = true;
                }
            }

            // Level 2: Match by Price in Saved Calculations (Legacy Recovery)
            // Check again if we still miss data after L1
            const stillNeedsCosts = (!imovel.condominio_estimado || imovel.condominio_estimado === 0) ||
                (!imovel.iptu_estimado || imovel.iptu_estimado === 0) ||
                (!imovel.valor_venda_estimado || imovel.valor_venda_estimado === 0);

            if (stillNeedsCosts) {
                const match = savedCalcs.find(sc => {
                    const data = JSON.parse(sc.data);
                    return Math.abs(parseFloat(data.valorArrematado) - imovel.valor_compra) < 1.0;
                });

                if (match) {
                    const data = JSON.parse(match.data);

                    if ((!imovel.valor_venda_estimado || imovel.valor_venda_estimado === 0) && data.valorVendaFinal) {
                        imovel.valor_venda_estimado = parseFloat(data.valorVendaFinal);
                        dataUpdated = true;
                    }
                    if (!imovel.condominio_estimado && data.condominioMensal) {
                        imovel.condominio_estimado = parseFloat(data.condominioMensal);
                        dataUpdated = true;
                    }
                    if (!imovel.iptu_estimado) {
                        let iptu = parseFloat(data.iptuMensal) || 0;
                        if (!iptu && data.iptuAnual) iptu = parseFloat(data.iptuAnual) / 12;
                        if (iptu > 0) {
                            imovel.iptu_estimado = iptu;
                            dataUpdated = true;
                        }
                    }
                }
            }
        }

        // Persist updates if healing occurred
        if (dataUpdated) {
            await db.run(
                'UPDATE carteira_imoveis SET valor_venda_estimado = ?, condominio_estimado = ?, iptu_estimado = ? WHERE id = ?',
                [imovel.valor_venda_estimado, imovel.condominio_estimado || 0, imovel.iptu_estimado || 0, imovel.id]
            );

            // Ensure Monthly Costs exist in Costs Table (Self-healing)
            const today = new Date().toISOString().split('T')[0];

            if (imovel.condominio_estimado > 0) {
                const hasCond = await db.get('SELECT id FROM carteira_custos WHERE imovel_id = ? AND tipo_custo = "Condomínio"', [imovel.id]);
                if (!hasCond) {
                    await db.run('INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, imovel.id, 'Condomínio', imovel.condominio_estimado, today, 'Condomínio (Recuperado)']);
                    console.log(`🔧 Healing: Added missing Condomínio cost for Imovel ${imovel.id}`);
                }
            }
            if (imovel.iptu_estimado > 0) {
                // Check if any IPTU related cost exists
                const hasIPTU = await db.get('SELECT id FROM carteira_custos WHERE imovel_id = ? AND tipo_custo = "Impostos" AND (descricao LIKE "%IPTU%" OR valor = ?)', [imovel.id, imovel.iptu_estimado]);
                if (!hasIPTU) {
                    await db.run('INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, imovel.id, 'Impostos', imovel.iptu_estimado, today, 'IPTU (Recuperado)']);
                    console.log(`🔧 Healing: Added missing IPTU cost for Imovel ${imovel.id}`);
                }
            }
        }
    }

    // 4. Calculate KPIs
    let totalInvestidoGeral = 0;
    let totalInvestidoComEstimativa = 0;
    let lucroPotencialGeral = 0;
    let totalRecorrenteMensal = 0;

    imoveis.forEach(imovel => {
        const investido = parseFloat(imovel.total_investido) || 0;
        const vendaEstimada = parseFloat(imovel.valor_venda_estimado) || 0;

        totalInvestidoGeral += investido;

        if (vendaEstimada > 0) {
            totalInvestidoComEstimativa += investido;
            const corretagem = vendaEstimada * 0.06;
            const lucroBruto = vendaEstimada - corretagem - investido;
            const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
            const lucroLiquido = lucroBruto - imposto;

            lucroPotencialGeral += lucroLiquido;
            imovel.lucro_liquido_estimado = lucroLiquido;
            imovel.roi_estimado = investido > 0 ? (lucroLiquido / investido) * 100 : 0;
        } else {
            imovel.lucro_liquido_estimado = 0;
            imovel.roi_estimado = 0;
        }

        const cond = parseFloat(imovel.condominio_estimado) || 0;
        const iptu = parseFloat(imovel.iptu_estimado) || 0;
        totalRecorrenteMensal += (cond + iptu);
    });

    const kpis = {
        total_investido: totalInvestidoGeral,
        lucro_potencial: lucroPotencialGeral,
        roi_medio: totalInvestidoComEstimativa > 0 ? ((lucroPotencialGeral / totalInvestidoComEstimativa) * 100).toFixed(1) : 0,
        total_imoveis: imoveis.length,
        custo_recorrente_mensal: totalRecorrenteMensal
    };

    // 5. Fetch Monthly Costs History
    const custosPorMes = await db.all(`
        SELECT strftime('%Y-%m', data_custo) as mes, SUM(valor) as total
        FROM carteira_custos
        WHERE user_id = ? AND data_custo >= date('now', '-12 months')
        GROUP BY mes
        ORDER BY mes ASC
    `, [userId]);

    // 6. Calculate Monthly Growth Data (Last 6 Months) for Advisor Performance
    const months = {};
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7); // YYYY-MM
        months[key] = {
            label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
            profit: 0,
            volume: 0
        };
    }

    imoveis.forEach(imovel => {
        if (imovel.data_aquisicao && imovel.lucro_liquido_estimado) {
            try {
                const dateVal = new Date(imovel.data_aquisicao);
                if (!isNaN(dateVal.getTime())) {
                    const dateKey = dateVal.toISOString().slice(0, 7);
                    if (months[dateKey]) {
                        months[dateKey].profit += parseFloat(imovel.lucro_liquido_estimado);
                        months[dateKey].volume += 1;
                    }
                }
            } catch (e) {
                console.warn(`Data inválida para imóvel ${imovel.id}:`, imovel.data_aquisicao);
            }
        }
    });

    const growthData = {
        labels: Object.values(months).map(m => m.label),
        profitData: Object.values(months).map(m => m.profit),
        volumeData: Object.values(months).map(m => m.volume)
    };

    return { imoveis, kpis, custosPorMes, growthData };
}

// ========================================
// ROTAS DE API - CLIENTES
// ========================================

// Listar todos os clientes do assessor
app.get('/api/clientes', isAuthenticated, async (req, res) => {
    try {
        const clientes = await db.all(`
            SELECT 
                c.*,
                COUNT(DISTINCT ci.id) as total_imoveis,
                COALESCE(SUM(ci.valor_compra), 0) as total_investido,
                COALESCE(SUM(ci.valor_venda_estimado), 0) as total_valor_venda
            FROM clientes c
            LEFT JOIN carteira_imoveis ci ON c.id = ci.cliente_id
            WHERE c.assessor_id = ?
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `, [req.session.userId]);

        // Calcular ROI médio para cada cliente
        const clientesComROI = await Promise.all(clientes.map(async (cliente) => {
            const imoveis = await db.all(
                'SELECT * FROM carteira_imoveis WHERE cliente_id = ?',
                [cliente.id]
            );

            let totalROI = 0;
            let countROI = 0;

            for (const imovel of imoveis) {
                const custos = await db.all(
                    'SELECT SUM(valor) as total FROM carteira_custos WHERE imovel_id = ?',
                    [imovel.id]
                );
                const totalCustos = custos[0]?.total || 0;
                const totalInvestido = (imovel.valor_compra || 0) + totalCustos;
                const valorVenda = imovel.valor_venda_estimado || 0;

                if (valorVenda > 0 && totalInvestido > 0) {
                    const corretagem = valorVenda * 0.06;
                    const lucroBruto = valorVenda - corretagem - totalInvestido;
                    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                    const lucroLiquido = lucroBruto - imposto;
                    const roi = (lucroLiquido / totalInvestido) * 100;
                    totalROI += roi;
                    countROI++;
                }
            }

            return {
                ...cliente,
                roi_medio: countROI > 0 ? totalROI / countROI : 0
            };
        }));

        res.json({ success: true, clientes: clientesComROI });
    } catch (error) {
        console.error('Erro ao listar clientes:', error);
        res.status(500).json({ success: false, error: 'Erro ao listar clientes' });
    }
});

// Criar novo cliente
app.post('/api/clientes', isAuthenticated, async (req, res) => {
    try {
        const { nome, cpf, email, telefone, status, data_inicio, observacoes } = req.body;

        if (!nome) {
            return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
        }

        const result = await db.run(`
            INSERT INTO clientes (assessor_id, nome, cpf, email, telefone, status, data_inicio, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            req.session.userId,
            nome,
            cpf || null,
            email || null,
            telefone || null,
            status || 'ativo',
            data_inicio || new Date().toISOString().split('T')[0],
            observacoes || null
        ]);

        const clienteId = result.lastID || result.stmt?.lastID;

        res.json({ success: true, clienteId });
    } catch (error) {
        console.error('Erro ao criar cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao criar cliente' });
    }
});

// Excluir cliente
app.delete('/api/clientes/:id', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;

        // Verificar se cliente existe e pertence ao usuário
        const cliente = await db.get(
            'SELECT id FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente não encontrado ou acesso negado' });
        }

        // Antes de excluir, desvincular imóveis para não perdê-los (caso cascade esteja ativo indesejadamente ou para garantir integridade)
        await db.run('UPDATE carteira_imoveis SET cliente_id = NULL WHERE cliente_id = ?', [clienteId]);

        // Excluir o cliente
        await db.run('DELETE FROM clientes WHERE id = ?', [clienteId]);

        res.json({ success: true, message: 'Cliente excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao excluir cliente' });
    }
});

// Obter detalhes de um cliente específico
app.get('/api/clientes/:id', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;

        const cliente = await db.get(
            'SELECT * FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
        }

        res.json({ success: true, cliente });
    } catch (error) {
        console.error('Erro ao obter cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao obter cliente' });
    }
});

// Atualizar cliente
app.put('/api/clientes/:id', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;
        const { nome, cpf, email, telefone, status, data_inicio, observacoes } = req.body;

        // Verificar se o cliente pertence ao assessor
        const cliente = await db.get(
            'SELECT id FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
        }

        await db.run(`
            UPDATE clientes 
            SET nome = ?, cpf = ?, email = ?, telefone = ?, status = ?, 
                data_inicio = ?, observacoes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [nome, cpf, email, telefone, status, data_inicio, observacoes, clienteId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao atualizar cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao atualizar cliente' });
    }
});

// Deletar cliente
app.delete('/api/clientes/:id', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;

        // Verificar se o cliente pertence ao assessor e pegar dados para liberar lead
        const cliente = await db.get(
            'SELECT * FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
        }

        // Verificar se há imóveis vinculados
        const imoveis = await db.get(
            'SELECT COUNT(*) as count FROM carteira_imoveis WHERE cliente_id = ?',
            [clienteId]
        );

        if (imoveis.count > 0) {
            return res.status(400).json({
                success: false,
                error: 'Não é possível deletar cliente com imóveis vinculados. Remova os imóveis primeiro.'
            });
        }

        // Se este cliente veio de um lead (identificado pelo telefone), devolve o lead para a piscina ('novo')
        if (cliente.telefone) {
            await db.run(`
                UPDATE leads 
                SET status = 'novo', claimed_by = NULL 
                WHERE whatsapp = ? AND claimed_by = ?
            `, [cliente.telefone, req.session.userId]);
        }

        await db.run('DELETE FROM clientes WHERE id = ?', [clienteId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao deletar cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao deletar cliente' });
    }
});

// Deletar imóvel da carteira
app.delete('/api/carteira/:id', isAuthenticated, async (req, res) => {
    try {
        const imovelId = req.params.id;

        // Verificar se o imóvel pertence a um cliente do assessor
        const imovel = await db.get(`
            SELECT ci.id 
            FROM carteira_imoveis ci
            JOIN clientes c ON ci.cliente_id = c.id
            WHERE ci.id = ? AND c.assessor_id = ?
        `, [imovelId, req.session.userId]);

        // Fallback: verificar se pertence diretamente ao assessor (caso legado ou sem cliente)
        const imovelDireto = await db.get(
            'SELECT id FROM carteira_imoveis WHERE id = ? AND user_id = ?',
            [imovelId, req.session.userId]
        );

        if (!imovel && !imovelDireto) {
            return res.status(404).json({ success: false, error: 'Imóvel não encontrado ou acesso negado' });
        }

        // Deletar custos associados (se houver)
        await db.run('DELETE FROM carteira_custos WHERE imovel_id = ?', [imovelId]);

        // Deletar imóvel
        await db.run('DELETE FROM carteira_imoveis WHERE id = ?', [imovelId]);

        res.json({ success: true, message: 'Imóvel excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir imóvel:', error);
        res.status(500).json({ success: false, error: 'Erro ao excluir imóvel' });
    }
});

// Dashboard do cliente específico
app.get('/api/clientes/:id/dashboard', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;

        // Verificar se o cliente pertence ao assessor
        const cliente = await db.get(
            'SELECT * FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
        }

        // Buscar imóveis do cliente
        const imoveis = await db.all(
            'SELECT * FROM carteira_imoveis WHERE cliente_id = ?',
            [clienteId]
        );

        // Calcular KPIs
        let totalInvestido = 0;
        let totalLucroEstimado = 0;
        let totalROI = 0;
        let countROI = 0;
        let custosMensaisRecorrentes = 0;

        for (const imovel of imoveis) {
            const custos = await db.all(
                'SELECT SUM(valor) as total FROM carteira_custos WHERE imovel_id = ?',
                [imovel.id]
            );
            const totalCustos = custos[0]?.total || 0;
            const investidoImovel = (imovel.valor_compra || 0) + totalCustos;
            totalInvestido += investidoImovel;

            // Priorizar valores salvos no banco (lucro_estimado e roi_estimado)
            let lucroLiquido = 0;
            let roi = 0;

            if (imovel.lucro_estimado !== null && imovel.lucro_estimado !== undefined && imovel.lucro_estimado !== 0) {
                // Usar valor salvo do banco
                lucroLiquido = imovel.lucro_estimado;
                totalLucroEstimado += lucroLiquido;
            } else {
                // Fallback: calcular manualmente se não houver valor salvo
                const valorVenda = imovel.valor_venda_estimado || 0;
                if (valorVenda > 0) {
                    const corretagem = valorVenda * 0.06;
                    const lucroBruto = valorVenda - corretagem - investidoImovel;
                    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                    lucroLiquido = lucroBruto - imposto;
                    totalLucroEstimado += lucroLiquido;
                }
            }

            // ROI: priorizar valor salvo
            if (imovel.roi_estimado !== null && imovel.roi_estimado !== undefined && imovel.roi_estimado !== 0) {
                roi = imovel.roi_estimado;
                totalROI += roi;
                countROI++;
            } else if (investidoImovel > 0 && lucroLiquido !== 0) {
                // Fallback: calcular ROI manualmente
                roi = (lucroLiquido / investidoImovel) * 100;
                totalROI += roi;
                countROI++;
            }

            // Custos mensais recorrentes
            custosMensaisRecorrentes += (imovel.condominio_estimado || 0) + (imovel.iptu_estimado || 0);
        }

        const kpis = {
            totalInvestido,
            totalLucroEstimado,
            roiMedio: countROI > 0 ? totalROI / countROI : 0,
            totalImoveis: imoveis.length,
            custosMensaisRecorrentes
        };

        res.json({ success: true, cliente, kpis, imoveis });
    } catch (error) {
        console.error('Erro ao obter dashboard do cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao obter dashboard' });
    }
});

// ========================================
// ROTAS DE CARTEIRA (MODIFICADAS)
// ========================================

// Página da carteira (dashboard) - Server-Side Rendering

app.get('/carteira', isAuthenticated, async (req, res) => {
    try {
        // Buscar todos os clientes do assessor com estatísticas
        const clientes = await db.all(`
            SELECT 
                c.*,
                COUNT(DISTINCT ci.id) as total_imoveis,
                COALESCE(SUM(ci.valor_compra), 0) as total_investido
            FROM clientes c
            LEFT JOIN carteira_imoveis ci ON c.id = ci.cliente_id
            WHERE c.assessor_id = ?
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `, [req.session.userId]);

        // Calcular KPIs consolidados de todos os clientes
        let totalImoveisGeral = 0;
        let totalClientesAtivos = 0;
        let clientesComImoveis = 0;
        let novosClientesMes = 0;
        let totalROI = 0;
        let countROI = 0;
        let totalInvestidoPorCliente = 0;

        // Data de 30 dias atrás
        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - 30);

        for (const cliente of clientes) {
            if (cliente.status === 'ativo') totalClientesAtivos++;

            // Contar novos clientes no último mês
            const dataInicio = new Date(cliente.data_inicio || cliente.created_at);
            if (dataInicio >= dataLimite) {
                novosClientesMes++;
            }

            const imoveis = await db.all(
                'SELECT * FROM carteira_imoveis WHERE cliente_id = ?',
                [cliente.id]
            );

            if (imoveis.length > 0) {
                clientesComImoveis++;
            }

            totalImoveisGeral += imoveis.length;

            let totalInvestidoCliente = 0;
            let totalLucroCliente = 0;
            let totalROICliente = 0;
            let countROICliente = 0;

            for (const imovel of imoveis) {
                const custos = await db.all(
                    'SELECT SUM(valor) as total FROM carteira_custos WHERE imovel_id = ?',
                    [imovel.id]
                );
                const totalCustos = custos[0]?.total || 0;
                const investidoImovel = (imovel.valor_compra || 0) + totalCustos;
                totalInvestidoCliente += investidoImovel;

                const valorVenda = imovel.valor_venda_estimado || 0;
                if (valorVenda > 0 && investidoImovel > 0) {
                    const corretagem = valorVenda * 0.06;
                    const lucroBruto = valorVenda - corretagem - investidoImovel;
                    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                    const lucroLiquido = lucroBruto - imposto;
                    const roi = (lucroLiquido / investidoImovel) * 100;

                    // Global Aggregation
                    totalROI += roi;
                    countROI++;

                    // Client Aggregation
                    totalLucroCliente += lucroLiquido;
                    totalROICliente += roi;
                    countROICliente++;
                }
            }

            if (totalInvestidoCliente > 0) {
                totalInvestidoPorCliente += totalInvestidoCliente;
            }

            // Attach metrics to client object for the view
            cliente.total_investido_real = totalInvestidoCliente;
            cliente.lucro_estimado = totalLucroCliente;
            cliente.roi_medio = countROICliente > 0 ? (totalROICliente / countROICliente) : 0;
        }

        const kpisGerais = {
            totalClientes: clientes.length,
            totalClientesAtivos,
            totalImoveis: totalImoveisGeral,
            clientesComImoveis,
            novosClientesMes,
            roiMedioGeral: countROI > 0 ? totalROI / countROI : 0,
            ticketMedio: clientesComImoveis > 0 ? totalInvestidoPorCliente / clientesComImoveis : 0
        };

        res.render('carteira', {
            user: getUserContext(req.session),
            clientes: clientes,
            kpis: kpisGerais
        });

    } catch (err) {
        console.error('Erro ao carregar dashboard de clientes:', err);
        res.status(500).send('Erro ao carregar dashboard de clientes.');
    }
});

// Nova rota: Carteira individual do cliente
app.get('/cliente/:id', isAuthenticated, async (req, res) => {
    try {
        const clienteId = req.params.id;

        // Verificar se o cliente pertence ao assessor
        const cliente = await db.get(
            'SELECT * FROM clientes WHERE id = ? AND assessor_id = ?',
            [clienteId, req.session.userId]
        );

        if (!cliente) {
            return res.status(404).send('Cliente não encontrado');
        }

        // Buscar imóveis do cliente
        const imoveis = await db.all(
            'SELECT * FROM carteira_imoveis WHERE cliente_id = ? ORDER BY data_aquisicao DESC',
            [clienteId]
        );

        // Calcular KPIs do cliente
        let totalInvestido = 0;
        let totalLucroEstimado = 0;
        let totalROI = 0;
        let countROI = 0;
        let custosMensaisRecorrentes = 0;

        const imoveisComDetalhes = [];

        for (const imovel of imoveis) {
            const custos = await db.all(
                'SELECT * FROM carteira_custos WHERE imovel_id = ? ORDER BY data_custo DESC',
                [imovel.id]
            );
            const totalCustos = custos.reduce((sum, c) => sum + (c.valor || 0), 0);
            const investidoImovel = (imovel.valor_compra || 0) + totalCustos;
            totalInvestido += investidoImovel;

            let lucroLiquido = 0;
            let roi = 0;

            // Priorizar valores salvos no banco
            if (imovel.lucro_estimado !== null && imovel.lucro_estimado !== undefined && imovel.lucro_estimado !== 0) {
                lucroLiquido = imovel.lucro_estimado;
                totalLucroEstimado += lucroLiquido;
            } else {
                // Fallback: calcular manualmente
                const valorVenda = imovel.valor_venda_estimado || 0;
                if (valorVenda > 0) {
                    const corretagem = valorVenda * 0.06;
                    const lucroBruto = valorVenda - corretagem - investidoImovel;
                    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                    lucroLiquido = lucroBruto - imposto;
                    totalLucroEstimado += lucroLiquido;
                }
            }

            // ROI: priorizar valor salvo
            if (imovel.roi_estimado !== null && imovel.roi_estimado !== undefined && imovel.roi_estimado !== 0) {
                roi = imovel.roi_estimado;
                totalROI += roi;
                countROI++;
            } else if (investidoImovel > 0 && lucroLiquido !== 0) {
                roi = (lucroLiquido / investidoImovel) * 100;
                totalROI += roi;
                countROI++;
            }

            // Custos mensais recorrentes
            const custosMensais = (imovel.condominio_estimado || 0) + (imovel.iptu_estimado || 0);
            custosMensaisRecorrentes += custosMensais;

            imoveisComDetalhes.push({
                ...imovel,
                totalCustos,
                totalInvestido: investidoImovel,
                lucroLiquido,
                roi,
                custosMensais
            });
        }

        // Buscar histórico de custos mensais
        const custosPorMes = await db.all(`
            SELECT 
                strftime('%Y-%m', cc.data_custo) as mes,
                SUM(cc.valor) as total
            FROM carteira_custos cc
            INNER JOIN carteira_imoveis ci ON cc.imovel_id = ci.id
            WHERE ci.cliente_id = ?
            GROUP BY mes
            ORDER BY mes DESC
            LIMIT 12
        `, [clienteId]);

        const kpis = {
            totalInvestido,
            totalLucroEstimado,
            roiMedio: countROI > 0 ? totalROI / countROI : 0,
            totalImoveis: imoveis.length,
            custosMensaisRecorrentes
        };

        res.render('cliente-detalhes', {
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
            cliente: cliente,
            imoveis: imoveisComDetalhes,
            kpis: kpis,
            custosPorMes: custosPorMes
        });

    } catch (err) {
        console.error('Erro ao carregar carteira do cliente:', err);
        res.status(500).send('Erro ao carregar carteira do cliente.');
    }
});

// Rota para página de detalhes do imóvel
app.get('/carteira/:id', isAuthenticated, async (req, res) => {
    try {
        const imovelId = req.params.id;

        // Buscar dados do imóvel
        const imovel = await db.get(
            'SELECT * FROM carteira_imoveis WHERE id = ? AND user_id = ?',
            [imovelId, req.session.userId]
        );

        if (!imovel) {
            return res.status(404).send('Imóvel não encontrado');
        }

        // Buscar custos do imóvel
        const custos = await db.all(
            'SELECT * FROM carteira_custos WHERE imovel_id = ? ORDER BY data_custo DESC',
            [imovelId]
        );

        // Buscar cliente associado ao imóvel (se houver)
        let cliente = null;
        if (imovel.cliente_id) {
            cliente = await db.get(
                'SELECT id, nome FROM clientes WHERE id = ? AND assessor_id = ?',
                [imovel.cliente_id, req.session.userId]
            );
        }

        // Calcular totais
        const totalCustos = custos.reduce((sum, c) => sum + (c.valor || 0), 0);
        const totalInvestido = (imovel.valor_compra || 0) + totalCustos;

        // Cálculo de Lucro Líquido (Padronizado)
        const valorVenda = imovel.valor_venda_estimado || 0;
        let lucroLiquido = 0;
        let roi = 0;

        if (valorVenda > 0) {
            const corretagem = valorVenda * 0.06;
            const lucroBruto = valorVenda - corretagem - totalInvestido;
            const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
            lucroLiquido = lucroBruto - imposto;

            roi = totalInvestido > 0 ? (lucroLiquido / totalInvestido) * 100 : 0;
        }

        res.render('imovel-detalhes', {
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
            imovel: imovel,
            cliente: cliente, // Adiciona cliente ao contexto
            custos: custos,
            totais: {
                custos: totalCustos,
                investido: totalInvestido,
                lucro: lucroLiquido,
                roi: roi
            }
        });

    } catch (err) {
        console.error('Erro ao carregar detalhes do imóvel:', err);
        res.status(500).send('Erro ao carregar detalhes do imóvel.');
    }
});



// Rota para editar imóvel da carteira
app.get('/carteira/edit/:id', isAuthenticated, async (req, res) => {
    try {
        const imovel = await db.get('SELECT * FROM carteira_imoveis WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!imovel) {
            return res.status(404).send("Imóvel não encontrado.");
        }
        res.render('editar-imovel', {
            imovel: imovel,
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            }
        });
    } catch (error) {
        console.error('Erro ao carregar imóvel para edição:', error);
        res.status(500).send("Erro ao carregar página de edição.");
    }
});

app.post('/carteira/edit/:id', isAuthenticated, async (req, res) => {
    const { descricao, endereco, status, valor_compra, valor_venda_estimado, data_aquisicao, observacoes, condominio_estimado, iptu_estimado } = req.body;

    // Helper para extrair números de strings formatadas (pt-BR) ou números puros
    const parseMonetary = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') return val;

        const strVal = val.toString().trim();

        // Se tiver vírgula, assume formato BRL (Ex: "1.000,00" ou "10,50")
        if (strVal.includes(',')) {
            const clean = strVal.replace(/[^\d,-]/g, '');
            return parseFloat(clean.replace(',', '.')) || 0;
        }

        // Se NÃO tiver vírgula, assume formato Standard/US (Ex: "1000.00")
        const clean = strVal.replace(/[^\d.-]/g, '');
        return parseFloat(clean) || 0;
    };

    try {
        // Buscar custos existentes para cálculo preciso
        const custos = await db.all('SELECT valor FROM carteira_custos WHERE imovel_id = ?', [req.params.id]);
        const totalCustos = custos.reduce((sum, c) => sum + (c.valor || 0), 0);

        const vCompra = parseMonetary(valor_compra);
        const vVenda = parseMonetary(valor_venda_estimado);
        const investimentoTotal = vCompra + totalCustos;

        let lucroEstimado = 0;
        let roiEstimado = 0;

        if (vVenda > 0) {
            const corretagem = vVenda * 0.06;
            const lucroBruto = vVenda - corretagem - investimentoTotal;
            const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
            lucroEstimado = lucroBruto - imposto;

            if (investimentoTotal > 0) {
                roiEstimado = (lucroEstimado / investimentoTotal) * 100;
            }
        }

        await db.run(
            `UPDATE carteira_imoveis 
             SET descricao = ?, endereco = ?, status = ?, valor_compra = ?, valor_venda_estimado = ?, data_aquisicao = ?, observacoes = ?, condominio_estimado = ?, iptu_estimado = ?, lucro_estimado = ?, roi_estimado = ?
             WHERE id = ? AND user_id = ?`,
            [
                descricao,
                endereco,
                status,
                vCompra, // Usar valor parseado
                vVenda,  // Usar valor parseado
                data_aquisicao,
                observacoes,
                parseMonetary(condominio_estimado),
                parseMonetary(iptu_estimado),
                lucroEstimado,
                roiEstimado,
                req.params.id,
                req.session.userId
            ]
        );
        res.redirect(`/carteira/${req.params.id}`);
    } catch (error) {
        console.error('Erro ao atualizar imóvel:', error);
        res.status(500).send("Erro ao salvar alterações.");
    }
});

// --- DEBUG ROUTE (Temporary) ---
app.get('/debug/force-heal', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        const imoveis = await db.all('SELECT * FROM carteira_imoveis WHERE user_id = ?', [userId]);
        const savedCalcs = await db.all('SELECT * FROM saved_calculations WHERE user_id = ?', [userId]);
        const arremates = await db.all('SELECT * FROM arremates WHERE user_id = ?', [userId]);

        let logs = [];
        logs.push(`Found ${imoveis.length} imoveis, ${savedCalcs.length} saved calcs, ${arremates.length} arremates.`);

        for (let imovel of imoveis) {
            logs.push(`Checking Imovel ${imovel.id} (${imovel.descricao})... Venda: ${imovel.valor_venda_estimado}, Cond: ${imovel.condominio_estimado}`);

            // Level 1: Arremates
            const arremate = arremates.find(a => a.descricao_imovel === imovel.descricao);
            if (arremate) {
                logs.push(`  -> Found Arremate Match (L1): ID ${arremate.id}. Venda: ${arremate.calc_valor_venda}`);
                if (arremate.calc_valor_venda > 0) {
                    await db.run('UPDATE carteira_imoveis SET valor_venda_estimado = ? WHERE id = ?', [arremate.calc_valor_venda, imovel.id]);
                    logs.push(`  -> UPDATED Venda from Arremate.`);
                }
            } else {
                logs.push(`  -> No Arremate match for description '${imovel.descricao}'`);
            }

            // Level 2: Saved Calcs
            const match = savedCalcs.find(sc => {
                const data = JSON.parse(sc.data);
                return Math.abs(parseFloat(data.valorArrematado) - imovel.valor_compra) < 1.0;
            });

            if (match) {
                const data = JSON.parse(match.data);
                logs.push(`  -> Found SavedCalc Match (L2): ID ${match.id}. Venda: ${data.valorVendaFinal}, Cond: ${data.condominioMensal}`);

                await db.run('UPDATE carteira_imoveis SET valor_venda_estimado = ?, condominio_estimado = ?, iptu_estimado = ? WHERE id = ?',
                    [parseFloat(data.valorVendaFinal) || imovel.valor_venda_estimado,
                    parseFloat(data.condominioMensal) || imovel.condominio_estimado || 0,
                    (parseFloat(data.iptuMensal) || (parseFloat(data.iptuAnual) / 12)) || imovel.iptu_estimado || 0,
                    imovel.id]
                );
                logs.push(`  -> UPDATED Metrics from SavedCalc.`);
            } else {
                logs.push(`  -> No SavedCalc match for value ${imovel.valor_compra}`);
            }
        }
        res.json({ logs });
    } catch (e) {
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

// --- NOVAS ROTAS DA API DA CARTEIRA ---

// Dashboard Data (KPIs e Gráficos)
app.get('/api/portfolio/dashboard', isAuthenticated, async (req, res) => {
    try {
        const { imoveis, kpis, custosPorMes } = await getPortfolioData(req.session.userId);

        // Structure the response to match what the client expects
        // Client expects { ...kpis, custosPorMes: [], distribuicaoCustos: [] }

        // Fetch distribution separately as it (currently) wasn't in the helper but is needed here
        // Or we add it to the helper. For now let's keep it here or add to helper.
        // Let's add it here to keep helper focused on "Core Data".
        // Actually, the client uses `distribuicaoCustos`.

        const distribuicaoCustos = await db.all(`
            SELECT tipo_custo, SUM(valor) as total
            FROM carteira_custos
            WHERE user_id = ?
            GROUP BY tipo_custo
        `, [req.session.userId]);

        res.json({
            ...kpis,
            distribuicaoCustos,
            custosPorMes
        });
    } catch (err) {
        console.error('Erro no dashboard:', err);
        res.status(500).json({ error: 'Erro ao carregar dashboard' });
    }
});


// Listar todos os imóveis do portfólio
// Helper: Consolidated Portfolio Data Fetching & Healing
// (Already defined above)

// ========================================
// FUNIL DE VENDAS (LEAD GENERATION)
// ========================================

// Rota Pública do Funil
app.get('/start', (req, res) => {
    res.render('funnel');
});

// Processamento do Lead (API)
app.post('/api/leads/submit', async (req, res) => {
    try {
        const { nome, whatsapp, objetivo, experiencia, restricao_nome, capital_disponivel, preferencia_pgto, estado, cidade, interesse } = req.body;

        // Scoring Logic (Simples)
        let score = 50; // Começa com média

        // 0. Experiência
        if (experiencia === 'ja_arrematei') score += 10;

        // 1. Capital
        if (capital_disponivel >= 200000) score += 30;
        else if (capital_disponivel >= 50000) score += 15;
        else score -= 10;

        // 2. Pagamento
        if (preferencia_pgto === 'vista') score += 10; // Cash is king

        // 3. Restrição (Deal breaker for financing, but ok for cash)
        const isRestricted = restricao_nome === 'true'; // Vem como string do form
        if (isRestricted) {
            score -= 20;
            // Se tiver restrição mas muito dinheiro, ainda é bom
            if (capital_disponivel < 50000) score -= 20; // Bad combo
        } else {
            score += 10;
        }

        // Cap score 0-100
        score = Math.min(100, Math.max(0, score));

        // Save to DB
        // Capturar dados de rastreamento
        const ip_address = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const fingerprint = req.body.fingerprint || null;

        await db.run(`
        INSERT INTO leads (
            nome, whatsapp, objetivo, experiencia, restricao_nome, 
            capital_entrada, preferencia_pgto, estado, cidade, interesse, score,
            ip_address, fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            nome,
            whatsapp,
            objetivo,
            experiencia || 'primeira_vez',
            isRestricted ? 1 : 0,
            capital_disponivel,
            preferencia_pgto,
            estado || '',
            cidade || '',
            interesse || 'nao_informado',
            score,
            ip_address,
            fingerprint
        ]);
        res.json({ success: true, score: score });

    } catch (error) {
        console.error('Erro ao salvar lead:', error);
        res.status(500).json({ success: false, error: 'Erro ao processar perfil.' });
    }
});

// ========================================

// ========================================
// ÁREA DO ASSESSOR (LEADS POOL)
// ========================================

// Rota de Histórico de Distribuição de Leads (Admin)
app.get('/admin/leads-history', isAuthenticated, async (req, res) => {
    try {
        const leads = await db.all(`
            SELECT 
                l.*, 
                u.username as assessor_nome,
                u.profile_pic_url as assessor_pic
            FROM leads l 
            LEFT JOIN users u ON l.claimed_by = u.id 
            WHERE l.status != 'novo' 
            ORDER BY l.updated_at DESC
        `);

        res.render('leads_history', {
            leads,
            user: { ...req.session, isAdmin: req.session.isAdmin },
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url
        });
    } catch (error) {
        console.error('Erro ao carregar histórico de leads:', error);
        res.status(500).send("Erro ao carregar histórico.");
    }
});

// Listar Leads Disponíveis (Piscina)
app.get('/leads', isAuthenticated, async (req, res) => {
    try {
        // Busca leads 'novos' ou 'desqualificados' (histórico)
        // Ordena por Score (Melhores primeiro)
        const leads = await db.all(`
            SELECT * FROM leads 
            WHERE status = 'novo' 
            ORDER BY score DESC, created_at DESC
        `);

        res.render('leads-pool', {
            leads: leads,
            user: getUserContext(req.session),
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url
        });
    } catch (error) {
        console.error('Erro ao listar leads:', error);
        res.status(500).send("Erro ao carregar leads.");
    }
});

// Puxar Lead (Claim)
app.post('/api/leads/claim/:id', isAuthenticated, async (req, res) => {
    try {
        const leadId = req.params.id;
        const advisorId = req.session.userId;

        // 1. Verifica se o lead ainda está disponível
        const lead = await db.get('SELECT * FROM leads WHERE id = ? AND status = "novo"', [leadId]);

        if (!lead) {
            return res.status(400).send('Lead não encontrado ou já assumido por outro assessor.');
        }

        // 2. Marca como 'contactado' na tabela leads e vincula ao assessor
        await db.run('UPDATE leads SET status = ?, claimed_by = ? WHERE id = ?', ['contactado', advisorId, leadId]);

        // 3. Cria automaticamente o registro na tabela 'clientes' do assessor
        await db.run(`
            INSERT INTO clientes (
                assessor_id, nome, email, telefone, status, data_inicio, observacoes
            ) VALUES (?, ?, ?, ?, 'ativo', date('now'), ?)
        `, [
            advisorId,
            lead.nome,
            'email@pendente.com', // Placeholder 
            lead.whatsapp,
            `Lead vindo do Funil (Score: ${lead.score}). Objetivo: ${lead.objetivo}. Capital: ${(lead.capital_entrada || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
        ]);

        console.log(`✅ Assessor ${advisorId} puxou o lead ${leadId} (${lead.nome})`);
        res.redirect('/leads'); // Recarrega a página

    } catch (error) {
        console.error('Erro ao puxar lead:', error);
        res.status(500).send("Erro ao processar sua solicitação.");
    }
});

// Rota API para buscar imóveis (consumida pelo front)
app.get('/api/portfolio/imoveis', isAuthenticated, async (req, res) => {
    try {
        const { imoveis } = await getPortfolioData(req.session.userId);
        res.json(imoveis);
    } catch (err) {
        console.error('Erro ao buscar imóveis:', err);
        res.status(500).json({ error: 'Erro ao buscar imóveis' });
    }
});

// Adicionar um novo imóvel
app.post('/api/portfolio/imoveis', isAuthenticated, async (req, res) => {
    try {
        const { descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, lucro_estimado, roi_estimado } = req.body;
        if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });

        const result = await db.run(
            'INSERT INTO carteira_imoveis (user_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, lucro_estimado, roi_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.session.userId, descricao, endereco, valor_compra || 0, data_aquisicao || null, valor_venda_estimado || 0, lucro_estimado || 0, roi_estimado || 0]
        );
        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error('Erro ao adicionar imóvel:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Obter detalhes de um imóvel específico (incluindo custos)
app.get('/api/portfolio/imoveis/:id', isAuthenticated, async (req, res) => {
    try {
        const imovel = await db.get('SELECT * FROM carteira_imoveis WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!imovel) return res.status(404).json({ error: 'Imóvel não encontrado' });

        const custos = await db.all('SELECT * FROM carteira_custos WHERE imovel_id = ? ORDER BY data_custo DESC', [req.params.id]);
        imovel.custos = custos;

        res.json(imovel);
    } catch (err) {
        console.error('Erro ao buscar detalhes do imóvel:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Adicionar um custo a um imóvel
app.post('/api/portfolio/imoveis/:id/custos', isAuthenticated, async (req, res) => {
    try {
        const { tipo_custo, descricao, valor, data_custo } = req.body;
        console.log(`📝 Recebendo novo custo: Imóvel = ${req.params.id}, Tipo = ${tipo_custo}, Valor = ${valor}, Data = ${data_custo}`);
        if (!tipo_custo || !valor) return res.status(400).json({ error: 'Tipo e valor do custo são obrigatórios' });

        const today = new Date().toISOString().split('T')[0];
        const result = await db.run(
            'INSERT INTO carteira_custos (imovel_id, user_id, tipo_custo, descricao, valor, data_custo) VALUES (?, ?, ?, ?, ?, ?)',
            [req.params.id, req.session.userId, tipo_custo, descricao, valor, data_custo || today]
        );
        res.status(201).json({ id: result.lastID });
    } catch (err) {
        console.error('Erro ao adicionar custo:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Deletar um custo
app.delete('/api/portfolio/custos/:id', isAuthenticated, async (req, res) => {
    try {
        // Garante que o custo pertence ao usuário logado
        const custo = await db.get('SELECT id FROM carteira_custos WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!custo) return res.status(404).json({ error: 'Custo não encontrado' });

        await db.run('DELETE FROM carteira_custos WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Erro ao deletar custo:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Lançar custos mensais (Condomínio + IPTU) para o mês atual
app.post('/api/portfolio/imoveis/:id/lancar-mensais', isAuthenticated, async (req, res) => {
    try {
        const imovelId = req.params.id;
        const imovel = await db.get('SELECT * FROM carteira_imoveis WHERE id = ? AND user_id = ?', [imovelId, req.session.userId]);

        if (!imovel) return res.status(404).json({ error: 'Imóvel não encontrado' });

        const today = new Date();
        const dataCusto = today.toISOString().split('T')[0];
        const mesAno = today.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const mesCapitalized = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);

        let added = 0;

        // Lança Condomínio se houver estimativa
        if (imovel.condominio_estimado > 0) {
            await db.run(
                'INSERT INTO carteira_custos (imovel_id, user_id, tipo_custo, descricao, valor, data_custo) VALUES (?, ?, ?, ?, ?, ?)',
                [imovelId, req.session.userId, 'Condomínio', `Condomínio - ${mesCapitalized}`, imovel.condominio_estimado, dataCusto]
            );
            added++;
        }

        // Lança IPTU se houver estimativa
        if (imovel.iptu_estimado > 0) {
            await db.run(
                'INSERT INTO carteira_custos (imovel_id, user_id, tipo_custo, descricao, valor, data_custo) VALUES (?, ?, ?, ?, ?, ?)',
                [imovelId, req.session.userId, 'Impostos', `IPTU - ${mesCapitalized}`, imovel.iptu_estimado, dataCusto]
            );
            added++;
        }

        if (added > 0) {
            res.json({ success: true, message: `${added} custos lançados com sucesso.` });
        } else {
            res.status(400).json({ error: 'Nenhum valor estimado configurado para este imóvel.' });
        }

    } catch (err) {
        console.error('Erro ao lançar custos mensais:', err);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// API para dados do Dashboard
// Aplicar rate limiter em todas as rotas /api/*
app.use('/api/', apiLimiter);



// --- Middleware de Tratamento de Erros (deve ser o último middleware) ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    // Evita vazar detalhes do erro em produção
    res.status(500).send('Ocorreu um erro inesperado no servidor.');
});

// --- Inicialização do Servidor ---
(async () => {
    // ensureTables runs via top-level await at line 473

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
})();