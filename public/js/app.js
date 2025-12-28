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
let currentFilter = 'agenteia'; // Inicia no Agente IA
let currentVideoId = null;
let unsubscribeComments = null; // Variável para armazenar a função de unsubscribe do listener de comentários

// DOM Elements
const menuItems = document.querySelectorAll('.menu-item');
const comunidadeSection = document.getElementById('comunidadeSection');
const videosSection = document.getElementById('videosSection');
const videoDetailSection = document.getElementById('videoDetailSection');
const postsContainer = document.getElementById('postsContainer');
const videosContainer = document.getElementById('videosContainer');
const backToVideos = document.getElementById('backToVideos');
const commentForm = document.getElementById('commentForm');
const commentsContainer = document.getElementById('commentsContainer');
const adminOnlyFooter = document.getElementById('adminOnlyFooter');
const iaChatForm = document.getElementById('iaChatForm');
const iaMessageForm = document.getElementById('iaMessageForm');
const iaMessageInput = document.getElementById('iaMessageInput');
const iaImageUpload = document.getElementById('iaImageUpload');
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
                if (filter === 'agenteia') {
                    if (communityTitle) communityTitle.textContent = 'Agente IA - Arremata!';
                    if (adminOnlyFooter) adminOnlyFooter.classList.add('hidden');
                    if (iaChatForm) iaChatForm.classList.remove('hidden');
                    if (clearBtn) clearBtn.classList.remove('hidden');
                } else {
                    if (filter === 'geral') {
                        if (communityTitle) communityTitle.textContent = 'Comunidade - Arremata Todo Dia';
                    } else {
                        const span = item.querySelector('span:not(.w-8)');
                        if (communityTitle && span) communityTitle.textContent = span.textContent;
                    }
                    if (adminOnlyFooter) adminOnlyFooter.classList.remove('hidden');
                    if (iaChatForm) iaChatForm.classList.add('hidden');
                    if (clearBtn) clearBtn.classList.add('hidden');
                }
                loadPosts(filter);
            } else if (section === 'videos' && videosSection) {
                showSection('videos');
                loadVideos();
            }
        });
    });
}

// Listener para o botão de limpar chat
const clearChatBtn = document.getElementById('clearChatBtn');
if (clearChatBtn) {
    clearChatBtn.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja apagar todo o histórico da conversa? Esta ação não pode ser desfeita.')) {
            try {
                const resp = await fetch('/chat/history', { method: 'DELETE' });
                if (resp.ok) {
                    loadPosts('agenteia'); // Recarrega (limpa) a tela
                } else {
                    alert('Erro ao limpar histórico.');
                }
            } catch (error) {
                console.error('Erro ao limpar chat:', error);
                alert('Erro de conexão.');
            }
        }
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
    if (videosSection) videosSection.classList.add('hidden');
    if (videoDetailSection) videoDetailSection.classList.add('hidden');

    if (section === 'comunidade' && comunidadeSection) {
        comunidadeSection.classList.remove('hidden');
    } else if (section === 'videos' && videosSection) {
        videosSection.classList.remove('hidden');
    } else if (section === 'videoDetail' && videoDetailSection) {
        videoDetailSection.classList.remove('hidden');
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
    ],
    agenteia: [
        { author: "Agente IA", profilePic: appProfile.pic, content: "Olá! Eu sou o Agente IA do Arremata!. Como posso te ajudar hoje? Sinta-se à vontade para perguntar sobre editais, lances ou qualquer outra dúvida.", createdAt: new Date(), isAdmin: true }
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
        // For the IA feed, merge server-side chat_messages (when available) with local examples
        if (filter === 'agenteia') {
            try {
                const emailParam = (document.getElementById('app-script')?.dataset.username) ? null : (new URLSearchParams(window.location.search).get('email') || null);
                const qs = emailParam ? ('?email=' + encodeURIComponent(emailParam)) : '';
                const resp = await fetch('/chat/messages' + qs);
                if (resp.ok) {
                    const serverMsgs = await resp.json();
                    const merged = [];
                    // start with examples
                    if (examplePosts[filter]) merged.push(...examplePosts[filter]);
                    // append server messages in chronological order
                    for (const m of serverMsgs) {
                        // user message
                        merged.push({ author: m.email || 'Você', profilePic: '/images/perfil1.svg', content: m.message, createdAt: new Date(m.created_at), isAdmin: false });
                        if (m.response) {
                            merged.push({ author: 'Agente IA', profilePic: appProfile.pic, content: m.response, createdAt: new Date(m.responded_at || m.created_at), isAdmin: true });
                        }
                    }
                    renderPosts(merged);
                    return;
                }
            } catch (e) {
                console.error('Erro buscando mensagens do servidor para IA feed:', e);
            }
            // fallback to static examples if server fetch fails
            if (examplePosts[filter]) {
                renderPosts(examplePosts[filter]);
            } else {
                postsContainer.innerHTML = `<div class="card rounded-xl p-8 text-center"><p class="text-[var(--text-secondary)]">Nenhum post encontrado nesta categoria.</p></div>`;
            }
            return;
        }
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

// Chat IA Management
if (iaMessageForm) {
    const messagesArea = document.getElementById('messagesArea');
    const typingIndicator = document.getElementById('typingIndicator');

    // Auto-resize textarea
    iaMessageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 128) + 'px'; // max-height: 128px
    });

    // Mostra indicador de "digitando..." e esconde após resposta
    function showTypingIndicator() {
        if (typingIndicator) {
            typingIndicator.classList.remove('hidden');
        }
    }

    function hideTypingIndicator() {
        if (typingIndicator) {
            typingIndicator.classList.add('hidden');
        }
    }

    iaMessageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const messageText = iaMessageInput.value.trim();
        const imageFile = iaImageUpload.files[0];

        if (!messageText && !imageFile) {
            alert("Por favor, escreva uma mensagem ou selecione uma imagem.");
            return;
        }

        // Reset textarea height
        iaMessageInput.style.height = 'auto';

        let imageUrl = null;
        try {
            // If Firebase is enabled, use Firestore + Storage as before
            if (FIREBASE_ENABLED && db && storage) {
                // Se houver imagem, faz o upload primeiro
                if (imageFile) {
                    const storageRef = ref(storage, `ia-chat-images/${Date.now()}_${imageFile.name}`);
                    const snapshot = await uploadBytes(storageRef, imageFile);
                    imageUrl = await getDownloadURL(snapshot.ref);
                }

                // Salva a mensagem no Firestore
                await addDoc(collection(db, 'posts'), {
                    category: 'agenteia',
                    content: messageText,
                    imageUrl: imageUrl,
                    createdAt: serverTimestamp(),
                    isAdmin: false, // Mensagem do usuário
                    author: "Você", // O autor da mensagem é sempre "Você" para o usuário logado
                    profilePic: '/images/perfil1.svg' // Placeholder local
                });

                // Limpa o formulário
                iaMessageForm.reset();
            } else {
                // If Firebase is disabled, send the message to our server chat endpoint which persists locally
                const payload = { message: messageText };

                // Mostra indicador de "digitando..."
                showTypingIndicator();

                try {
                    const resp = await fetch('/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    if (!resp.ok) {
                        console.error('Erro ao enviar para /chat/send', resp.status);
                        alert('Erro ao enviar a mensagem para o servidor. Veja o console para detalhes.');
                        hideTypingIndicator();
                    } else {
                        iaMessageForm.reset();
                        // reload posts from server so the authoritative list is shown (avoid optimistic duplication)
                        await loadPosts('agenteia');

                        // Aguarda um pouco para simular o agente "digitando"
                        setTimeout(() => {
                            hideTypingIndicator();
                        }, 1500);
                    }
                } catch (err) {
                    console.error('Falha ao conectar com /chat/send:', err);
                    alert('Erro de conexão ao enviar mensagem.');
                    hideTypingIndicator();
                }
            }

        } catch (error) {
            console.error("Erro ao enviar mensagem:", error);
            alert("Ocorreu um erro ao enviar sua mensagem. Verifique o console para mais detalhes.");
            hideTypingIndicator();
        }
    });
}


// --- Vídeo Aulas (Dados Estáticos) ---
// PREENCHA AQUI com os dados das suas aulas
const staticVideos = [
    { id: 'aula01', title: 'Aula 1: Introdução aos Leilões', description: 'Aprenda os conceitos básicos e como começar no mundo dos leilões.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula02', title: 'Aula 2: Tipos de Leilão', description: 'Descubra as diferenças entre leilões judiciais e extrajudiciais.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula03', title: 'Aula 3: Análise de Edital', description: 'Saiba como ler e interpretar um edital de leilão para não cair em armadilhas.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula04', title: 'Aula 4: Vistoria do Imóvel', description: 'A importância de visitar o imóvel e o que observar durante a vistoria.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula05', title: 'Aula 5: Estratégias de Lance', description: 'Técnicas para dar lances de forma inteligente e aumentar suas chances.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula06', title: 'Aula 6: Documentação Pós-Arremate', description: 'Passo a passo da documentação necessária após arrematar um bem.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula07', title: 'Aula 7: Financiamento e Pagamento', description: 'Opções de pagamento e como financiar o seu imóvel de leilão.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula08', title: 'Aula 8: Desocupação do Imóvel', description: 'Procedimentos legais e dicas para a desocupação de imóveis ocupados.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula09', title: 'Aula 9: Leilões de Veículos', description: 'Particularidades e cuidados ao participar de leilões de carros e motos.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula10', title: 'Aula 10: Riscos e Como Evitá-los', description: 'Conheça os principais riscos envolvidos e como se proteger.', youtubeId: 'dQw4w9WgXcQ' },
    { id: 'aula11', title: 'Aula 11: Declarando no Imposto de Renda', description: 'Como declarar corretamente seu bem arrematado no Imposto de Renda.', youtubeId: 'dQw4w9WgXcQ' },
];

// Load Videos
function loadVideos() {
    if (!videosContainer) return; // Exit if container not found

    videosContainer.innerHTML = '';

    if (staticVideos.length === 0) {
        videosContainer.innerHTML = `
            <div class="col-span-full card rounded-xl p-8 text-center">
                <p class="text-[var(--text-secondary)]">Nenhuma aula disponível ainda.</p>
            </div>
        `;
        return;
    }

    staticVideos.forEach((video) => {
        const videoElement = document.createElement('div');
        videoElement.className = 'card rounded-xl p-4 flex flex-col';
        videoElement.innerHTML = `
            <div class="aspect-video bg-[var(--bg-interactive)] rounded-lg mb-4 bg-cover bg-center" style="background-image: url('https://img.youtube.com/vi/${video.youtubeId}/hqdefault.jpg');">
                <div class="w-full h-full flex items-center justify-center bg-black/40 backdrop-blur-sm bg-opacity-20">
                    <svg class="w-12 h-12 text-white/80" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"></path>
                    </svg>
                </div>
            </div>
            <div class="flex-grow">
                <h3 class="text-lg font-semibold text-[var(--text-accent)] mb-2">${video.title}</h3>
                <p class="text-[var(--text-secondary)] text-sm mb-4 line-clamp-3">${video.description}</p>
            </div>
            <button class="w-full mt-auto px-4 py-2 rounded-lg btn-primary text-blue-950 font-semibold">
                Acessar Aula
            </button>
        `;

        videoElement.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            showVideoDetail(video.id, video);
        });

        videosContainer.appendChild(videoElement);
    });
}

// Show Video Detail
function showVideoDetail(videoId, video) {
    if (!videoDetailSection) return; // Exit if section not found

    currentVideoId = videoId;
    // Desconecta o listener de comentários anterior, se houver
    if (unsubscribeComments) {
        unsubscribeComments();
        unsubscribeComments = null;
    }
    showSection('videoDetail');

    if (document.getElementById('videoDetailTitle')) document.getElementById('videoDetailTitle').textContent = video.title;
    if (document.getElementById('videoDetailDescription')) document.getElementById('videoDetailDescription').textContent = video.description;
    if (document.getElementById('videoPlayer')) {
        document.getElementById('videoPlayer').innerHTML = `
            <iframe 
                src="https://www.youtube.com/embed/${video.youtubeId}" 
                frameborder="0" 
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                allowfullscreen>
            </iframe>
        `;
    }

    loadComments(videoId);
    window.scrollTo(0, 0);
}

// Back to Videos (only if backToVideos button exists)
if (backToVideos) {
    backToVideos.addEventListener('click', () => {
        showSection('videos');
        currentVideoId = null;
        // Desconecta o listener de comentários ao sair da tela de detalhes
        if (unsubscribeComments) {
            unsubscribeComments();
            unsubscribeComments = null;
        }
        if (document.getElementById('videoPlayer')) document.getElementById('videoPlayer').innerHTML = ''; // Stop video
    });
}

// Comment Management (only if commentForm exists)
if (commentForm) {
    commentForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentVideoId) return;

        const author = document.getElementById('commentAuthor').value;
        const text = document.getElementById('commentText').value;

        try {
            await addDoc(collection(db, 'videos', currentVideoId, 'comments'), {
                author,
                text,
                createdAt: serverTimestamp()
            });

            commentForm.reset();
            alert('Comentário enviado com sucesso!');
        } catch (error) {
            console.error('Erro ao enviar comentário:', error);
            alert('Erro ao enviar comentário.');
        }
    });
}

// Load Comments (only if commentsContainer exists)
function loadComments(videoId) {
    if (!commentsContainer) return; // Exit if container not found

    const q = query(
        collection(db, 'videos', videoId, 'comments'),
        orderBy('createdAt', 'desc')
    );

    unsubscribeComments = onSnapshot(q, (snapshot) => { // Armazena a função de unsubscribe
        commentsContainer.innerHTML = '';

        if (snapshot.empty) {
            commentsContainer.innerHTML = `
                <p class="text-[var(--text-secondary)] text-center py-4">Nenhum comentário ainda. Seja o primeiro!</p>
            `;
            return;
        }

        snapshot.forEach((doc) => {
            const comment = doc.data();
            let date = 'Agora';
            if (comment.createdAt) {
                if (typeof comment.createdAt.toDate === 'function') {
                    date = new Date(comment.createdAt.toDate()).toLocaleString('pt-BR', { timeStyle: 'short', dateStyle: 'short' });
                } else {
                    const d = new Date(comment.createdAt);
                    date = !isNaN(d) ? d.toLocaleString('pt-BR', { timeStyle: 'short', dateStyle: 'short' }) : 'Agora';
                }
            }

            const commentElement = document.createElement('div');
            commentElement.className = 'bg-[var(--bg-interactive)]/50 rounded-lg p-4';
            commentElement.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <span class="font-semibold text-yellow-400">${comment.author}</span>
                    <span class="text-sm text-slate-400">${date}</span>
                </div>
                <p class="text-slate-300 whitespace-pre-wrap">${comment.text}</p>
            `;

            commentsContainer.appendChild(commentElement);
        });
    });
}

// --- INICIALIZAÇÃO ---

// Roda quando o DOM está pronto
document.addEventListener('DOMContentLoaded', () => {
    // Se estamos na página principal, inicializa a lógica da SPA
    if (comunidadeSection) {
        const initialHash = window.location.hash.substring(1);
        activateMenuItem(initialHash || 'agenteia');
    }

    // Ouve por mudanças no hash (caso o usuário use os botões de voltar/avançar do navegador)
    window.addEventListener('hashchange', handleHashChange);
});


// Ensure comment form is visible on start (only if commentForm exists)
if (commentForm && commentForm.parentElement) {
    commentForm.parentElement.classList.remove('hidden');
}

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