import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
import { open } from 'sqlite';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import ViabilityCalculator from './ViabilityCalculator.js';
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

// Proxy para recursos estáticos
app.use('/fotos', createProxyMiddleware(caixaProxyOptions));
app.use('/imagens', createProxyMiddleware(caixaProxyOptions));
app.use('/assets', createProxyMiddleware(caixaProxyOptions));
app.use('/fotos/*', createProxyMiddleware(caixaProxyOptions));
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
await db.run('PRAGMA journal_mode = WAL');
await db.run('PRAGMA synchronous = NORMAL');
await db.run('PRAGMA cache_size = -64000');
await db.run('PRAGMA temp_store = MEMORY');
await db.run('PRAGMA mmap_size = 30000000000');
await db.run('PRAGMA page_size = 4096');
console.log('✅ SQLite otimizado com WAL mode e cache aumentado');

// --- Middlewares ---

// 1. Compressão GZIP
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// 2. Helmet - Segurança
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 3. Logging
if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined'));
} else {
    app.use(morgan('dev'));
}

// 4. CORS
const corsOptions = {
    origin: true,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};
app.use(cors(corsOptions));

// 5. Proteção contra poluição de parâmetros
app.use((req, res, next) => {
    for (const key in req.query) {
        if (Array.isArray(req.query[key]) && req.query[key].length > 10) {
            return res.status(400).json({ error: 'Muitos parâmetros na query string' });
        }
    }
    next();
});

// 6. Sanitização básica
const sanitizeInput = (str) => {
    if (typeof str !== 'string') return str;
    return str
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
};

app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        for (const key in req.body) {
            if (typeof req.body[key] === 'string') req.body[key] = sanitizeInput(req.body[key]);
        }
    }
    if (req.query && typeof req.query === 'object') {
        for (const key in req.query) {
            if (typeof req.query[key] === 'string') req.query[key] = sanitizeInput(req.query[key]);
        }
    }
    next();
});

// 7. Headers de segurança adicionais
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (req.path.includes('/perfil') || req.path.includes('/admin')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// 8. Safe Compare
const crypto = await import('crypto');
const safeCompare = (a, b) => {
    try {
        return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b)));
    } catch {
        return false;
    }
};
app.locals.safeCompare = safeCompare;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Configuração do Multer ---
const ALLOWED_FILE_TYPES = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif'
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/'); },
    filename: function (req, file, cb) {
        const sanitizedOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = ALLOWED_FILE_TYPES[file.mimetype] || path.extname(sanitizedOriginalName);
        cb(null, `${req.session.userId}-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (ALLOWED_FILE_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error(`Tipo não permitido: ${file.mimetype}`), false);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

// --- Configuração da Sessão ---
const SQLiteStoreSession = SQLiteStore(session);
app.use(session({
    store: new SQLiteStoreSession({
        db: 'database.sqlite',
        dir: path.join(__dirname, 'db'),
        table: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'fallback_secreto_temporario', // Adicionado fallback para evitar crash
    resave: false,
    saveUninitialized: false,
    name: 'arremata.sid',
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
    },
    rolling: true
}));

// --- Template Engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
    res.locals.supabaseUrl = process.env.SUPABASE_URL || '';
    res.locals.supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
    res.locals.username = req.session?.username || '';
    res.locals.email = req.session?.email || '';
    res.locals.profile_pic_url = req.session?.profile_pic_url || '';
    res.locals.isAdmin = req.session?.isAdmin || false;
    next();
});

// --- Auto-migrations ---
async function ensureTables() {
    console.log('⚙️  Verificando integridade do banco de dados...');
    
    // Users
    const tblUsers = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    if (!tblUsers) {
        await db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT, profile_pic_url TEXT, email TEXT, supabase_id TEXT, is_admin INTEGER DEFAULT 0, supabase_metadata TEXT)`);
    } else {
        const cols = await db.all("PRAGMA table_info('users')");
        const colNames = cols.map(c => c.name);
        if (!colNames.includes('email')) await db.run("ALTER TABLE users ADD COLUMN email TEXT");
        if (!colNames.includes('supabase_id')) await db.run("ALTER TABLE users ADD COLUMN supabase_id TEXT");
        if (!colNames.includes('is_admin')) await db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
        if (!colNames.includes('supabase_metadata')) await db.run("ALTER TABLE users ADD COLUMN supabase_metadata TEXT");
    }
    await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_id)");
    await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");

    // Saved Calculations
    await db.run(`CREATE TABLE IF NOT EXISTS saved_calculations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    // Arremates
    await db.run(`CREATE TABLE IF NOT EXISTS arremates (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, descricao_imovel TEXT, endereco TEXT, data_arremate DATE, valor_arremate REAL, leiloeiro TEXT, edital TEXT, calc_valor_avaliacao REAL, calc_custo_itbi REAL, calc_custo_registro REAL, calc_custo_leiloeiro REAL, calc_custo_reforma REAL, calc_outros_custos REAL, calc_valor_venda REAL, calc_custo_corretagem REAL, calc_imposto_ganho_capital REAL, calc_lucro_liquido REAL, calc_roi_liquido REAL)`);

    // Clientes
    await db.run(`CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, assessor_id INTEGER NOT NULL, nome TEXT NOT NULL, cpf TEXT, email TEXT, telefone TEXT, status TEXT DEFAULT 'ativo', data_inicio DATE, observacoes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(assessor_id) REFERENCES users(id) ON DELETE CASCADE)`);

    // Carteira
    await db.run(`CREATE TABLE IF NOT EXISTS carteira_imoveis (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, descricao TEXT, endereco TEXT, valor_compra REAL, data_aquisicao DATE, valor_venda_estimado REAL, status TEXT DEFAULT 'Arrematado')`);
    
    // Migrações Carteira
    try {
        const tableInfo = await db.all("PRAGMA table_info(carteira_imoveis)");
        const columns = tableInfo.map(c => c.name);
        if (!columns.includes('condominio_estimado')) await db.run("ALTER TABLE carteira_imoveis ADD COLUMN condominio_estimado REAL DEFAULT 0");
        if (!columns.includes('iptu_estimado')) await db.run("ALTER TABLE carteira_imoveis ADD COLUMN iptu_estimado REAL DEFAULT 0");
        if (!columns.includes('cliente_id')) await db.run("ALTER TABLE carteira_imoveis ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE");
    } catch (e) { console.error(e); }

    await db.run(`CREATE TABLE IF NOT EXISTS carteira_custos (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, imovel_id INTEGER, tipo_custo TEXT, valor REAL, data_custo DATE, descricao TEXT)`);

    // Invites
    await db.run(`CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, token TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME, used INTEGER DEFAULT 0)`);
}

await ensureTables();

async function createIndexes() {
    await db.run('CREATE INDEX IF NOT EXISTS idx_arremates_user_id ON arremates(user_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_clientes_assessor ON clientes(assessor_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_imoveis_user_id ON carteira_imoveis(user_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_imoveis_cliente ON carteira_imoveis(cliente_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_carteira_custos_imovel_id ON carteira_custos(imovel_id)');
    
    // Migração de status e clientes padrão
    await db.run("UPDATE carteira_imoveis SET status = 'Arrematado' WHERE status = 'Em Análise' OR status IS NULL");
    
    const assessores = await db.all("SELECT DISTINCT user_id FROM carteira_imoveis WHERE cliente_id IS NULL");
    for (const assessor of assessores) {
        if (!assessor.user_id) continue;
        const clienteExistente = await db.get("SELECT id FROM clientes WHERE assessor_id = ? AND nome = 'Carteira Principal'", [assessor.user_id]);
        let clienteId;
        if (!clienteExistente) {
            const result = await db.run("INSERT INTO clientes (assessor_id, nome, status, data_inicio, observacoes) VALUES (?, 'Carteira Principal', 'ativo', date('now'), 'Carteira criada automaticamente')", [assessor.user_id]);
            clienteId = result.lastID;
        } else {
            clienteId = clienteExistente.id;
        }
        await db.run("UPDATE carteira_imoveis SET cliente_id = ? WHERE user_id = ? AND cliente_id IS NULL", [clienteId, assessor.user_id]);
    }
}
await createIndexes();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// --- Supabase ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// --- Auth Middleware ---
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/login');
};

// --- Rate Limiting ---
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

// ========================================
// ROTAS
// ========================================

app.get('/login', (req, res) => res.render('login', { message: req.query.message || null }));

app.post('/admin/invites', isAuthenticated, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).send('E-mail obrigatório');
        const token = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.run('INSERT INTO invites (email, token, created_by, expires_at) VALUES (?, ?, ?, ?)', [email, token, req.session.userId, expiresAt.toISOString()]);
        res.redirect('/admin/invites');
    } catch (err) { res.status(500).send('Erro ao criar convite'); }
});

app.get('/invite/accept', async (req, res) => {
    const { token } = req.query;
    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [token]);
        if (!invite || invite.used) return res.status(400).send('Convite inválido ou usado');
        res.render('invite_accept', { token: token, email: invite.email, error: null });
    } catch { res.status(500).send('Erro interno'); }
});

app.post('/invite/accept', async (req, res) => {
    const { token, username, password } = req.body;
    try {
        const invite = await db.get('SELECT * FROM invites WHERE token = ?', [token]);
        if (!invite || invite.used) return res.status(400).send('Inválido');
        if (!supabaseAdmin) return res.status(500).send('Supabase erro');

        const { data, error } = await supabaseAdmin.auth.admin.createUser({
            email: invite.email, password: password, user_metadata: { username }
        });
        if (error) return res.status(500).send('Erro criar user');

        await db.run('UPDATE invites SET used = 1 WHERE id = ?', [invite.id]);
        const result = await db.run('INSERT INTO users (username, password, profile_pic_url, email, supabase_id, supabase_metadata) VALUES (?, ?, ?, ?, ?, ?)', [username, '', null, invite.email, data.user.id, JSON.stringify(data.user.user_metadata || {})]);
        
        req.session.userId = result.lastID;
        req.session.username = username;
        req.session.email = invite.email;
        req.session.profile_pic_url = null;
        res.redirect('/perfil?success=registered');
    } catch (e) { console.error(e); res.status(500).send('Erro'); }
});

app.post('/session', authLimiter, async (req, res) => {
    try {
        const { access_token } = req.body;
        if (!supabaseAdmin) return res.status(500).json({ error: 'No Supabase' });
        const { data, error } = await supabaseAdmin.auth.getUser(access_token);
        if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

        const sbUser = data.user;
        let localUser = await db.get('SELECT * FROM users WHERE supabase_id = ?', [sbUser.id]);
        
        if (!localUser && sbUser.email) {
            localUser = await db.get('SELECT * FROM users WHERE email = ?', [sbUser.email]);
        }

        if (localUser) {
            await db.run('UPDATE users SET supabase_id = ?, email = ?, profile_pic_url = ?, supabase_metadata = ? WHERE id = ?', [sbUser.id, sbUser.email, sbUser.user_metadata?.avatar_url, JSON.stringify(sbUser.user_metadata || {}), localUser.id]);
        } else {
            const result = await db.run('INSERT INTO users (username, password, profile_pic_url, email, supabase_id, supabase_metadata) VALUES (?, ?, ?, ?, ?, ?)', [sbUser.email, '', sbUser.user_metadata?.avatar_url, sbUser.email, sbUser.id, JSON.stringify(sbUser.user_metadata || {})]);
            localUser = await db.get('SELECT * FROM users WHERE id = ?', [result.lastID]);
        }

        req.session.userId = localUser.id;
        req.session.username = localUser.username;
        req.session.email = localUser.email;
        req.session.profile_pic_url = localUser.profile_pic_url;
        req.session.isAdmin = !!(localUser.is_admin || ADMIN_EMAILS.includes(localUser.email?.toLowerCase()));
        
        return res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/', isAuthenticated, (req, res) => {
    res.render('index', { username: req.session.username, email: req.session.email, profile_pic_url: req.session.profile_pic_url });
});

app.get('/perfil', isAuthenticated, async (req, res) => {
    try {
        const user = await db.get('SELECT id, username, profile_pic_url FROM users WHERE id = ?', [req.session.userId]);
        res.render('perfil', { user, success: req.query.success, error: req.query.error });
    } catch { res.status(500).send("Erro perfil"); }
});

app.post('/perfil/update-photo', uploadLimiter, isAuthenticated, upload.single('profilePhoto'), async (req, res) => {
    if (!req.file) return res.redirect('/perfil?error=photo');
    const url = `/uploads/${req.file.filename}`;
    await db.run('UPDATE users SET profile_pic_url = ? WHERE id = ?', [url, req.session.userId]);
    req.session.profile_pic_url = url;
    res.redirect('/perfil?success=photo');
});

app.post('/perfil/update-info', isAuthenticated, async (req, res) => {
    await db.run('UPDATE users SET username = ? WHERE id = ?', [req.body.username, req.session.userId]);
    req.session.username = req.body.username;
    res.redirect('/perfil?success=info');
});

app.post('/perfil/reset-all-data', isAuthenticated, async (req, res) => {
    const uid = req.session.userId;
    await db.run('DELETE FROM saved_calculations WHERE user_id = ?', [uid]);
    await db.run('DELETE FROM arremates WHERE user_id = ?', [uid]);
    await db.run('DELETE FROM carteira_custos WHERE user_id = ?', [uid]);
    await db.run('DELETE FROM carteira_imoveis WHERE user_id = ?', [uid]);
    res.json({ success: true });
});

// --- Histórico ---
app.get('/historico', isAuthenticated, async (req, res) => {
    const arremates = await db.all('SELECT * FROM arremates WHERE user_id = ? ORDER BY data_arremate DESC', [req.session.userId]);
    const formatados = arremates.map(i => ({...i, valor_formatado: i.valor_arremate.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}));
    res.render('historico', { arremates: formatados, username: req.session.username, email: req.session.email, profile_pic_url: req.session.profile_pic_url });
});

app.get('/historico/add', isAuthenticated, (req, res) => {
    const calcData = req.session.calcData || {};
    delete req.session.calcData;
    res.render('adicionar-arremate', { user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url }, calcData, errors: [] });
});

app.post('/historico/add', isAuthenticated, async (req, res) => {
    const { descricao_imovel, endereco, data_arremate, valor_arremate, calc_valor_venda, condominioMensal, iptuMensal, cliente_id, ...others } = req.body;
    const parse = (v) => typeof v === 'string' ? parseFloat(v.replace(/[^\d,-]/g, '').replace(',', '.')) || 0 : v || 0;
    
    await db.run(`INSERT INTO arremates (user_id, descricao_imovel, endereco, data_arremate, valor_arremate, leiloeiro, edital, calc_valor_avaliacao, calc_custo_itbi, calc_custo_registro, calc_custo_leiloeiro, calc_custo_reforma, calc_outros_custos, calc_valor_venda, calc_custo_corretagem, calc_imposto_ganho_capital, calc_lucro_liquido, calc_roi_liquido) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.session.userId, descricao_imovel, endereco, data_arremate, parse(valor_arremate), req.body.leiloeiro, req.body.edital, parse(others.calc_valor_avaliacao), parse(others.calc_custo_itbi), parse(others.calc_custo_registro), parse(others.calc_custo_leiloeiro), parse(others.calc_custo_reforma), parse(others.calc_outros_custos), parse(calc_valor_venda), parse(others.calc_custo_corretagem), parse(others.calc_imposto_ganho_capital), parse(others.calc_lucro_liquido), parse(others.calc_roi_liquido)]
    );

    const carteiraResult = await db.run('INSERT INTO carteira_imoveis (user_id, cliente_id, descricao, endereco, valor_compra, data_aquisicao, valor_venda_estimado, status, condominio_estimado, iptu_estimado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.session.userId, cliente_id || null, descricao_imovel, endereco || 'A definir', parse(valor_arremate), data_arremate, parse(calc_valor_venda), 'Arrematado', parse(condominioMensal), parse(iptuMensal)]
    );

    const imovelId = carteiraResult.lastID;
    const addCusto = async (tipo, valor, desc) => {
        if (parse(valor) > 0) await db.run('INSERT INTO carteira_custos (user_id, imovel_id, tipo_custo, valor, data_custo, descricao) VALUES (?,?,?,?,?,?)', [req.session.userId, imovelId, tipo, parse(valor), data_arremate, desc]);
    };

    await addCusto('Reforma', others.calc_custo_reforma, 'Estimativa Reforma');
    await addCusto('Impostos', others.calc_custo_itbi, 'ITBI');
    await addCusto('Documentação', others.calc_custo_registro, 'Registro');
    await addCusto('Comissão', others.calc_custo_leiloeiro, 'Leiloeiro');
    await addCusto('Outros', others.calc_outros_custos, 'Outros');
    if (parse(condominioMensal) > 0) await addCusto('Condomínio', condominioMensal, 'Estimativa Mensal');
    if (parse(iptuMensal) > 0) await addCusto('Impostos', iptuMensal, 'IPTU Mensal');

    res.redirect('/historico');
});

// --- Calculadora ---
app.get('/calculadora', isAuthenticated, async (req, res) => {
    const saved = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
    res.render('calculadora', { user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url }, results: null, inputData: {}, savedCalculations: saved, success: req.query.success });
});

app.post('/calculadora', isAuthenticated, async (req, res) => {
    const calculator = new ViabilityCalculator();
    const inputData = { ...req.body };
    for (const key in inputData) if (key !== 'tipoPagamento') inputData[key] = parseFloat(inputData[key]) || 0;
    inputData.incluirLeiloeiro = !!(req.body.incluirLeiloeiro === '1' || req.body.incluirLeiloeiro === 'on');
    if (inputData.aliquotaIRGC) inputData.aliquotaIRGC = inputData.aliquotaIRGC / 100;
    
    const results = calculator.calculateViability(inputData);
    const saved = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
    
    res.render('calculadora', { user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url }, results, inputData: { ...req.body, ...inputData }, savedCalculations: saved, success: req.query.success });
});

app.post('/calculadora/salvar', isAuthenticated, async (req, res) => {
    if (!req.body.calculationName) return res.redirect('/calculadora?error=missing_name');
    await db.run(`INSERT INTO saved_calculations (user_id, name, data) VALUES (?, ?, ?)`, [req.session.userId, req.body.calculationName, JSON.stringify(req.body)]);
    res.redirect('/calculadora?success=saved');
});

app.get('/calculadora/editar/:id', isAuthenticated, async (req, res) => {
    const calc = await db.get('SELECT * FROM saved_calculations WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
    if (!calc) return res.status(404).send('Não encontrado');
    const saved = await db.all('SELECT * FROM saved_calculations WHERE user_id = ? ORDER BY id DESC', [req.session.userId]);
    res.render('calculadora', { user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url }, results: null, inputData: JSON.parse(calc.data), savedCalculations: saved, success: null, editMode: true, editingId: req.params.id, editingName: calc.name });
});

// --- Carteira & Dashboard ---
async function getPortfolioData(userId) {
    const imoveis = await db.all(`SELECT i.*, (i.valor_compra + IFNULL((SELECT SUM(c.valor) FROM carteira_custos c WHERE c.imovel_id = i.id), 0)) as total_investido FROM carteira_imoveis i WHERE i.user_id = ? ORDER BY i.data_aquisicao DESC`, [userId]);
    
    let totalInvestidoGeral = 0;
    let lucroPotencialGeral = 0;
    let totalInvestidoComEstimativa = 0;

    imoveis.forEach(imovel => {
        const investido = parseFloat(imovel.total_investido) || 0;
        const venda = parseFloat(imovel.valor_venda_estimado) || 0;
        totalInvestidoGeral += investido;
        if (venda > 0) {
            totalInvestidoComEstimativa += investido;
            const liquido = venda - (venda * 0.06) - investido - ((venda - (venda * 0.06) - investido) * 0.15);
            lucroPotencialGeral += liquido;
        }
    });

    return { imoveis, kpis: { total_investido: totalInvestidoGeral, lucro_potencial: lucroPotencialGeral, total_imoveis: imoveis.length } };
}

app.get('/carteira', isAuthenticated, async (req, res) => {
    // Dashboard simplificado para server-side
    const clientes = await db.all(`SELECT c.*, COUNT(ci.id) as total_imoveis FROM clientes c LEFT JOIN carteira_imoveis ci ON c.id = ci.cliente_id WHERE c.assessor_id = ? GROUP BY c.id`, [req.session.userId]);
    res.render('carteira', { user: { username: req.session.username, profile_pic_url: req.session.profile_pic_url }, clientes, kpis: { totalClientes: clientes.length } });
});

// --- API Rotas ---
app.use('/api/', apiLimiter);

app.get('/api/clientes', isAuthenticated, async (req, res) => {
    const clientes = await db.all('SELECT * FROM clientes WHERE assessor_id = ?', [req.session.userId]);
    res.json({ success: true, clientes });
});

app.post('/api/clientes', isAuthenticated, async (req, res) => {
    const { nome, cpf, email, telefone, status } = req.body;
    const result = await db.run('INSERT INTO clientes (assessor_id, nome, cpf, email, telefone, status, data_inicio) VALUES (?,?,?,?,?,?, date("now"))', [req.session.userId, nome, cpf, email, telefone, status]);
    res.json({ success: true, clienteId: result.lastID });
});

app.get('/api/portfolio/imoveis', isAuthenticated, async (req, res) => {
    const { imoveis } = await getPortfolioData(req.session.userId);
    res.json(imoveis);
});

// --- Error Handler ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Erro no servidor.');
});

// --- SERVER START (FIXED) ---
(async () => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
    });
})();
