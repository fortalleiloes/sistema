document.addEventListener('DOMContentLoaded', () => {
    const themeCheckbox = document.getElementById('theme-toggle-checkbox');

    // Função para aplicar o tema
    const applyTheme = (theme) => {
        // Atualiza a classe no HTML
        if (theme === 'dark') {
            document.documentElement.classList.remove('light');
            document.documentElement.classList.add('dark'); // Opcional, se usar classe dark explícita
        } else {
            document.documentElement.classList.add('light');
            document.documentElement.classList.remove('dark');
        }

        // Sincroniza o checkbox se ele existir
        if (themeCheckbox) {
            themeCheckbox.checked = (theme === 'dark');
        }
    };

    // 1. Carregar tema salvo ou padrão
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    // 2. Listener para mudança no checkbox
    if (themeCheckbox) {
        themeCheckbox.addEventListener('change', () => {
            const newTheme = themeCheckbox.checked ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        });
    }
});
