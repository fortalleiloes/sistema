
// Funnel Logic
let currentStep = 1;
const totalSteps = 7;
let iti; // Instance for IntlTelInput

// JQuery Masks & IntlTelInput Init
$(document).ready(function () {
    $('#capital_input').mask('#.##0,00', { reverse: true });

    // Initialize Intl Tel Input
    const input = document.querySelector("#whatsapp_input");
    // Ensure we don't init twice
    if (input && !window.intlTelInputGlobals?.getInstance(input)) {
        iti = window.intlTelInput(input, {
            // Point to utilities script for formatting
            utilsScript: "https://cdn.jsdelivr.net/npm/intl-tel-input@18.2.1/build/js/utils.js",
            initialCountry: "br",
            preferredCountries: ["br", "pt", "us"],
            separateDialCode: true,
            autoPlaceholder: "aggressive",
            formatOnDisplay: true
        });
    }
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

function validateStepFinance() {
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
    nextStep(6);
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

// Handle Interest Selection with Click (avoids popup blockers)
function handleInterestClick(element, value) {
    // Ensure radio is checked
    const radio = $(element).find('input[type="radio"]');
    radio.prop('checked', true);

    // Visual feedback
    $(element).addClass('border-gold-primary bg-slate-700/50');
    setTimeout(() => $(element).removeClass('border-gold-primary bg-slate-700/50'), 300);

    if (value === 'mentoria') {
        window.open('https://www.paulinhodosleiloes.com.br', '_blank');
        setTimeout(() => nextStep(7), 500); // Go to Contact
    } else if (value === 'parcerias') {
        setTimeout(() => nextStep(7), 300); // Go to Contact
    } else {
        setTimeout(() => nextStep(5), 300); // Go to Finance
    }
}

function handleBackContact() {
    const interest = $('input[name="interesse"]:checked').val();

    if (interest === 'parcerias') {
        prevStep(4); // Back to Interest
    } else {
        prevStep(6); // Back to Credit Analysis (Normal flow)
    }
}

// Form Submission
document.getElementById('funnelForm').addEventListener('submit', async function (e) {
    e.preventDefault();


    // Initialize FingerprintJS
    const fpPromise = import('https://openfpcdn.io/fingerprintjs/v4')
        .then(FingerprintJS => FingerprintJS.load());

    // Validate final step
    const nome = $('input[name="nome"]').val();

    // Get Full Number from IntlTelInput
    let whatsapp = '';

    // Safety check if iti failed to init
    if (iti) {
        if (!iti.isValidNumber()) {
            // Optional: allow soft fail or strict validation
            alert('Por favor, digite um número de WhatsApp válido para o país selecionado.');
            return;
        }
        whatsapp = iti.getNumber(); // E.164 format including country code
    } else {
        // Fallback
        whatsapp = $('input[name="whatsapp"]').val();
    }

    // Basic Name Check
    if (!nome || nome.trim().length < 2) {
        alert('Por favor, preencha seu nome.');
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

    // OVERWRITE WHATSAPP WITH FORMATTED VALUE
    data.whatsapp = whatsapp;

    // Get Fingerprint
    let fingerprint = null;
    try {
        const fp = await fpPromise;
        const result = await fp.get();
        fingerprint = result.visitorId;
        data.fingerprint = fingerprint;
    } catch (e) {
        console.warn('Fingerprint error:', e);
    }


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
