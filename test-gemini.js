
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config();

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // Para listar modelos, a API usa GET, mas o SDK abstrai isso.
        // Infelizmente o método listModels do SDK pode variar.
        // Vamos tentar uma chamada direta simples primeiro.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Test");
        console.log("Gemini 1.5 Flash: OK");
    } catch (e) {
        console.log("Gemini 1.5 Flash: FALHOU", e.message);
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent("Test");
        console.log("Gemini Pro: OK");
    } catch (e) {
        console.log("Gemini Pro: FALHOU", e.message);
    }
}

listModels();
