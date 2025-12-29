/**
 * 📱 Mobile Experience Controller Premium
 */

(function () {
    'use strict';

    // Cria a Top Bar (App Header)
    function createMobileHeader() {
        const header = document.createElement('header');
        header.className = 'mobile-app-header';

        // Estrutura interna
        header.innerHTML = `
            <div class="mobile-header-left">
                <button class="mobile-menu-trigger" aria-label="Menu">
                    <i class="fa-solid fa-bars"></i>
                </button>
                <span class="mobile-header-title">Arremata!</span>
            </div>
            <!-- Espaço para ações futuras à direita -->
            <div class="mobile-header-right"></div>
        `;

        // Insere no topo do body
        document.body.prepend(header);
        return header;
    }

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'mobile-sidebar-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }

    function initMobileExperience() {
        const sidebar = document.querySelector('.macos-sidebar');
        if (!sidebar) return;

        // Se já existir header (recarregamento via SPA/Turbo), não recria
        if (document.querySelector('.mobile-app-header')) return;

        const header = createMobileHeader();
        const menuButton = header.querySelector('.mobile-menu-trigger');
        const overlay = createOverlay();

        function openMenu() {
            sidebar.classList.add('mobile-open');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden'; // Trava scroll da página
        }

        function closeMenu() {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            document.body.style.overflow = ''; // Destrava scroll
        }

        // Event Listeners
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.contains('mobile-open') ? closeMenu() : openMenu();
        });

        overlay.addEventListener('click', closeMenu);

        // Ao clicar em links da sidebar, fecha suavemente
        sidebar.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                setTimeout(closeMenu, 150); // Pequeno delay para UX
            });
        });

        // Swipe básico para fechar (opcional, bom para mobile)
        let touchStartX = 0;
        document.addEventListener('touchstart', e => touchStartX = e.changedTouches[0].screenX);
        document.addEventListener('touchend', e => {
            const touchEndX = e.changedTouches[0].screenX;
            // Se deslizou da direita para esquerda e menu está aberto -> fecha
            if (touchStartX - touchEndX > 50 && sidebar.classList.contains('mobile-open')) {
                closeMenu();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileExperience);
    } else {
        initMobileExperience();
    }
})();
