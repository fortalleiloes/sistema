
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

async function checkModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { console.log("Sem Key"); return; }

    // Vamos fazer um fetch manual para listar modelos, evitando abstração do SDK
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("Erro na API:", data.error);
        } else {
            console.log("Modelos Disponíveis:");
            // Filtrar apenas os que suportam 'generateContent'
            const models = data.models || [];
            models.forEach(m => {
                if (m.supportedGenerationMethods.includes('generateContent')) {
                    console.log(`- ${m.name.replace('models/', '')}`);
                }
            });
        }
    } catch (err) {
        console.error("Erro de conexão:", err);
    }
}

checkModels();
