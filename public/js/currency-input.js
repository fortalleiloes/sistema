// Script para formatar inputs de moeda no padrão brasileiro em tempo real

// Mover funções auxiliares para escopo global ou acessível
function formatToBRL(value) {
    // Remove tudo que não é dígito
    let numbers = value.replace(/\D/g, '');

    // Se vazio, retorna R$ 0,00
    if (!numbers || numbers === '0') {
        return 'R$ 0,00';
    }

    // Converte para número e divide por 100 (para ter centavos)
    let amount = parseInt(numbers) / 100;

    // Formata usando Intl
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function parseFromBRL(formattedValue) {
    // Remove R$, pontos e substitui vírgula por ponto
    let numbers = formattedValue
        .replace('R$', '')
        .replace(/\./g, '')
        .replace(',', '.')
        .trim();

    return parseFloat(numbers) || 0;
}

// Função global para inicializar inputs de moeda
window.initCurrencyInputs = function () {
    // Seleciona todos os inputs de moeda (agora incluindo type="text" com classe currency-input que ainda não foram processados)
    const currencyInputs = document.querySelectorAll('input[type="number"][step="0.01"], input.currency-input:not([data-currency-initialized])');

    currencyInputs.forEach(input => {
        // Verifica se já foi processado para evitar duplicidade
        if (input.hasAttribute('data-currency-initialized')) return;
        input.setAttribute('data-currency-initialized', 'true');

        // Muda o tipo para text para permitir formatação (se ainda não for)
        if (input.type !== 'text') {
            input.type = 'text';
            input.classList.add('currency-input');
        }

        // Cria um input hidden para armazenar o valor numérico real APENAS SE NÃO EXISTIR
        const hiddenId = input.id ? (input.id + '_hidden') : (input.name + '_hidden');
        let hiddenInput = document.getElementById(hiddenId);

        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = input.name;
            if (input.id) hiddenInput.id = hiddenId;
            input.parentNode.insertBefore(hiddenInput, input.nextSibling);
        }

        // Remove o name do input visível para não enviar no form
        if (input.hasAttribute('name')) {
            // input.dataset.originalName = input.name; // Opcional: guardar nome original
            input.removeAttribute('name');
        }

        // Formata o valor inicial se existir
        if (input.value) {
            // Se já tiver R$, assume que está formatado. Se não, formata.
            if (!input.value.includes('R$')) {
                const initialValue = parseFloat(input.value) || 0;
                const valueInCents = Math.round(initialValue * 100);
                input.value = formatToBRL(valueInCents.toString());
                hiddenInput.value = initialValue.toFixed(2);
            } else {
                // Já está formatado, só garante o hidden correto
                hiddenInput.value = parseFromBRL(input.value);
            }
        } else {
            input.value = 'R$ 0,00';
            hiddenInput.value = '0';
        }

        // Adiciona placeholder formatado
        if (input.placeholder && input.placeholder.includes(':')) {
            const placeholderValue = input.placeholder.split(':')[1].trim().replace(/\D/g, '');
            if (placeholderValue) {
                input.placeholder = formatToBRL(placeholderValue);
            }
        }

        // Evento de input (digitação)
        input.addEventListener('input', function (e) {
            const cursorPosition = this.selectionStart;
            const oldLength = this.value.length;

            // Formata o valor
            this.value = formatToBRL(this.value);

            // Atualiza o input hidden com valor numérico
            hiddenInput.value = parseFromBRL(this.value);

            // Ajusta a posição do cursor
            const newLength = this.value.length;
            const newPosition = cursorPosition + (newLength - oldLength);
            this.setSelectionRange(newPosition, newPosition);
        });

        // Garante formatação ao focar
        input.addEventListener('focus', function () {
            if (!this.value || this.value === '') {
                this.value = 'R$ 0,00';
                hiddenInput.value = '0';
            }
        });

        // Garante formatação ao desfocar
        input.addEventListener('blur', function () {
            if (!this.value || this.value === '' || this.value === 'R$ ') {
                this.value = 'R$ 0,00';
                hiddenInput.value = '0';
            }
        });
    });
};

// Inicializar na carga da página
document.addEventListener('DOMContentLoaded', () => {
    if (window.initCurrencyInputs) {
        window.initCurrencyInputs();
    }
});

// Função global de formatação (para uso em outros scripts se necessário)
window.formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
};
