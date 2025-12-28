# Instruções para Atualizar o Modal de Adicionar Imóvel

## Problema Identificado
1. Layout do modal está básico
2. Ao fechar o modal, a página volta para o topo (Agente IA)

## Solução Implementada

### Arquivo Criado
- `/views/partials/modal-imovel-novo.ejs` - Contém o novo modal redesenhado

### Mudanças Necessárias em `/views/cliente-detalhes.ejs`

#### 1. Substituir o Modal Antigo (linhas 301-428)
Substituir todo o bloco `<!-- Modal: Adicionar Imóvel -->` até o fechamento `</div>` pelo conteúdo do arquivo `/views/partials/modal-imovel-novo.ejs`

#### 2. Atualizar as Funções JavaScript (linhas 449-466)
Substituir as funções `abrirModalImovel()` e `fecharModalImovel()` por:

```javascript
// Prevenir scroll ao topo quando modal abre/fecha
let scrollPosition = 0;

function abrirModalImovel() {
    // Salvar posição atual do scroll
    scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    
    const modal = document.getElementById('modal-adicionar-imovel');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        modal.querySelector('.macos-window').style.transform = 'scale(1)';
    }, 10);
}

function fecharModalImovel() {
    const modal = document.getElementById('modal-adicionar-imovel');
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
    modal.querySelector('.macos-window').style.transform = 'scale(0.95)';
    setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('form-adicionar-imovel').reset();
        document.getElementById('loaded-calc-info').classList.add('hidden');
        document.getElementById('calc-loaded-indicator').style.display = 'none';
        
        // Restaurar posição do scroll
        window.scrollTo(0, scrollPosition);
    }, 300);
}
```

## Melhorias do Novo Design

### Visual
1. **Modal mais largo** (900px vs 700px) - melhor aproveitamento do espaço
2. **Backdrop com blur** - efeito glassmorphism moderno
3. **Header redesenhado** - título maior, subtítulo explicativo, botão X estilizado
4. **Seções organizadas** com ícones coloridos:
   - 🔵 Informações Básicas (azul)
   - 🟢 Valores e Origem (verde)
   - 🟠 Custos Mensais (laranja)
5. **Info box do cálculo melhorado** - cards com gradiente verde, layout em grid
6. **Footer fixo** - botões sempre visíveis no rodapé

### Funcional
1. **Scroll preservado** - ao fechar o modal, mantém a posição da página
2. **Melhor responsividade** - max-height: 90vh com scroll interno
3. **Animações suaves** - transições de 0.3s
4. **Hover states** - botão X fica vermelho ao passar o mouse

### Estrutura
- **Header** (flex-shrink: 0) - fixo no topo
- **Conteúdo** (flex: 1, overflow-y: auto) - área scrollável
- **Footer** (flex-shrink: 0) - fixo no rodapé

## Testando
Após aplicar as mudanças:
1. Abrir perfil de um cliente
2. Clicar em "Adicionar Imóvel"
3. Verificar o novo layout
4. Rolar a página para baixo antes de abrir o modal
5. Abrir o modal e fechar - verificar que a página mantém a posição
