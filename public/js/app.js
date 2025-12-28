import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js';

// Firebase Configuration - REPLACE WITH YOUR CONFIG
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase only when a real config is provided
let FIREBASE_ENABLED = true;
if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('YOUR')) {
    console.warn('Firebase config appears to be a placeholder. Firestore will be disabled in the UI.');
    FIREBASE_ENABLED = false;
}

let app = null;
let db = null;
let storage = null;
if (FIREBASE_ENABLED) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    storage = getStorage(app);
}

// --- FUNÇÃO GLOBAL DE FORMATAÇÃO DE MOEDA ---
window.formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
};

// State Management
let currentFilter = 'geral'; // Inicia em Geral


// DOM Elements
const menuItems = document.querySelectorAll('.menu-item');
const comunidadeSection = document.getElementById('comunidadeSection');
const postsContainer = document.getElementById('postsContainer');

const adminOnlyFooter = document.getElementById('adminOnlyFooter');
const communityTitle = document.getElementById('communityTitle');
const mainHeaderTitle = document.getElementById('mainHeaderTitle');
const profileBtn = document.getElementById('profileBtn');
const profilePopup = document.getElementById('profilePopup'); // This is populated by EJS now
const themeToggleBtn = document.getElementById('themeToggleBtn');
const profileName = document.getElementById('profileName'); // This is populated by EJS now
const profileEmail = document.getElementById('profileEmail'); // This is populated by EJS now;
const currentUser = document.getElementById('app-script')?.dataset.username;

// Perfil do Administrador para posts da comunidade
const appProfile = {
    name: "Equipe Arremata!", // Nome do App
    // Use a placeholder externo para evitar 404 local durante desenvolvimento
    pic: "/images/perfil1.svg" // Foto do App/Equipe (local placeholder)
};

// Reset header title on click
if (mainHeaderTitle) {
    mainHeaderTitle.addEventListener('click', () => {
        mainHeaderTitle.textContent = 'Arremata!';
    });
}

// Theme Toggle logic moved to /js/theme.js

// Profile Popup Toggle
if (profileBtn) {
    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Impede que o clique feche o popup imediatamente
        if (profilePopup) {
            profilePopup.classList.toggle('hidden');
            profilePopup.classList.toggle('opacity-0');
            profilePopup.classList.toggle('scale-95');
        }
    });
}

// Close popups when clicking outside
document.addEventListener('click', (e) => {
    if (profilePopup && !profilePopup.classList.contains('hidden') && !profilePopup.contains(e.target) && (!profileBtn || !profileBtn.contains(e.target))) {
        profilePopup.classList.add('hidden', 'opacity-0', 'scale-95');
    }
});

// Menu Navigation (only if menu items exist)
if (menuItems.length > 0) {
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            // Verifica se é um link para outra página (não tem data-section ou data-filter)
            const section = item.dataset.section;
            const filter = item.dataset.filter;
            const href = item.getAttribute('href');

            // Se for um link direto para outra página (ex: /carteira, /calculadora), deixa o navegador seguir
            if (!section && !filter && href && !href.startsWith('#')) {
                return;
            }

            // Se estivermos em outra página e clicarmos em um link de âncora (ex: /#agenteia), deixa o navegador ir para a home
            if (window.location.pathname !== '/' && href && href.startsWith('/#')) {
                return;
            }

            // A partir daqui, estamos na home e é uma navegação interna (SPA)

            // Remove classe ativa de todos e adiciona no atual
            menuItems.forEach(mi => mi.classList.remove('active'));
            item.classList.add('active');

            // Se não tiver section definida (ex: links simples), retorna
            if (!section) return;

            // Previne comportamento padrão apenas para navegação interna
            e.preventDefault();

            // Atualiza o título do cabeçalho
            if (mainHeaderTitle) {
                if (filter === 'agenteia') {
                    mainHeaderTitle.textContent = 'Arremata!';
                } else {
                    const span = item.querySelector('span:not(.w-8)'); // Pega o texto, ignorando o ícone
                    if (span) mainHeaderTitle.textContent = span.textContent;
                }
            }

            if (section === 'comunidade' && comunidadeSection) {
                currentFilter = filter;
                showSection('comunidade');

                const clearBtn = document.getElementById('clearChatBtn');

                // Lógica para mostrar/esconder formulários e botões
                if (filter === 'geral') {
                    if (communityTitle) communityTitle.textContent = 'Comunidade - Arremata Todo Dia';
                } else {
                    const span = item.querySelector('span:not(.w-8)');
                    if (communityTitle && span) communityTitle.textContent = span.textContent;
                }
                if (adminOnlyFooter) adminOnlyFooter.classList.remove('hidden');
                loadPosts(filter);
            }
        });
    });
}



// Função para ativar um menu item programaticamente
function activateMenuItem(filter) {
    const itemToActivate = document.querySelector(`.menu-item[data-filter="${filter}"]`) || document.querySelector(`.menu-item[data-section="${filter}"]`);
    if (itemToActivate) {
        itemToActivate.click();
    }
}

// Verifica o hash da URL ao carregar a página
function handleHashChange() {
    const hash = window.location.hash.substring(1);
    if (hash) {
        activateMenuItem(hash);
    }
}

// Show/Hide Sections
function showSection(section) {
    if (comunidadeSection) comunidadeSection.classList.add('hidden');

    if (section === 'comunidade' && comunidadeSection) {
        comunidadeSection.classList.remove('hidden');
    }
}

// --- Dados de Exemplo para a Comunidade ---
const examplePosts = {
    geral: [
        { author: appProfile.name, profilePic: appProfile.pic, content: "Olá comunidade! Bem-vindos ao nosso canal oficial. Fiquem atentos para novidades e dicas exclusivas sobre leilões.", createdAt: new Date(Date.now() - 3600000) },
        { author: appProfile.name, profilePic: appProfile.pic, content: "Lembrete: a próxima vídeo aula sobre 'Análise de Edital' será liberada amanhã. Não percam!", createdAt: new Date() }
    ],
    arrematacoes: [
        { author: appProfile.name, profilePic: appProfile.pic, content: "Parabéns ao membro João Silva pela excelente arrematação de um terreno em São Paulo esta semana! 👏 Sucesso!", createdAt: new Date() }
    ],
    casas: [
        { author: appProfile.name, profilePic: appProfile.pic, content: "Oportunidade única: Casa com 3 quartos em Belo Horizonte, lance inicial 50% abaixo do valor de mercado. Edital disponível na seção de documentos.", createdAt: new Date() }
    ],
    apartamentos: [
        { author: appProfile.name, profilePic: appProfile.pic, content: "Fiquem de olho! Um lote de apartamentos no Rio de Janeiro entrará em leilão na próxima semana. Mais detalhes em breve.", createdAt: new Date() }
    ],
    materiais: [
        { author: appProfile.name, profilePic: appProfile.pic, content: "Dica do dia: Leilões de materiais de construção são uma ótima forma de economizar na sua reforma. Procure por leilões da Receita Federal.", createdAt: new Date() }
    ]
};

function renderPosts(postsArray) {
    postsContainer.innerHTML = '';
    postsArray.forEach((post) => {
        const date = post.createdAt ? new Date(post.createdAt).toLocaleString('pt-BR', { timeStyle: 'short', dateStyle: 'short' }) : 'Agora';
        const isAdminPost = post.isAdmin === true;

        const postElement = document.createElement('div');
        let headerHtml = '';

        // Estilo diferente para admin (esquerda) e usuário (direita) no chat da IA
        if (currentFilter === 'agenteia' && !isAdminPost) {
            postElement.className = `flex flex-col bg-[var(--chat-bubble-user)] rounded-xl p-3 max-w-xl lg:max-w-2xl ml-auto`; // Mensagem do usuário
            headerHtml = `<div class="flex items-center justify-end mb-2">
                                    <span class="font-semibold text-[var(--text-secondary)] mr-3">Você</span>
                                    <img src="${post.profilePic}" alt="${post.author}" class="w-8 h-8 rounded-full object-cover">
                                  </div>`;
        } else {
            postElement.className = `flex flex-col bg-[var(--chat-bubble-admin)] rounded-xl p-3 max-w-xl lg:max-w-2xl`; // Mensagem do Admin/Canal
            headerHtml = `<div class="flex items-center mb-2">
                                    <img src="${post.profilePic}" alt="${post.author}" class="w-8 h-8 rounded-full mr-3 object-cover">
                                    <span class="font-semibold text-[var(--text-accent)]">${post.author}</span>
                                  </div>`;
        }

        postElement.innerHTML = `
            ${headerHtml}
            
            ${post.imageUrl ? `<img src="${post.imageUrl}" class="rounded-lg mb-2 max-h-64 object-contain">` : ''}
            
            <p class="text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">${post.content ? post.content.replace(/\n/g, '<br>') : ''}</p>
            <div class="self-end mt-1 flex items-center">
                <span class="text-sm text-[var(--text-secondary)] mr-1">${date}</span>
                <svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                </svg>
            </div>
        `;
        postsContainer.appendChild(postElement);
    });
}

// Load Posts
async function loadPosts(filter) {
    if (!postsContainer) return; // Exit if container not found

    // If Firebase isn't configured, show the static example posts
    if (!FIREBASE_ENABLED) {
        // Non-IA categories: show static examples
        if (examplePosts[filter]) {
            renderPosts(examplePosts[filter]);
        } else {
            postsContainer.innerHTML = `<div class="card rounded-xl p-8 text-center"><p class="text-[var(--text-secondary)]">Nenhum post encontrado nesta categoria.</p></div>`;
        }
        return;
    }

    const q = query(
        collection(db, 'posts'),
        where('category', '==', filter),
        orderBy('createdAt', 'asc') // Mudei para 'asc' para ordem cronológica como no WhatsApp
    );

    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            // Se não houver posts reais, mostra os exemplos
            if (examplePosts[filter]) {
                renderPosts(examplePosts[filter]);
            } else {
                postsContainer.innerHTML = `<div class="card rounded-xl p-8 text-center"><p class="text-[var(--text-secondary)]">Nenhum post encontrado nesta categoria.</p></div>`;
            }
            return;
        }

        // Se houver posts reais, mostra-os
        const realPosts = snapshot.docs.map(doc => {
            const data = doc.data();
            // createdAt may be a Firestore Timestamp, a JS Date, an ISO string or null
            let createdAt = new Date();
            if (data.createdAt) {
                if (typeof data.createdAt.toDate === 'function') {
                    createdAt = data.createdAt.toDate();
                } else if (data.createdAt instanceof Date) {
                    createdAt = data.createdAt;
                } else {
                    // Try to parse as string/number
                    const parsed = new Date(data.createdAt);
                    if (!isNaN(parsed)) createdAt = parsed;
                }
            }
            return { ...data, createdAt };
        });
        renderPosts(realPosts);

    }, (error) => {
        console.error('Erro ao carregar posts:', error);
        postsContainer.innerHTML = `
            <div class="card rounded-xl p-8 text-center">
                <p class="text-red-500">Erro ao carregar posts. Configure o Firebase corretamente.</p>
            </div>
        `;
    });
}






// --- INICIALIZAÇÃO ---

// Roda quando o DOM está pronto
document.addEventListener('DOMContentLoaded', () => {
    // Se estamos na página principal, inicializa a lógica da SPA
    if (comunidadeSection) {
        const initialHash = window.location.hash.substring(1);
        activateMenuItem(initialHash || 'geral');
    }

    // Ouve por mudanças no hash (caso o usuário use os botões de voltar/avançar do navegador)
    window.addEventListener('hashchange', handleHashChange);
});




// Service Worker Registration for PWA
// Avoid blob-based ServiceWorker registration (can fail in some environments). Disable by default.
const REGISTER_SERVICE_WORKER = false;
if (REGISTER_SERVICE_WORKER && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        try {
            const swCode = `
                self.addEventListener('install', (e) => { self.skipWaiting(); });
                self.addEventListener('activate', (e) => { self.clients.claim(); });
                self.addEventListener('fetch', (e) => { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))); });
            `;
            const blob = new Blob([swCode], { type: 'application/javascript' });
            const swUrl = URL.createObjectURL(blob);
            navigator.serviceWorker.register(swUrl)
                .then(() => console.log('Service Worker registrado'))
                .catch((err) => console.log('Erro ao registrar Service Worker:', err));
        } catch (err) {
            console.warn('Service Worker registration skipped:', err);
        }
    });
}