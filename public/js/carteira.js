// --- UTILS ---
const formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
};

const statusColors = {
    'Em Análise': 'bg-blue-500',
    'Em Reforma': 'bg-yellow-500',
    'À Venda': 'bg-green-500',
    'Alugado': 'bg-teal-500',
    'Vendido': 'bg-gray-500',
};

let costDistChart = null;
let investmentReturnChart = null;
let globalImoveis = [];

// --- API HELPERS ---
async function fetchDashboardData() {
    console.log('🌐 Buscando dashboard data...');
    const response = await fetch('/api/portfolio/dashboard');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('📦 Dashboard data recebido:', data);
    return data;
}

async function fetchImoveis() {
    console.log('🌐 Buscando imóveis...');
    const response = await fetch('/api/portfolio/imoveis');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('📦 Imóveis recebidos:', data);
    return data;
}

// --- RENDER FUNCTIONS ---

// --- RENDER FUNCTIONS ---

function renderDashboard(data, imoveis) {
    // Data comes as a flat object (from API) or kpis object (from Initial Load)
    // distribuicaoCustos might be missing on initial load if not injected
    const distribuicaoCustos = data.distribuicaoCustos || [];
    const kpis = data; // Treat the whole object as source of KPIs if needed, though we recalculate locally

    // Recalcula KPIs no cliente para garantir precisão com os dados da lista
    let totalInvestido = 0;
    let totalVendaEstimada = 0;
    let totalLucroEstimado = 0;
    let totalCustosRecorrentes = 0;

    // Auxiliar para ROI
    let totalInvestidoComEstimativa = 0;

    imoveis.forEach(imovel => {
        const investido = parseFloat(imovel.total_investido) || parseFloat(imovel.valor_compra) || 0;
        const venda = parseFloat(imovel.valor_venda_estimado) || 0;
        const cond = parseFloat(imovel.condominio_estimado) || 0;
        const iptu = parseFloat(imovel.iptu_estimado) || 0;

        totalInvestido += investido;
        totalVendaEstimada += venda;
        totalCustosRecorrentes += (cond + iptu);

        if (venda > 0) {
            totalInvestidoComEstimativa += investido;
            // Lógica Completa de Lucro
            const corretagem = venda * 0.06;
            const lucroBruto = venda - corretagem - investido;

            const tributacaoEntrada = venda * 0.0375;
            const impostoLucro = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
            const impostoTotal = tributacaoEntrada + impostoLucro;

            const lucroLiquido = lucroBruto - impostoTotal;
            totalLucroEstimado += lucroLiquido;
        }
    });

    const roiMedio = totalInvestidoComEstimativa > 0 ? (totalLucroEstimado / totalInvestidoComEstimativa) * 100 : 0;

    console.log('📊 KPIs Recalculados (Client):', {
        totalInvestido,
        totalLucroEstimado,
        roiMedio,
        totalCustosRecorrentes
    });

    // Anima os KPIs com efeito "roll-up" estilo Mercado Pago
    animateMultiple([
        {
            element: document.getElementById('kpi-investido'), // Updated ID
            value: totalInvestido,
            options: {
                duration: 1200,
                startPercentage: 0.92,
                format: 'currency'
            }
        },
        {
            element: document.getElementById('kpi-lucro'), // Updated ID
            value: totalLucroEstimado,
            options: {
                duration: 1300,
                startPercentage: 0.90,
                format: 'currency'
            }
        },
        {
            element: document.getElementById('kpi-roi'), // Updated ID
            element: document.getElementById('kpi-roi'), // Updated ID
            value: (kpis && kpis.roi_medio) ? parseFloat(kpis.roi_medio) : roiMedio,
            options: {
                duration: 1100,
                startPercentage: 0.88,
                format: 'percentage'
            }
        },
        {
            element: document.getElementById('kpi-total-imoveis'),
            value: imoveis.length,
            options: {
                duration: 1000,
                startPercentage: 0.85,
                format: 'number'
            }
        },
        {
            element: document.getElementById('kpi-custos'), // Updated ID
            element: document.getElementById('kpi-custos'), // Updated ID
            value: (kpis && kpis.custo_recorrente_mensal !== undefined) ? parseFloat(kpis.custo_recorrente_mensal) : totalCustosRecorrentes,
            options: {
                duration: 1250,
                startPercentage: 0.91,
                format: 'currency'
            }
        }
    ]);

    // Gráfico de Distribuição de Custos (Pizza)
    const costCtx = document.getElementById('costDistributionChart').getContext('2d');
    const costLabels = distribuicaoCustos.map(c => c.tipo_custo);
    const costData = distribuicaoCustos.map(c => c.total);

    if (costDistChart) costDistChart.destroy();
    costDistChart = new Chart(costCtx, {
        type: 'pie',
        data: {
            labels: costLabels,
            datasets: [{
                data: costData,
                backgroundColor: ['#4F46E5', '#06B6D4', '#F97316', '#10B981', '#EF4444', '#A78BFA', '#3B82F6'],
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
        }
    });

    // Gráfico de Evolução de Custos Mensais (Linha)
    const monthlyCtx = document.getElementById('monthlyCostsChart').getContext('2d');
    const monthlyLabels = data.custosPorMes ? data.custosPorMes.map(c => {
        const [ano, mes] = c.mes.split('-');
        return `${mes}/${ano}`;
    }) : [];
    const monthlyData = data.custosPorMes ? data.custosPorMes.map(c => c.total) : [];

    // Se já existir, destrói (precisamos adicionar a variável global para este gráfico também)
    if (window.monthlyCostsChartInstance) window.monthlyCostsChartInstance.destroy();

    window.monthlyCostsChartInstance = new Chart(monthlyCtx, {
        type: 'line',
        data: {
            labels: monthlyLabels,
            datasets: [{
                label: 'Gastos Totais',
                data: monthlyData,
                borderColor: '#EF4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: value => formatCurrency(value) }
                }
            }
        }
    });

    // Gráfico de Investimento vs Retorno (Barras)
    const invRetCtx = document.getElementById('investmentReturnChart').getContext('2d');
    const imoveisLabels = imoveis.map(i => i.descricao.substring(0, 20));
    const totalInvestidoData = imoveis.map(i => i.total_investido);
    const retornoEstimadoData = imoveis.map(i => i.valor_venda_estimado);

    if (investmentReturnChart) investmentReturnChart.destroy();
    investmentReturnChart = new Chart(invRetCtx, {
        type: 'bar',
        data: {
            labels: imoveisLabels,
            datasets: [
                {
                    label: 'Total Investido',
                    data: totalInvestidoData,
                    backgroundColor: '#F97316',
                },
                {
                    label: 'Venda Estimada',
                    data: retornoEstimadoData,
                    backgroundColor: '#10B981',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }
        }
    });
}

function renderImoveisList(imoveis) {
    const container = document.getElementById('imoveis-list');
    if (!container) {
        console.error('❌ Elemento imoveis-list não encontrado!');
        return;
    }

    container.innerHTML = '';

    if (!imoveis || imoveis.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center p-8 card rounded-lg shadow"><p class="text-[var(--text-secondary)]">Nenhum imóvel adicionado ainda. Comece adicionando um no formulário acima!</p></div>`;
        return;
    }

    // Always use List View
    const cardContainer = document.getElementById('imoveis-card-container');
    container.classList.remove('grid-view');
    container.classList.add('list-view');

    // Force parent container style
    if (cardContainer) {
        cardContainer.classList.add('macos-card');
        cardContainer.style.background = 'var(--macos-bg-secondary)';
        cardContainer.style.padding = '0';
        cardContainer.style.boxShadow = ''; // Restore default shadow
    }

    imoveis.forEach(imovel => {
        try {
            const totalInvestido = parseFloat(imovel.total_investido) || parseFloat(imovel.valor_compra) || 0;
            const venda = parseFloat(imovel.valor_venda_estimado) || 0;

            // Lógica de Lucro Cliente
            let lucroPotencial = 0;
            if (venda > 0) {
                const corretagem = venda * 0.06;
                const lucroBruto = venda - corretagem - totalInvestido;
                const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
                lucroPotencial = lucroBruto - imposto;
            }

            const card = document.createElement('div');
            card.dataset.imovelId = imovel.id;
            card.className = "macos-list-item"; // Use CSS class for hover
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => openImovelModal(imovel.id));

            // LIST VIEW (Row) - Explicit Styles ensuring visibility
            card.style.cssText = `display: flex; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--macos-divider); transition: background 0.2s; min-height: 80px; width: 100%;`;
            card.onmouseover = () => card.style.background = 'var(--macos-bg-tertiary)';
            card.onmouseout = () => card.style.background = 'transparent';

            card.innerHTML = `
                <div style="width: 48px; height: 48px; border-radius: 8px; background: linear-gradient(135deg, #FFD60A 0%, #FF9F0A 100%); display: flex; align-items: center; justify-content: center; margin-right: 16px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <i class="fa-solid fa-house" style="color: white; font-size: 20px;"></i>
                </div>
                <div style="flex: 1; min-width: 0;">
                    <h4 style="font-size: 15px; font-weight: 600; color: var(--macos-text-primary); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${imovel.descricao || 'Imóvel sem nome'}</h4>
                    <p style="font-size: 13px; color: var(--macos-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"><i class="fa-solid fa-location-dot" style="margin-right: 4px;"></i>${imovel.endereco || 'Endereço não informado'}</p>
                </div>
                <div style="margin-right: 24px;">
                    <span style="font-size: 12px; padding: 4px 10px; border-radius: 12px; font-weight: 500; background: var(--macos-bg-tertiary); color: var(--macos-text-primary); border: 1px solid var(--macos-divider); white-space: nowrap;">${imovel.status || 'Arrematado'}</span>
                </div>
                <div style="text-align: right; margin-right: 16px;">
                    <p style="font-size: 15px; font-weight: 600; color: var(--macos-text-primary);">${formatCurrency(totalInvestido)}</p>
                    <p style="font-size: 12px; color: ${lucroPotencial >= 0 ? 'var(--macos-success)' : 'var(--macos-red)'};">${lucroPotencial >= 0 ? '+' : ''}${formatCurrency(lucroPotencial)} est.</p>
                </div>
                <div style="color: var(--macos-text-tertiary);">
                    <i class="fa-solid fa-chevron-right"></i>
                </div>
            `;
            container.appendChild(card);
        } catch (err) {
            console.error('Erro ao renderizar card de imóvel:', err, imovel);
        }
    });
}

function renderImovelDetail(imovel) {
    document.getElementById('detail-title').textContent = imovel.descricao;
    document.getElementById('detail-status').textContent = imovel.status;
    document.getElementById('detail-compra').textContent = formatCurrency(imovel.valor_compra);
    document.getElementById('detail-venda-estimada').textContent = formatCurrency(imovel.valor_venda_estimado);

    const custosTbody = document.getElementById('custos-tbody');
    custosTbody.innerHTML = '';
    let totalCustos = 0;
    if (imovel.custos && imovel.custos.length > 0) {
        imovel.custos.forEach(custo => {
            totalCustos += custo.valor;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="py-2 px-4">${new Date(custo.data_custo).toLocaleDateString('pt-BR')}</td>
                <td class="py-2 px-4">${custo.tipo_custo}</td>
                <td class="py-2 px-4">${custo.descricao || ''}</td>
                <td class="py-2 px-4 text-right font-mono">${formatCurrency(custo.valor)}</td>
                <td class="py-2 px-4 text-right">
                    <button data-custo-id="${custo.id}" class="text-red-500 hover:text-red-700">Excluir</button>
                </td>
            `;
            custosTbody.appendChild(tr);
        });
    } else {
        custosTbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Nenhum custo lançado para este imóvel.</td></tr>';
    }

    // Wire delete buttons for costs
    custosTbody.querySelectorAll('button[data-custo-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const custoId = btn.dataset.custoId;
            if (confirm('Tem certeza que deseja excluir este custo?')) {
                await fetch(`/api/portfolio/custos/${custoId}`, { method: 'DELETE' });
                showImovelDetail(imovel.id); // Recarrega os detalhes
            }
        });
    });

    // Cálculos de sumário do imóvel (Lucro Líquido)
    const totalInvestido = (imovel.valor_compra || 0) + totalCustos;
    const venda = imovel.valor_venda_estimado || 0;
    const corretagem = venda * 0.06;
    const lucroBruto = venda - corretagem - totalInvestido;
    const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
    const lucroPotencial = lucroBruto - imposto;
    const roi = totalInvestido > 0 ? (lucroPotencial / totalInvestido) * 100 : 0;

    // Cálculo de Custo Mensal Estimado (Baseado nos últimos lançamentos de Condomínio e IPTU)
    let custoMensal = 0;
    if (imovel.custos && imovel.custos.length > 0) {
        // Encontrar o último condomínio
        const condominios = imovel.custos.filter(c => c.tipo_custo === 'Condomínio' || c.descricao.toLowerCase().includes('condomínio'));
        if (condominios.length > 0) {
            // Ordena por data (mais recente primeiro) e pega o primeiro
            condominios.sort((a, b) => new Date(b.data_custo) - new Date(a.data_custo));
            custoMensal += condominios[0].valor;
        }

        // Encontrar o último IPTU (mensal)
        const iptus = imovel.custos.filter(c => c.descricao.toLowerCase().includes('iptu') && c.descricao.toLowerCase().includes('mensal'));
        if (iptus.length > 0) {
            iptus.sort((a, b) => new Date(b.data_custo) - new Date(a.data_custo));
            custoMensal += iptus[0].valor;
        }
    }

    // Anima os valores do detalhe do imóvel
    animateMultiple([
        {
            element: document.getElementById('detail-compra'),
            value: imovel.valor_compra || 0,
            options: { duration: 1000, startPercentage: 0.93, format: 'currency' }
        },
        {
            element: document.getElementById('detail-total-custos'),
            value: totalCustos,
            options: { duration: 1100, startPercentage: 0.91, format: 'currency' }
        },
        {
            element: document.getElementById('detail-venda-estimada'),
            value: imovel.valor_venda_estimado || 0,
            options: { duration: 1150, startPercentage: 0.90, format: 'currency' }
        },
        {
            element: document.getElementById('detail-lucro-potencial'),
            value: lucroPotencial,
            options: { duration: 1250, startPercentage: 0.89, format: 'currency' }
        },
        {
            element: document.getElementById('detail-roi'),
            value: roi,
            options: { duration: 1100, startPercentage: 0.88, format: 'percentage' }
        },
        {
            element: document.getElementById('detail-custo-mensal'),
            value: custoMensal,
            options: { duration: 1200, startPercentage: 0.90, format: 'currency' }
        }
    ]);

    // Prepara o formulário de adicionar custo
    document.getElementById('custo-form').dataset.imovelId = imovel.id;
}

// --- VIEW MANAGEMENT ---

function showDashboardView() {
    document.getElementById('dashboard-view').classList.remove('hidden');
    document.getElementById('detail-view').classList.add('hidden');
    loadAllData();
}

async function showImovelDetail(imovelId) {
    try {
        const resp = await fetch(`/api/portfolio/imoveis/${imovelId}`);
        if (!resp.ok) throw new Error('Imóvel não encontrado');
        const imovel = await resp.json();
        renderImovelDetail(imovel);
        document.getElementById('dashboard-view').classList.add('hidden');
        document.getElementById('detail-view').classList.remove('hidden');
    } catch (error) {
        console.error('Erro ao mostrar detalhes do imóvel:', error);
    }
}

// Função Principal de Carregamento
async function loadAllData() {
    try {
        console.log('🔄 Iniciando carregamento de dados...');

        // (Removed updateDashboardUI call as it didn't exist)

        let imoveis = [];
        let dashboardData = window.SERVER_KPIS || {};
        let custosPorMes = [];

        // If we have initial data from server render, use it!
        if (window.SERVER_INITIAL_DATA) {
            console.log('📦 Usando dados pré-carregados do servidor.');
            imoveis = window.SERVER_INITIAL_DATA;
            // Fetch only charts data since we have the heavy lifting done
            try {
                const response = await fetch('/api/portfolio/dashboard');
                const newData = await response.json();
                if (newData.custosPorMes) custosPorMes = newData.custosPorMes;
                // Update dashboardData with full API response (including distribuicaoCustos)
                dashboardData = newData;
            } catch (e) { console.warn('Erro ao atualizar graficos', e); }

        } else {
            // Fallback to fetch if no server data
            const [data, fetchedImoveis] = await Promise.all([
                fetchDashboardData(),
                fetchImoveis()
            ]);
            dashboardData = data;
            imoveis = fetchedImoveis;
            custosPorMes = data.custosPorMes;
        }

        // Render everything
        renderImoveisList(imoveis);
        renderDashboard(dashboardData, imoveis); // Recalculate based on definitive list
        renderCharts(custosPorMes);

        console.log('✅ Dados carregados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao carregar dados do portfólio:', error);
    }
}

// --- EVENT WIRING ---

function wireForms() {
    const imovelForm = document.getElementById('add-imovel-form');
    imovelForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(imovelForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const resp = await fetch('/api/portfolio/imoveis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!resp.ok) throw new Error('Falha ao adicionar imóvel');
            imovelForm.reset();
            loadAllData();
        } catch (error) {
            alert('Erro ao adicionar imóvel.');
            console.error(error);
        }
    });

    const custoForm = document.getElementById('custo-form');
    custoForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const imovelId = custoForm.dataset.imovelId;
        if (!imovelId) return;

        const formData = new FormData(custoForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const resp = await fetch(`/api/portfolio/imoveis/${imovelId}/custos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!resp.ok) throw new Error('Falha ao adicionar custo');
            custoForm.reset();
            showImovelDetail(imovelId); // Recarrega os detalhes
        } catch (error) {
            alert('Erro ao adicionar custo.');
            console.error(error);
        }
    });
}

function wireButtons() {
    document.getElementById('back-to-dashboard-btn').addEventListener('click', showDashboardView);
}

// --- MODAL MANAGEMENT ---

async function openImovelModal(imovelId) {
    try {
        // Fetch full details if needed, or use cached if available (for now fetching to be safe)
        const resp = await fetch(`/api/portfolio/imoveis/${imovelId}`);
        if (!resp.ok) throw new Error('Imóvel não encontrado');
        const imovel = await resp.json();

        // Populate Modal Data
        document.getElementById('modal-imovel-nome').textContent = imovel.descricao;
        document.getElementById('modal-imovel-endereco').textContent = imovel.endereco || 'Endereço não informado';
        document.getElementById('modal-imovel-status').textContent = imovel.status || 'Arrematado';

        // Calculate KPIs
        let totalCustos = 0;
        if (imovel.custos) {
            imovel.custos.forEach(c => totalCustos += c.valor);
        }

        const totalInvestido = (imovel.valor_compra || 0) + totalCustos;
        const venda = imovel.valor_venda_estimado || 0;
        const corretagem = venda * 0.06;
        const lucroBruto = venda - corretagem - totalInvestido;
        const imposto = lucroBruto > 0 ? lucroBruto * 0.15 : 0;
        const lucroPotencial = lucroBruto - imposto;
        const roi = totalInvestido > 0 ? (lucroPotencial / totalInvestido) * 100 : 0;

        document.getElementById('modal-investido').textContent = formatCurrency(totalInvestido);
        document.getElementById('modal-lucro').textContent = formatCurrency(lucroPotencial);
        document.getElementById('modal-roi').textContent = roi.toFixed(2) + '%';
        document.getElementById('modal-venda').textContent = formatCurrency(venda);

        // Populate Costs List (Summary)
        const costsList = document.getElementById('modal-custos-list');
        costsList.innerHTML = '';

        if (imovel.custos && imovel.custos.length > 0) {
            // Group by type for cleaner summary
            const costsByType = {};
            imovel.custos.forEach(c => {
                if (!costsByType[c.tipo_custo]) costsByType[c.tipo_custo] = 0;
                costsByType[c.tipo_custo] += c.valor;
            });

            Object.entries(costsByType).forEach(([type, value]) => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--macos-divider); font-size: 13px;';
                row.innerHTML = `
                    <span style="color: var(--macos-text-secondary);">${type}</span>
                    <span style="font-weight: 600; color: var(--macos-text-primary); font-family: monospace;">${formatCurrency(value)}</span>
                `;
                costsList.appendChild(row);
            });
        } else {
            costsList.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--macos-text-secondary); font-size: 13px;">Nenhum custo lançado.</div>';
        }

        // Wire "View Full Details" button
        const viewDetailsBtn = document.getElementById('modal-ver-detalhes-btn');
        viewDetailsBtn.onclick = () => {
            closeImovelModal();
            showImovelDetail(imovel.id);
        };

        // Show Modal
        const modal = document.getElementById('imovel-modal');
        modal.classList.remove('hidden');

        // Small delay to allow display:flex to apply before opacity transition
        setTimeout(() => {
            modal.style.opacity = '1';
            modal.style.pointerEvents = 'auto';
            modal.querySelector('.macos-window').style.transform = 'scale(1)';
        }, 10);

    } catch (error) {
        console.error(error);
        alert('Erro ao carregar detalhes do imóvel.');
    }
}

function closeImovelModal() {
    const modal = document.getElementById('imovel-modal');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    modal.querySelector('.macos-window').style.transform = 'scale(0.95)';

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}



// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        wireForms();
        wireButtons();

        // Wire Modal Close Button
        document.getElementById('close-modal-btn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeImovelModal();
        });

        // Close modal on click outside
        document.getElementById('imovel-modal').addEventListener('click', (e) => {
            if (e.target.id === 'imovel-modal') {
                e.preventDefault();
                closeImovelModal();
            }
        });

        showDashboardView(); // Inicia na view do dashboard
    } catch (e) {
        console.error('Erro na inicialização da carteira:', e);
    }
});
