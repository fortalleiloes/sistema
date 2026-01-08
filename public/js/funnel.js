
// Funnel Logic
let currentStep = 1;
const totalSteps = 6;

// JQuery Masks
$(document).ready(function () {
    $('#capital_input').mask('#.##0,00', { reverse: true });
    $('#whatsapp_input').mask('(00) 00000-0000');
});

function updateProgress() {
    const percent = ((currentStep - 1) / totalSteps) * 100;
    $('.progress-bar-fill').css('width', percent + '%');
}

function showStep(step) {
    $('.step-content').removeClass('active');
    $(`.step-content[data-step="${step}"]`).addClass('active');
    currentStep = step;
    updateProgress();
}

function nextStep(step) {
    showStep(step);
}

function prevStep(step) {
    showStep(step);
}

function autoNext(next) {
    // Small delay for visual feedback
    setTimeout(() => {
        nextStep(next);
    }, 300);
}

function validateStep4() {
    const capital = $('#capital_input').val();
    const pgto = $('input[name="preferencia_pgto"]:checked').val();

    if (!capital) {
        alert('Por favor, informe o capital disponível.');
        return;
    }
    if (!pgto) {
        alert('Por favor, selecione uma forma de pagamento.');
        return;
    }
    nextStep(5);
}

function selectPayment(element) {
    // Remove selected state from all payment options
    $('input[name="preferencia_pgto"]').closest('label').removeClass('border-green-500 bg-slate-700/50').addClass('border-slate-700');
    $('input[name="preferencia_pgto"]').closest('label').find('.selection-overlay').removeClass('opacity-100').addClass('opacity-0');

    // Check the radio input inside the clicked element
    const radio = $(element).find('input[type="radio"]');
    radio.prop('checked', true);

    // Add selected state to clicked element
    $(element).removeClass('border-slate-700').addClass('border-green-500 bg-slate-700/50');
    $(element).find('.selection-overlay').removeClass('opacity-0').addClass('opacity-100');
}

// Form Submission
document.getElementById('funnelForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    // Validate final step
    const nome = $('input[name="nome"]').val();
    const whatsapp = $('input[name="whatsapp"]').val();

    if (!nome || !whatsapp || whatsapp.length < 14) {
        alert('Por favor, preencha seus dados de contato corretamente.');
        return;
    }

    // Loading State
    const btnText = document.getElementById('btnText');
    const btnIcon = document.getElementById('btnIcon');
    const btnSpinner = document.getElementById('btnSpinner');

    const originalText = btnText.innerText;
    btnText.innerText = 'Analisando...';
    btnIcon.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    // Collect Data
    const formData = new FormData(this);
    const data = Object.fromEntries(formData.entries());

    // Clean monetary value
    data.capital_disponivel = parseFloat(data.capital_disponivel.replace(/\./g, '').replace(',', '.')) || 0;

    try {
        const response = await fetch('/api/leads/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            // Show Success Screen
            $('.step-content').removeClass('active');
            $(`.step-content[data-step="success"]`).addClass('active');
            $('.progress-bar-fill').css('width', '100%');

            // Animate Score
            setTimeout(() => {
                $('#scoreBar').css('width', result.score + '%');

                // Count up effect
                $({ Counter: 0 }).animate({ Counter: result.score }, {
                    duration: 1500,
                    easing: 'swing',
                    step: function () {
                        $('#scoreText').text(Math.ceil(this.Counter) + '/100');
                    },
                    complete: function () {
                        let msg = 'Perfil Promissor';
                        if (result.score > 80) msg = 'Perfil Excelente! 🌟';
                        else if (result.score < 50) msg = 'Perfil em Desenvolvimento';
                        $('#scoreText').text(`${result.score} - ${msg}`);
                    }
                });
            }, 500);

        } else {
            alert('Erro ao enviar: ' + result.error);
            resetBtn();
        }

    } catch (error) {
        console.error(error);
        alert('Ocorreu um erro. Tente novamente.');
        resetBtn();
    }

    function resetBtn() {
        btnText.innerText = originalText;
        btnIcon.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
    }
});
