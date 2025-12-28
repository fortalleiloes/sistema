// animatedCounter.js
// Anima números de 0 até o valor final, estilo Mercado Pago / Fintechs

document.addEventListener('DOMContentLoaded', () => {
    const counters = document.querySelectorAll('.animate-counter');

    counters.forEach(counter => {
        const target = parseFloat(counter.getAttribute('data-target'));
        const format = counter.getAttribute('data-format'); // 'currency' or 'percent' or 'number'

        if (isNaN(target)) return;

        const duration = 1500; // ms
        const frameDuration = 1000 / 60; // 60fps
        const totalFrames = Math.round(duration / frameDuration);

        let frame = 0;

        // Função de easing para suavizar o final da animação (easeOutExpo)
        const easeOutExpo = (t) => {
            return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        };

        const updateCounter = () => {
            frame++;
            const progress = frame / totalFrames;
            const easedProgress = easeOutExpo(progress);

            const startVal = target * 0.8;
            const currentVal = startVal + (target - startVal) * easedProgress;

            if (format === 'currency') {
                counter.innerText = currentVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            } else if (format === 'percent') {
                counter.innerText = currentVal.toFixed(2) + '%';
            } else {
                counter.innerText = Math.round(currentVal);
            }

            if (frame < totalFrames) {
                requestAnimationFrame(updateCounter);
            } else {
                // Garante o valor final exato
                if (format === 'currency') {
                    counter.innerText = target.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                } else if (format === 'percent') {
                    counter.innerText = target.toFixed(2) + '%';
                } else {
                    counter.innerText = target;
                }
            }
        };

        updateCounter();
    });
});
