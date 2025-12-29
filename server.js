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
import { createClient } from '@supabase/supabase-js';

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
    'image/gif': '.gif'
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
        cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype}. Apenas imagens são aceitas.`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo
        files: 1 // Apenas 1 arquivo por vez
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
    res.locals.supabaseUrl = process.env.SUPABASE_URL || '';
    res.locals.supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
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

// Helper: parse list of admin emails from env (comma separated)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// --- Supabase (server-side) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
    console.warn('Supabase não está configurado (variáveis de ambiente ausentes). Autenticação via Supabase ficará indisponível.');
}

// --- Middleware de Autenticação ---
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
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

// Rota de Login
app.get('/login', (req, res) => {
    // Renderiza a página de login. O cliente usará res.locals.supabaseAnonKey para iniciar o Supabase JS.
    res.render('login', { message: req.query.message || null });
});

// Rota para criar convites (admin)
app.post('/admin/invites', isAuthenticated, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).send('E-mail é obrigatório');

        const crypto = await import('crypto');
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

        await db.run('INSERT INTO invites (email, token, created_by, expires_at) VALUES (?, ?, ?, ?)', [email, token, req.session.userId, expiresAt.toISOString()]);

        const inviteUrl = `${req.protocol}://${req.get('host')}/invite/accept?token=${token}`;




        // (Integração n8n removida)


        res.redirect('/admin/invites');
    } catch (err) {
        console.error('Erro ao criar convite:', err);
        res.status(500).send('Erro ao criar convite');
    }
});

// Página pública para aceitar convite (lead)
app.get('/invite/accept', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send('Token inválido');
    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [token]);
        if (!invite) return res.status(400).send('Convite inválido');
        if (invite.used) return res.status(400).send('Convite já utilizado');
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(400).send('Convite expirado');

        // renderiza página pedindo username e senha
        res.render('invite_accept', { token: token, email: invite.email, error: null });
    } catch (err) {
        console.error('Erro em invite/accept:', err);
        res.status(500).send('Erro interno');
    }
});

// Processa criação de conta a partir do convite (server cria o usuário no Supabase via admin)
app.post('/invite/accept', async (req, res) => {
    const { token, username, password } = req.body;
    if (!token || !username || !password) return res.status(400).send('Dados incompletos');
    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [token]);
        if (!invite) return res.status(400).send('Convite inválido');
        if (invite.used) return res.status(400).send('Convite já utilizado');
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(400).send('Convite expirado');
        if (!supabaseAdmin) return res.status(500).send('Supabase não configurado');

        // Cria usuário no Supabase via admin
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: invite.email,
            password: password,
            user_metadata: { username }
        });
        if (error) {
            console.error('Erro ao criar usuário Supabase:', error);
            return res.status(500).send('Erro ao criar usuário');
        }

        const sbUser = data.user || data;

        // marca invite como usado
        await db.run('UPDATE invites SET used = 1 WHERE id = ?', [invite.id]);

        // cria usuário local mapeado
        const result = await db.run('INSERT INTO users (username, password, profile_pic_url, email, supabase_id, supabase_metadata) VALUES (?, ?, ?, ?, ?, ?)', [username, '', null, invite.email, sbUser.id, JSON.stringify(sbUser.user_metadata || {})]);
        const newId = result.lastID || result.stmt?.lastID;

        // cria sessão e redireciona para perfil
        req.session.userId = newId;
        req.session.username = username;
        req.session.email = invite.email;
        req.session.profile_pic_url = null;
        req.session.isAdmin = !!(ADMIN_EMAILS.includes(invite.email.toLowerCase()));

        res.redirect('/perfil?success=registered');
    } catch (err) {
        console.error('Erro em POST /invite/accept:', err);
        return res.status(500).send('Erro interno');
    }
});

// -----------------------
// Rotas do Chat / Integração com n8n - REMOVIDAS
// -----------------------

// Endpoint que cria sessão local a partir do access_token do Supabase (POST JSON { access_token })
app.post('/session', authLimiter, async (req, res) => {
    try {
        const { access_token } = req.body;
        if (!access_token) return res.status(400).json({ error: 'access_token is required' });
        if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase server client not configured' });

        // Verifica o token e obtém o usuário do Supabase
        const { data, error } = await supabaseAdmin.auth.getUser(access_token);
        if (error || !data?.user) {
            console.error('Erro ao obter usuário do Supabase:', error);
            return res.status(401).json({ error: 'Invalid token' });
        }
        const sbUser = data.user;

        const supabase_id = sbUser.id;
        const email = sbUser.email || sbUser.user_metadata?.email || null;
        const avatar = sbUser.user_metadata?.avatar_url || sbUser.user_metadata?.picture || null;

        // Procura usuário local por supabase_id primeiro, depois por email
        let localUser = null;
        if (supabase_id) {
            localUser = await db.get('SELECT * FROM users WHERE supabase_id = ?', [supabase_id]);
        }
        if (!localUser && email) {
            localUser = await db.get('SELECT * FROM users WHERE email = ? OR username = ?', [email, email]);
        }

        if (localUser) {
            // Atualiza dados locais (foto, email, supabase_id) caso necessário
            await db.run('UPDATE users SET supabase_id = ?, email = ?, profile_pic_url = ?, supabase_metadata = ? WHERE id = ?', [supabase_id, email || localUser.email, avatar || localUser.profile_pic_url, JSON.stringify(sbUser.user_metadata || {}), localUser.id]);
        } else {
            const result = await db.run(
                'INSERT INTO users (username, password, profile_pic_url, email, supabase_id, supabase_metadata) VALUES (?, ?, ?, ?, ?, ?)',
                [email || supabase_id, '', avatar, email, supabase_id, JSON.stringify(sbUser.user_metadata || {})]
            );
            const newId = result.lastID || result.stmt?.lastID;
            localUser = await db.get('SELECT * FROM users WHERE id = ?', [newId]);
        }

        // Cria sessão local compatível com resto da aplicação
        req.session.userId = localUser.id;
        req.session.username = localUser.username;
        req.session.profile_pic_url = localUser.profile_pic_url;
        req.session.email = localUser.email || '';
        // marca se é admin localmente (coluna is_admin) ou se o email está na lista ADMIN_EMAILS
        req.session.isAdmin = !!(localUser.is_admin || (localUser.email && ADMIN_EMAILS.includes(localUser.email.toLowerCase())));

        return res.json({ ok: true });
    } catch (err) {
        console.error('Erro criando sessão a partir do Supabase token:', err);
        return res.status(500).json({ error: 'server error' });
    }
});

// Rota principal da aplicação (protegida)
app.get('/', isAuthenticated, (req, res) => {
    res.render('index', {
        username: req.session.username, // Placeholder
        email: req.session.email || 'Acesso de Lead',
        profile_pic_url: req.session.profile_pic_url
    });
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
        res.render('historico', { arremates: arrematesFormatados, username: req.session.username, email: req.session.email || 'Acesso de Lead', profile_pic_url: req.session.profile_pic_url });
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
            if (!val) return 0;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                // Remove tudo que não for dígito, vírgula ou sinal de menos
                // Ex: "R$ 1.200,50" -> "1200,50"
                const cleanStr = val.replace(/[^\d,-]/g, '');
                // Troca vírgula por ponto e converte
                return parseFloat(cleanStr.replace(',', '.')) || 0;
            }
            return 0;
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
            'INSERT INTO carteira_imoveis (user_id, cliente_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, status, condominio_estimado, iptu_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
                parseMonetary(iptuMensal) || 0
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
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
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

// Importar cálculo salvo para a carteira
app.post('/api/portfolio/import-calculation/:id', isAuthenticated, async (req, res) => {
    try {
        const calc = await db.get('SELECT * FROM saved_calculations WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!calc) return res.status(404).json({ error: 'Cálculo não encontrado' });

        const data = JSON.parse(calc.data);

        // Mapear dados do cálculo para a estrutura da carteira
        // Assumindo que 'data' tem campos como valorArrematado, valorVendaFinal, etc.
        const descricao = calc.name;
        const valorCompra = data.valorArrematado || 0;
        const valorVendaEstimado = data.valorVendaFinal || 0;

        // Inserir na carteira
        const result = await db.run(
            'INSERT INTO carteira_imoveis (user_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, status, condominio_estimado, iptu_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                req.session.userId,
                descricao,
                'Endereço a definir',
                valorCompra,
                new Date().toISOString().split('T')[0],
                valorVendaEstimado,
                'Arrematado',
                parseFloat(data.condominioMensal) || 0,
                (parseFloat(data.iptuAnual) / 12) || (parseFloat(data.iptuMensal) || 0)
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
        success: req.query.success
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
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
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

    const { calculationName, ...inputDataRaw } = req.body;

    // --- CORREÇÃO INICIA AQUI ---
    // Preserva os dados do formulário como estão, apenas garantindo que não haja valores indefinidos.
    // A conversão para número será feita quando os dados forem usados, não ao salvar.
    const inputData = { ...inputDataRaw };
    // --- FIM DA CORREÇÃO ---

    try {
        await db.run(
            `INSERT INTO saved_calculations (user_id, name, data) VALUES (?, ?, ?)`,
            [req.session.userId, calculationName, JSON.stringify(inputData)] // Salva o objeto de dados brutos
        );

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

app.get('/guia', isAuthenticated, (req, res) => {
    res.render('guia', {
        user: {
            username: req.session.username,
            profile_pic_url: req.session.profile_pic_url,
            email: req.session.email
        }
    });
});

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

    return { imoveis, kpis, custosPorMes };
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

        // Verificar se o cliente pertence ao assessor
        const cliente = await db.get(
            'SELECT id FROM clientes WHERE id = ? AND assessor_id = ?',
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

        await db.run('DELETE FROM clientes WHERE id = ?', [clienteId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao deletar cliente:', error);
        res.status(500).json({ success: false, error: 'Erro ao deletar cliente' });
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

            const valorVenda = imovel.valor_venda_estimado || 0;
            if (valorVenda > 0) {
                const corretagem = valorVenda * 0.06;
                const lucroBruto = valorVenda - corretagem - investidoImovel;
                const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                const lucroLiquido = lucroBruto - imposto;
                totalLucroEstimado += lucroLiquido;

                if (investidoImovel > 0) {
                    const roi = (lucroLiquido / investidoImovel) * 100;
                    totalROI += roi;
                    countROI++;
                }
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
            user: {
                username: req.session.username,
                profile_pic_url: req.session.profile_pic_url
            },
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

            const valorVenda = imovel.valor_venda_estimado || 0;
            let lucroLiquido = 0;
            let roi = 0;

            if (valorVenda > 0) {
                const corretagem = valorVenda * 0.06;
                const lucroBruto = valorVenda - corretagem - investidoImovel;
                const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                lucroLiquido = lucroBruto - imposto;
                totalLucroEstimado += lucroLiquido;

                if (investidoImovel > 0) {
                    roi = (lucroLiquido / investidoImovel) * 100;
                    totalROI += roi;
                    countROI++;
                }
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
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            // Remove tudo que não for dígito, vírgula ou sinal de menos
            const cleanStr = val.replace(/[^\d,-]/g, '');
            return parseFloat(cleanStr.replace(',', '.')) || 0;
        }
        return 0;
    };

    try {
        await db.run(
            `UPDATE carteira_imoveis 
             SET descricao = ?, endereco = ?, status = ?, valor_compra = ?, valor_venda_estimado = ?, data_aquisicao = ?, observacoes = ?, condominio_estimado = ?, iptu_estimado = ?
             WHERE id = ? AND user_id = ?`,
            [
                descricao,
                endereco,
                status,
                parseMonetary(valor_compra),
                parseMonetary(valor_venda_estimado),
                data_aquisicao,
                observacoes,
                parseMonetary(condominio_estimado),
                parseMonetary(iptu_estimado),
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
        const { descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado } = req.body;
        if (!descricao) return res.status(400).json({ error: 'Descrição é obrigatória' });

        const result = await db.run(
            'INSERT INTO carteira_imoveis (user_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado) VALUES (?, ?, ?, ?, ?, ?)',
            [req.session.userId, descricao, endereco, valor_compra || 0, data_aquisicao || null, valor_venda_estimado || 0]
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