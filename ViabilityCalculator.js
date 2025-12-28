/**
 * @class ViabilityCalculator
 * @description Calculates the viability of a real estate auction purchase based on various costs and projections.
 */
class ViabilityCalculator {

    /**
     * Private helper method to round a number to two decimal places for financial calculations.
     * @param {number} value - The number to round.
     * @returns {number} The rounded number.
     */
    _round(value) {
        // Using Number.EPSILON ensures more accurate rounding for floating-point numbers.
        return Math.round((value + Number.EPSILON) * 100) / 100;
    }

    /**
     * Private helper method to calculate the initial base investment.
     * @param {object} data - The input data object.
     * @returns {number} The total base investment.
     */
    _calculateInvestmentBase(data) {
        const {
            valorArrematado = 0,
            itbi = 0,
            custosCartorarios = 0,
            reforma = 0,
            debitosPendentes = 0,
            custosAdicionais = 0,
            tipoPagamento = 'vista', // 'vista' ou 'financiado'
            valorEntrada = 0,
            // Novos parâmetros de assessoria
            assessoriaThreshold = 120000,
            assessoriaFeeBelow = 6000,
            assessoriaFeeAbovePercent = 5
        } = data;

        // Cálculo da Assessoria
        let valorAssessoria = 0;
        if (valorArrematado <= assessoriaThreshold) {
            valorAssessoria = assessoriaFeeBelow;
        } else {
            valorAssessoria = this._round((valorArrematado * assessoriaFeeAbovePercent) / 100);
        }

        // Cálculo do ITBI
        let valorITBI = 0;

        // Nova regra: O usuário pode escolher a base de cálculo do ITBI
        // - 'avaliacao': usa o Valor de Avaliação (padrão, mais comum)
        // - 'arremate': usa o Valor de Arremate (varia por município)
        const itbiBase = data.itbiBase || 'avaliacao';

        let baseITBI;
        if (itbiBase === 'arremate') {
            // Usa o valor de arremate como base
            baseITBI = valorArrematado;
        } else {
            // Usa o valor de avaliação como base (padrão)
            baseITBI = data.valorAvaliacao && data.valorAvaliacao > 0 ? data.valorAvaliacao : valorArrematado;
        }

        if (tipoPagamento === 'financiado') {
            // Regra Financiado: 
            // - Parte financiada paga a alíquota financiada (geralmente reduzida)
            // - O restante (Base ITBI - Valor Financiado) paga a alíquota cheia (ITBI padrão)

            const valFinanciado = data.valorFinanciado || (valorArrematado - valorEntrada);
            const taxaItbiFinanciado = (data.itbiFinanciadoPercent || 0.5) / 100;

            // Garante que a base não seja menor que o valor financiado (caso atípico)
            const calcBase = Math.max(baseITBI, valFinanciado);
            const valRestante = Math.max(0, calcBase - valFinanciado);

            const itbiFinanciado = this._round(valFinanciado * taxaItbiFinanciado);
            const itbiRestante = this._round(valRestante * (itbi / 100));

            valorITBI = itbiFinanciado + itbiRestante;
        } else {
            // À vista: Taxa configurada sobre a base escolhida
            valorITBI = this._round((baseITBI * itbi) / 100);
        }

        // Optional auctioneer fee (leiloeiro) is 5% of the auction value when requested
        const valorLeiloeiro = data.incluirLeiloeiro ? this._round(valorArrematado * 0.05) : 0;

        // Armazena o valor calculado para uso posterior
        data._calculatedAssessoria = valorAssessoria;
        data._calculatedITBI = valorITBI;

        // Se for financiado, o investimento base é a Entrada + Custos
        // Se for à vista, é o Valor Arrematado + Custos
        const valorAquisicao = tipoPagamento === 'financiado' ? valorEntrada : valorArrematado;

        return this._round(
            valorAquisicao + valorAssessoria + valorITBI + custosCartorarios + reforma + debitosPendentes + custosAdicionais + valorLeiloeiro + (data.custoDesocupacao || 0)
        );
    }

    _calculateProjection(months, data, investimentoBase, corretagem) {
        const {
            condominioMensal = 0,
            iptuMensal = 0,
            taxaSeguroMensal = 0,
            valorVendaFinal = 0,
            aliquotaIRGC = 0.15, // Default 15%
            tipoPagamento = 'vista',
            custoMensalFinanciamento = 0,
            valorFinanciado = 0,
            taxaSeguroCaixa = 0 // Valor fixo do seguro (conforme planilha)
        } = data;

        // Determina o valor mensal do IPTU (prioriza o novo campo mensal, fallback para anual/12)
        const valIptuMensal = data.iptuMensal ? parseFloat(data.iptuMensal) : (data.iptuAnual ? parseFloat(data.iptuAnual) / 12 : 0);

        // Seguro: Se houver taxaSeguroCaixa (fixo), usa ele. Se não, calcula mensal.
        // Na planilha, o seguro é um valor fixo (R$ 190) que aparece igual em 6 e 12 meses.
        let custoSeguro = 0;
        if (taxaSeguroCaixa && parseFloat(taxaSeguroCaixa) > 0) {
            custoSeguro = parseFloat(taxaSeguroCaixa);
        } else if (taxaSeguroMensal && parseFloat(taxaSeguroMensal) > 0) {
            // Fallback apenas para mensal se fornecido explicitamente (embora removido da UI principal, mantemos compatibilidade)
            custoSeguro = parseFloat(taxaSeguroMensal) * months;
        }

        // Custos de manutenção do período
        // IPTU é mensal, Condomínio é mensal. Seguro é tratado acima.
        let custosManutencao = (condominioMensal * months) + (valIptuMensal * months) + custoSeguro;

        // Se financiado, adiciona as parcelas aos custos do período
        if (tipoPagamento === 'financiado') {
            custosManutencao += (custoMensalFinanciamento * months);
        }

        const custosPeriodo = this._round(custosManutencao);

        // Investimento Total (Cash Out acumulado)
        // Na planilha: Investimento Total (Base) + Custos Operacionais
        const investimentoTotal = this._round(investimentoBase + custosPeriodo);

        // Custo de Quitação (apenas para financiado)
        let custoQuitacao = 0;
        if (tipoPagamento === 'financiado') {
            custoQuitacao = valorFinanciado;
        }

        // --- CÁLCULO DO RESULTADO BRUTO ---
        // Planilha: Venda Final - Corretagem - Investimento Total no Período
        // Nota: A planilha subtrai o investimento total (que já inclui custos operacionais).
        const resultadoBruto = this._round(valorVendaFinal - corretagem - investimentoTotal - custoQuitacao);

        // --- CÁLCULO DOS IMPOSTOS ---
        // Padrão: 15% sobre o Ganho de Capital (Lucro) - Pessoa Física
        // Removida tributação fixa de 3.75% sobre a venda que estava duplicando custos ou simulando um cenário PJ específico demais.

        // Taxa fixa sobre a venda (Desabilitada)
        const tributacaoEntrada = 0; // this._round(valorVendaFinal * 0.0375);

        // IR sobre o Lucro (15% sobre o Resultado Bruto)
        const impostoLucro = resultadoBruto > 0 ? this._round(resultadoBruto * aliquotaIRGC) : 0;

        const impostoTotal = this._round(tributacaoEntrada + impostoLucro);

        // --- RESULTADO LÍQUIDO ---
        // Planilha: Resultado Bruto - Impostos
        // Ou: Venda - Corretagem - Investimento Total - Impostos
        const resultadoLiquido = this._round(resultadoBruto - impostoTotal);

        // --- ROI ---
        // Planilha ROI Bruto: Resultado Bruto / Investimento Total
        // Planilha ROI Líquido: Resultado Líquido / Investimento Total
        const roiLiquido = investimentoTotal > 0
            ? this._round((resultadoLiquido / investimentoTotal) * 100)
            : 0;

        return {
            custosPeriodo,
            investimentoTotal,
            resultadoBruto, // Retorna o lucro bruto
            resultadoLiquido,
            roiLiquido,
            impostoDevido: impostoTotal,
            tributacaoEntrada, // Retorna detalhado para debug se precisar
            impostoLucro
        };
    }

    /**
     * Main method to perform the complete viability calculation.
     * @param {object} inputData - An object containing all necessary input values.
     * @returns {object} A structured object with common calculations and projections for 6 and 12 months.
     */
    calculateViability(inputData) {
        const investimentoBase = this._calculateInvestmentBase(inputData);
        // Also calculate the advisory fee value to return it in the results
        const valorAssessoria = inputData._calculatedAssessoria || 0;
        const valorITBI = inputData._calculatedITBI || 0;
        const valorLeiloeiro = inputData.incluirLeiloeiro ? this._round(inputData.valorArrematado * 0.05) : 0;
        const corretagemPercent = inputData.corretagemPercent || 6;
        const corretagem = this._round(inputData.valorVendaFinal * (corretagemPercent / 100));

        const projection4Months = this._calculateProjection(4, inputData, investimentoBase, corretagem);
        const projection8Months = this._calculateProjection(8, inputData, investimentoBase, corretagem);
        const projection12Months = this._calculateProjection(12, inputData, investimentoBase, corretagem);
        const projection16Months = this._calculateProjection(16, inputData, investimentoBase, corretagem);

        return {
            common: {
                investimentoBase,
                corretagem,
                valorAssessoria,
                valorITBI,
                valorLeiloeiro
            },
            projection4Months,
            projection8Months,
            projection12Months,
            projection16Months
        };
    }
}

export default ViabilityCalculator;

/*
// =================================================================
// EXAMPLE USAGE (for demonstration purposes)
// You can run this file with `node ViabilityCalculator.js` to see the output.
// =================================================================

if (require.main === module) {
    const calculator = new ViabilityCalculator();

    const exampleInput = {
        valorArrematado: 200000,
        assessoria: 10000,
        itbi: 6000,
        custosCartorarios: 2000,
        reforma: 15000,
        debitosPendentes: 5000,
        valorVendaFinal: 300000,
        condominioMensal: 500,
        iptuAnual: 1200,
        taxaSeguroCaixa: 800,
        aliquotaIRGC: 0.15 // 15%
    };

    const results = calculator.calculateViability(exampleInput);

    console.log("--- Análise de Viabilidade de Arremate ---");
    console.log("\nDados de Entrada:");
    console.table(exampleInput);

    console.log("\nResultados Calculados:");
    console.log("Investimento Base: R$", results.common.investimentoBase.toFixed(2));
    console.log("Corretagem (6%): R$", results.common.corretagem.toFixed(2));

    console.log("\n--- Projeção para 06 Meses ---");
    console.table(results.projection6Months);

    console.log("\n--- Projeção para 12 Meses ---");
    console.table(results.projection12Months);
}
*/