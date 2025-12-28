/**
 * Sistema de Cache Local para Arremata!
 * Evita recarregamentos desnecessários usando localStorage e sessionStorage
 * 
 * @author Antigravity
 */

class CacheManager {
    constructor() {
        this.prefix = 'arremata_';
        this.defaultTTL = 5 * 60 * 1000; // 5 minutos padrão
    }

    /**
     * Gera chave única para o cache
     */
    _getKey(key, userId = null) {
        const user = userId || this._getCurrentUserId();
        return `${this.prefix}${user}_${key}`;
    }

    /**
     * Obtém ID do usuário atual da sessão
     */
    _getCurrentUserId() {
        // Tenta pegar do sessionStorage primeiro
        let userId = sessionStorage.getItem(`${this.prefix}current_user_id`);
        if (!userId) {
            // Gera um ID temporário se não existir
            userId = `temp_${Date.now()}`;
            sessionStorage.setItem(`${this.prefix}current_user_id`, userId);
        }
        return userId;
    }

    /**
     * Define o ID do usuário atual
     */
    setCurrentUserId(userId) {
        sessionStorage.setItem(`${this.prefix}current_user_id`, userId);
    }

    /**
     * Salva dados no cache com TTL
     */
    set(key, data, ttl = this.defaultTTL, useSession = false) {
        const storage = useSession ? sessionStorage : localStorage;
        const cacheKey = this._getKey(key);

        const cacheData = {
            data: data,
            timestamp: Date.now(),
            ttl: ttl,
            version: '1.0'
        };

        try {
            storage.setItem(cacheKey, JSON.stringify(cacheData));
            console.log(`✅ Cache salvo: ${key} (TTL: ${ttl}ms)`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar cache:', error);
            // Se der erro de quota, limpa cache antigo
            if (error.name === 'QuotaExceededError') {
                this.clearExpired();
                // Tenta novamente
                try {
                    storage.setItem(cacheKey, JSON.stringify(cacheData));
                    return true;
                } catch (e) {
                    console.error('❌ Erro ao salvar cache após limpeza:', e);
                    return false;
                }
            }
            return false;
        }
    }

    /**
     * Obtém dados do cache
     */
    get(key, useSession = false) {
        const storage = useSession ? sessionStorage : localStorage;
        const cacheKey = this._getKey(key);

        try {
            const cached = storage.getItem(cacheKey);
            if (!cached) {
                console.log(`⚠️ Cache não encontrado: ${key}`);
                return null;
            }

            const cacheData = JSON.parse(cached);
            const now = Date.now();
            const age = now - cacheData.timestamp;

            // Verifica se expirou
            if (age > cacheData.ttl) {
                console.log(`⏰ Cache expirado: ${key} (idade: ${age}ms, TTL: ${cacheData.ttl}ms)`);
                storage.removeItem(cacheKey);
                return null;
            }

            console.log(`✅ Cache válido: ${key} (idade: ${age}ms)`);
            return cacheData.data;
        } catch (error) {
            console.error('❌ Erro ao ler cache:', error);
            storage.removeItem(cacheKey);
            return null;
        }
    }

    /**
     * Remove item específico do cache
     */
    remove(key, useSession = false) {
        const storage = useSession ? sessionStorage : localStorage;
        const cacheKey = this._getKey(key);
        storage.removeItem(cacheKey);
        console.log(`🗑️ Cache removido: ${key}`);
    }

    /**
     * Limpa todo o cache do usuário atual
     */
    clearUser() {
        const userId = this._getCurrentUserId();
        const prefix = `${this.prefix}${userId}_`;

        // Limpa localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(prefix)) {
                localStorage.removeItem(key);
            }
        });

        // Limpa sessionStorage
        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith(prefix)) {
                sessionStorage.removeItem(key);
            }
        });

        console.log(`🗑️ Cache do usuário limpo: ${userId}`);
    }

    /**
     * Limpa cache expirado
     */
    clearExpired() {
        const now = Date.now();
        let cleared = 0;

        // Limpa localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(this.prefix)) {
                try {
                    const cached = JSON.parse(localStorage.getItem(key));
                    if (now - cached.timestamp > cached.ttl) {
                        localStorage.removeItem(key);
                        cleared++;
                    }
                } catch (e) {
                    // Remove se não conseguir parsear
                    localStorage.removeItem(key);
                    cleared++;
                }
            }
        });

        console.log(`🗑️ ${cleared} itens expirados removidos`);
        return cleared;
    }

    /**
     * Limpa todo o cache da aplicação
     */
    clearAll() {
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(this.prefix)) {
                localStorage.removeItem(key);
            }
        });

        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith(this.prefix)) {
                sessionStorage.removeItem(key);
            }
        });

        console.log('🗑️ Todo o cache limpo');
    }

    /**
     * Obtém estatísticas do cache
     */
    getStats() {
        const stats = {
            localStorage: {
                total: 0,
                valid: 0,
                expired: 0,
                size: 0
            },
            sessionStorage: {
                total: 0,
                valid: 0,
                expired: 0,
                size: 0
            }
        };

        const now = Date.now();

        // Analisa localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith(this.prefix)) {
                stats.localStorage.total++;
                stats.localStorage.size += localStorage.getItem(key).length;

                try {
                    const cached = JSON.parse(localStorage.getItem(key));
                    if (now - cached.timestamp > cached.ttl) {
                        stats.localStorage.expired++;
                    } else {
                        stats.localStorage.valid++;
                    }
                } catch (e) {
                    stats.localStorage.expired++;
                }
            }
        });

        // Analisa sessionStorage
        Object.keys(sessionStorage).forEach(key => {
            if (key.startsWith(this.prefix)) {
                stats.sessionStorage.total++;
                stats.sessionStorage.size += sessionStorage.getItem(key).length;

                try {
                    const cached = JSON.parse(sessionStorage.getItem(key));
                    if (now - cached.timestamp > cached.ttl) {
                        stats.sessionStorage.expired++;
                    } else {
                        stats.sessionStorage.valid++;
                    }
                } catch (e) {
                    stats.sessionStorage.expired++;
                }
            }
        });

        return stats;
    }
}

// Instância global
const cache = new CacheManager();

// Limpa cache expirado ao carregar a página
window.addEventListener('load', () => {
    cache.clearExpired();
});

// Exporta para uso global
if (typeof window !== 'undefined') {
    window.CacheManager = CacheManager;
    window.cache = cache;
}

// Helper functions para uso fácil

/**
 * Busca dados com cache automático
 * @param {string} url - URL da API
 * @param {Object} options - Opções do fetch
 * @param {number} cacheTTL - Tempo de vida do cache em ms (padrão: 5 minutos)
 * @param {boolean} forceRefresh - Força atualização ignorando cache
 */
async function fetchWithCache(url, options = {}, cacheTTL = 5 * 60 * 1000, forceRefresh = false) {
    const cacheKey = `api_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Tenta obter do cache primeiro
    if (!forceRefresh) {
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log(`📦 Usando cache para: ${url}`);
            return cached;
        }
    }

    // Busca da API
    console.log(`🌐 Buscando da API: ${url}`);
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Salva no cache
        cache.set(cacheKey, data, cacheTTL);

        return data;
    } catch (error) {
        console.error('❌ Erro ao buscar dados:', error);

        // Tenta retornar cache expirado em caso de erro
        const expired = localStorage.getItem(cache._getKey(cacheKey));
        if (expired) {
            console.log('⚠️ Usando cache expirado devido a erro de rede');
            return JSON.parse(expired).data;
        }

        throw error;
    }
}

/**
 * Invalida cache de uma URL específica
 */
function invalidateCache(url) {
    const cacheKey = `api_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;
    cache.remove(cacheKey);
}

// Exporta helpers
if (typeof window !== 'undefined') {
    window.fetchWithCache = fetchWithCache;
    window.invalidateCache = invalidateCache;
}
