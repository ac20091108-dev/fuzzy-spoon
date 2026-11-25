require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const hasPlaceholder = (value) => !value || value.startsWith('TU_');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

let supabase = null;
let ai = null;

if (!hasPlaceholder(supabaseUrl) && !hasPlaceholder(supabaseKey)) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.warn('Supabase no configurado: agrega SUPABASE_URL y SUPABASE_ANON_KEY en .env');
}

if (!hasPlaceholder(geminiKey)) {
    ai = new GoogleGenAI({ apiKey: geminiKey });
} else {
    console.warn('Gemini no configurado: agrega GEMINI_API_KEY en .env');
}

app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: hasPlaceholder(supabaseUrl) ? '' : supabaseUrl,
        supabaseKey: hasPlaceholder(supabaseKey) ? '' : supabaseKey,
        geminiApiKey: hasPlaceholder(geminiKey) ? '' : geminiKey
    });
});

async function obtenerModelosBackend() {
    const fallback = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
    if (hasPlaceholder(geminiKey)) return fallback;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`);
        const data = await res.json();
        if (res.ok && Array.isArray(data.models)) {
            const lista = data.models
                .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                .map((m) => String(m.name || '').replace(/^models\//, ''))
                .filter(Boolean);
            if (lista.length > 0) {
                const flash = lista.filter((n) => /flash/i.test(n));
                const otros = lista.filter((n) => !/flash/i.test(n));
                return [...flash, ...otros];
            }
        }
    } catch (_) {
        // usa fallback
    }
    return fallback;
}

app.get('/api/tiendas', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase no está configurado.' });
        }
        const { data, error } = await supabase.from('tiendas').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error en GET /api/tiendas:', error);
        res.status(500).json({ error: error.message || 'Error al obtener tiendas' });
    }
});

app.get('/api/componentes', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase no está configurado.' });
        }
        const { data, error } = await supabase
            .from('componentes')
            .select('*, tiendas(nombre, direccion, contacto)');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error en GET /api/componentes:', error);
        res.status(500).json({ error: error.message || 'Error al obtener componentes' });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        if (!supabase) {
            return res.status(503).json({ error: 'Supabase no está configurado.' });
        }
        if (!ai) {
            return res.status(503).json({ error: 'Gemini no está configurado.' });
        }

        const { mensaje } = req.body;

        const { data: tiendas, error: tiendasError } = await supabase.from('tiendas').select('*');
        if (tiendasError) throw tiendasError;

        const { data: componentes, error: componentesError } = await supabase
            .from('componentes')
            .select('*, tiendas(nombre, direccion, contacto)');
        if (componentesError) throw componentesError;

        const contextoBaseDatos = JSON.stringify({ tiendas, componentes });

        const systemInstruction = `
Eres TechFinder AI, un asistente experto en informática, electrónica y robótica integrado en una plataforma web de tiendas.
Tienes acceso a los registros REALES actuales de la base de datos en formato JSON:
${contextoBaseDatos}

REGLAS OBLIGATORIAS PARA RESPONDER:
1. Cuando te pregunten por productos, precios, stock o qué tiendas venden algo, consulta EXCLUSIVAMENTE el JSON de la base de datos proporcionado arriba. Indica el nombre de la tienda, dirección, contacto, precio y stock disponible.
2. Si te hacen preguntas técnicas generales (como diferencias entre Arduino y ESP32 o qué componentes se necesitan para armar un robot básico), responde con conocimiento técnico claro y, ADEMÁS, recomienda componentes compatibles que estén disponibles en el catálogo real de arriba.
3. Distingue explícitamente en tu respuesta qué información proviene del **Catálogo Registrado en el Sistema** y qué parte es **Conocimiento Técnico General**.
4. Sé amable, claro, estructurado y conciso. Usa formato Markdown ligero (negritas y viñetas).
`;

        const modelos = await obtenerModelosBackend();
        let respuestaTexto = null;
        let ultimoError = null;

        for (const model of modelos) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents: mensaje,
                    config: {
                        systemInstruction,
                        temperature: 0.4
                    }
                });
                if (response?.text) {
                    respuestaTexto = response.text;
                    break;
                }
            } catch (err) {
                ultimoError = err;
            }
        }

        if (!respuestaTexto) {
            throw ultimoError || new Error('No se obtuvo respuesta de Gemini.');
        }

        res.json({ respuesta: respuestaTexto });
    } catch (error) {
        console.error('Error en Gemini API:', error);
        res.status(500).json({ error: error.message || 'Error al procesar la consulta con TechFinder AI.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor TechFinder AI corriendo en http://localhost:${PORT}`);
});