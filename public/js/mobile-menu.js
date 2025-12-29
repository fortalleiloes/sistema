/**
 * 📱 Mobile Menu Controller
 * Controla abertura/fechamento da sidebar no mobile
 */

(function () {
    'use strict';

    // Criar botão hamburguer
    function createMobileMenuButton() {
        const button = document.createElement('button');
        button.className = 'mobile-menu-toggle';
        button.setAttribute('aria-label', 'Abrir menu');
        button.innerHTML = '<i class="fa-solid fa-bars"></i>';
        document.body.appendChild(button);
        return button;
    }

    // Criar overlay
    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'mobile-sidebar-overlay';
        document.body.appendChild(overlay);
        return overlay;
    }

    // Inicializar menu mobile
    function initMobileMenu() {
        const sidebar = document.querySelector('.macos-sidebar');
        if (!sidebar) return;

        const menuButton = createMobileMenuButton();
        const overlay = createOverlay();

        // Abrir menu
        function openMenu() {
            sidebar.classList.add('mobile-open');
            overlay.classList.add('active');
            menuButton.innerHTML = '<i class="fa-solid fa-times"></i>';
            document.body.style.overflow = 'hidden'; // Prevenir scroll
        }

        // Fechar menu
        function closeMenu() {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            menuButton.innerHTML = '<i class="fa-solid fa-bars"></i>';
            document.body.style.overflow = ''; // Restaurar scroll
        }

        // Toggle menu
        menuButton.addEventListener('click', () => {
            if (sidebar.classList.contains('mobile-open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        // Fechar ao clicar no overlay
        overlay.addEventListener('click', closeMenu);

        // Fechar ao clicar em um link da sidebar
        const sidebarLinks = sidebar.querySelectorAll('a');
        sidebarLinks.forEach(link => {
            link.addEventListener('click', () => {
                // Pequeno delay para permitir navegação
                setTimeout(closeMenu, 100);
            });
        });

        // Fechar ao pressionar ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
                closeMenu();
            }
        });

        // Fechar ao redimensionar para desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && sidebar.classList.contains('mobile-open')) {
                closeMenu();
            }
        });
    }

    // Inicializar quando DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMobileMenu);
    } else {
        initMobileMenu();
    }
})();
