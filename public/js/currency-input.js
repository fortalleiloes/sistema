// Script para formatar inputs de moeda no padrão brasileiro em tempo real
document.addEventListener('DOMContentLoaded', () => {
    // Função para formatar valor como moeda brasileira
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

    // Função para extrair valor numérico do texto formatado
    function parseFromBRL(formattedValue) {
        // Remove R$, pontos e substitui vírgula por ponto
        let numbers = formattedValue
            .replace('R$', '')
            .replace(/\./g, '')
            .replace(',', '.')
            .trim();

        return parseFloat(numbers) || 0;
    }

    // Seleciona todos os inputs de moeda
    const currencyInputs = document.querySelectorAll('input[type="number"][step="0.01"]');

    currencyInputs.forEach(input => {
        // Muda o tipo para text para permitir formatação
        input.type = 'text';
        input.classList.add('currency-input');

        // Cria um input hidden para armazenar o valor numérico real
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = input.name;
        hiddenInput.id = input.id + '_hidden';
        input.parentNode.insertBefore(hiddenInput, input.nextSibling);

        // Remove o name do input visível para não enviar no form
        input.removeAttribute('name');
        input.removeAttribute('id');

        // Formata o valor inicial se existir
        if (input.value) {
            const initialValue = parseFloat(input.value) || 0;
            input.value = formatToBRL((initialValue * 100).toString());
            hiddenInput.value = initialValue;
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
});

// Função global de formatação
window.formatCurrency = (value) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
};
