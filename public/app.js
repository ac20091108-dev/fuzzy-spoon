const SUPABASE_URL_DEFAULT = 'https://schmzbabkjfbaoafurvp.supabase.co';
const SUPABASE_ANON_KEY_DEFAULT = 'sb_publishable_aHB7LrCDcbq4XWNsp7pGkw_Jz8HAXuP';

let configApp = {
  supabaseUrl: SUPABASE_URL_DEFAULT,
  supabaseKey: SUPABASE_ANON_KEY_DEFAULT,
  geminiApiKey: ''
};

let mapaLeaflet = null;
let marcadoresLeaflet = [];
let tiendasData = [];
let componentesData = [];
let tiendaSeleccionadaId = '';
let avisoDatos = '';
let modelosDisponiblesCache = null;

function escaparHtml(texto = '') {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatearRespuestaIA(texto = '') {
  return escaparHtml(texto)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n/g, '<br />');
}

function obtenerUrlGoogleMaps(tienda) {
  const lat = Number(tienda?.latitud ?? tienda?.lat);
  const lng = Number(tienda?.longitud ?? tienda?.lng);
  if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  const consulta = [tienda?.nombre, tienda?.direccion, 'Paraguay'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

function renderizarMapa(tiendas = []) {
  const contenedor = document.getElementById('map');
  if (!contenedor || typeof L === 'undefined') return;

  if (!mapaLeaflet) {
    mapaLeaflet = L.map('map').setView([-25.2867, -57.647], 12);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    }).addTo(mapaLeaflet);
  }

  marcadoresLeaflet.forEach((m) => mapaLeaflet.removeLayer(m));
  marcadoresLeaflet = [];

  const bounds = [];

  tiendas.forEach((tienda, idx) => {
    const lat = Number(tienda.latitud ?? tienda.lat);
    const lng = Number(tienda.longitud ?? tienda.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return;

    const idTienda = String(tienda.id ?? idx);
    const gmapsUrl = obtenerUrlGoogleMaps(tienda);

    const popupHtml = `
      <strong>${escaparHtml(tienda.nombre || 'Tienda')}</strong><br />
      ${escaparHtml(tienda.direccion || '')}<br />
      ${escaparHtml(tienda.contacto || '')}<br />
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" onclick="seleccionarTienda('${idTienda}')" style="padding:4px 8px;cursor:pointer;">Filtrar catálogo</button>
        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" style="padding:4px 8px;background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Abrir en Google Maps</a>
      </div>
    `;

    const marker = L.marker([lat, lng])
      .addTo(mapaLeaflet)
      .bindPopup(popupHtml);

    marker.on('click', () => {
      seleccionarTienda(idTienda, false);
    });

    marcadoresLeaflet.push(marker);
    bounds.push([lat, lng]);
  });

  if (bounds.length > 0 && !tiendaSeleccionadaId) {
    mapaLeaflet.fitBounds(bounds, { padding: [25, 25] });
  }

  setTimeout(() => mapaLeaflet.invalidateSize(), 150);
}

function poblarSelectTiendas(tiendas) {
  const select = document.getElementById('filtro-tienda');
  if (!select) return;
  select.innerHTML = '<option value="">Todas las tiendas</option>';

  tiendas.forEach((t, idx) => {
    const opt = document.createElement('option');
    opt.value = String(t.id ?? idx);
    opt.textContent = t.nombre || `Tienda ${idx + 1}`;
    select.appendChild(opt);
  });

  select.value = tiendaSeleccionadaId;
}

function seleccionarTienda(id, centrar = true) {
  tiendaSeleccionadaId = id ? String(id) : '';
  const select = document.getElementById('filtro-tienda');
  if (select) select.value = tiendaSeleccionadaId;

  const tienda = tiendasData.find((t, idx) => String(t.id ?? idx) === tiendaSeleccionadaId);
  const estado = document.getElementById('estado-tienda');
  const inputChat = document.getElementById('chat-input');

  if (tienda) {
    const gmapsUrl = obtenerUrlGoogleMaps(tienda);
    if (estado) {
      estado.innerHTML = `Tienda seleccionada: <strong>${escaparHtml(tienda.nombre)}</strong>${tienda.direccion ? ` — ${escaparHtml(tienda.direccion)}` : ''} · <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer">Ver en Google Maps ↗</a>`;
    }
    if (inputChat) {
      inputChat.placeholder = `Preguntá sobre ${tienda.nombre}...`;
    }
    const lat = Number(tienda.latitud ?? tienda.lat);
    const lng = Number(tienda.longitud ?? tienda.lng);
    if (centrar && mapaLeaflet && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      mapaLeaflet.setView([lat, lng], 14);
    }
  } else {
    if (estado) estado.textContent = 'Seleccioná un pin o una tienda para filtrar.';
    if (inputChat) inputChat.placeholder = 'Preguntá por componentes, precios o tiendas...';
  }

  renderizarCatalogo();
}

function renderizarCatalogo() {
  const contenedor = document.getElementById('catalogo');
  const texto = (document.getElementById('buscar-input')?.value || '').trim().toLowerCase();
  if (!contenedor) return;

  const filtrados = componentesData.filter((c) => {
    const tiendaIdComp = c.tienda_id ?? c.tiendaId ?? '';
    const coincideTienda = !tiendaSeleccionadaId || String(tiendaIdComp) === tiendaSeleccionadaId;
    const nombre = String(c.nombre || c.titulo || '').toLowerCase();
    const categoria = String(c.categoria || '').toLowerCase();
    const coincideTexto = !texto || nombre.includes(texto) || categoria.includes(texto);
    return coincideTienda && coincideTexto;
  });

  if (filtrados.length === 0) {
    contenedor.innerHTML = `<p>No hay componentes que coincidan con el filtro.${avisoDatos ? `<br><small>${escaparHtml(avisoDatos)}</small>` : ''}</p>`;
    return;
  }

  contenedor.innerHTML = filtrados
    .map((c) => {
      const tiendaIdComp = c.tienda_id ?? c.tiendaId;
      const tiendaRel = c.tiendas || tiendasData.find((t) => String(t.id) === String(tiendaIdComp));
      const precioNum = Number(c.precio);
      const precioTexto = c.precio !== undefined && c.precio !== null && !Number.isNaN(precioNum)
        ? `<span class="item-precio">Gs. ${precioNum.toLocaleString('es-PY')}</span>`
        : '';
      const stockTexto = c.stock !== undefined && c.stock !== null ? ` · Stock: ${escaparHtml(c.stock)}` : '';
      const gmapsLink = tiendaRel ? ` · <a href="${obtenerUrlGoogleMaps(tiendaRel)}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>` : '';
      const tiendaTexto = tiendaRel?.nombre ? ` · <em>${escaparHtml(tiendaRel.nombre)}</em>${gmapsLink}` : '';

      return `
        <div class="item ${tiendaSeleccionadaId && String(tiendaIdComp) === tiendaSeleccionadaId ? 'activa' : ''}">
          <div><strong>${escaparHtml(c.nombre || c.titulo || 'Componente')}</strong> ${c.categoria ? `<span class="item-meta">(${escaparHtml(c.categoria)})</span>` : ''}</div>
          <div class="item-meta">${precioTexto}${stockTexto}${tiendaTexto}</div>
        </div>
      `;
    })
    .join('');
}

async function cargarConfiguracion() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      configApp = {
        supabaseUrl: data.supabaseUrl || SUPABASE_URL_DEFAULT,
        supabaseKey: data.supabaseKey || SUPABASE_ANON_KEY_DEFAULT,
        geminiApiKey: data.geminiApiKey || ''
      };
    }
  } catch (_) {
    configApp = {
      supabaseUrl: SUPABASE_URL_DEFAULT,
      supabaseKey: SUPABASE_ANON_KEY_DEFAULT,
      geminiApiKey: ''
    };
  }
}

async function consultarTablaSupabase(tabla, selectQuery = '*') {
  const url = `${configApp.supabaseUrl}/rest/v1/${tabla}?select=${encodeURIComponent(selectQuery)}`;
  const res = await fetch(url, {
    headers: {
      apikey: configApp.supabaseKey,
      Authorization: `Bearer ${configApp.supabaseKey}`
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Error ${res.status} al leer ${tabla}`);
  }
  return Array.isArray(data) ? data : [];
}

async function cargarDatos() {
  avisoDatos = '';
  await cargarConfiguracion();

  try {
    const [tiendas, componentes] = await Promise.all([
      consultarTablaSupabase('tiendas', '*'),
      consultarTablaSupabase('componentes', '*,tiendas(nombre,direccion,contacto)')
    ]);
    tiendasData = tiendas;
    componentesData = componentes;
  } catch (err) {
    console.error('Error cargando datos de Supabase:', err);
    avisoDatos = `No se pudieron cargar los datos de Supabase: ${err.message}`;
  }

  poblarSelectTiendas(tiendasData);
  renderizarMapa(tiendasData);
  renderizarCatalogo();
}

async function obtenerModelosGeminiDisponibles() {
  if (Array.isArray(modelosDisponiblesCache) && modelosDisponiblesCache.length > 0) {
    return modelosDisponiblesCache;
  }

  const candidatosPorDefecto = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  if (!configApp.geminiApiKey) return candidatosPorDefecto;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(configApp.geminiApiKey)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.models)) {
      const soportados = data.models
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);

      if (soportados.length > 0) {
        const flashPrimero = soportados.filter((n) => /flash/i.test(n));
        const resto = soportados.filter((n) => !/flash/i.test(n));
        modelosDisponiblesCache = [...flashPrimero, ...resto];
        return modelosDisponiblesCache;
      }
    }
  } catch (_) {
    // Si falla ListModels, usamos los candidatos por defecto
  }

  return candidatosPorDefecto;
}

async function consultarGeminiDirecto(mensajeFinal) {
  if (!configApp.geminiApiKey) {
    throw new Error('Falta GEMINI_API_KEY en el servidor o archivo .env.');
  }

  const contexto = JSON.stringify({ tiendas: tiendasData, componentes: componentesData });
  const promptSistema = `Eres TechFinder AI, asistente experto en informática, electrónica y robótica en Paraguay.
Tenés acceso a los registros reales de la base de datos en JSON:
${contexto}

Reglas:
1. Para precios, stock o qué tiendas venden algo, usá exclusivamente el JSON de arriba (nombre de tienda, dirección, contacto, precio y stock).
2. Para preguntas técnicas generales, respondé claro y recomendá componentes del catálogo si aplican.
3. Distinguí qué viene del Catálogo Registrado y qué es Conocimiento Técnico General. Sé conciso y usá negritas y viñetas.`;

  const modelos = await obtenerModelosGeminiDisponibles();
  let ultimoError = null;

  for (const modelo of modelos) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(configApp.geminiApiKey)}`;
    const gRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: promptSistema }] },
        contents: [{ parts: [{ text: mensajeFinal }] }],
        generationConfig: { temperature: 0.4 }
      })
    });

    const gData = await gRes.json().catch(() => ({}));
    const mensajeApi = gData?.error?.message || '';

    if (gRes.ok) {
      const textoRespuesta = gData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (textoRespuesta) return textoRespuesta;
      ultimoError = new Error('Gemini no devolvió texto.');
      continue;
    }

    ultimoError = new Error(mensajeApi || `Error ${gRes.status} al consultar Gemini`);

    const esReintentable =
      gRes.status === 404 ||
      gRes.status === 429 ||
      gRes.status === 503 ||
      /not found|high demand|overloaded|unavailable|quota|not supported/i.test(mensajeApi);

    if (esReintentable) {
      continue;
    }

    throw ultimoError;
  }

  throw ultimoError || new Error('No se pudo obtener respuesta de Gemini.');
}

async function consultarChat(mensajeFinal) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: mensajeFinal })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.respuesta) {
      return data.respuesta;
    }
  } catch (_) {
    // Si /api/chat no está disponible, se usa Gemini directo
  }

  return consultarGeminiDirecto(mensajeFinal);
}

document.addEventListener('DOMContentLoaded', () => {
  cargarDatos();

  document.getElementById('buscar-input')?.addEventListener('input', renderizarCatalogo);

  document.getElementById('filtro-tienda')?.addEventListener('change', (e) => {
    seleccionarTienda(e.target.value);
  });

  document.getElementById('btn-limpiar-filtro')?.addEventListener('click', () => {
    const buscar = document.getElementById('buscar-input');
    if (buscar) buscar.value = '';
    seleccionarTienda('');
  });

  document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('chat-btn');
    const mensajes = document.getElementById('chat-mensajes');
    const texto = input?.value.trim();
    if (!texto || !mensajes) return;

    const tienda = tiendasData.find((t, idx) => String(t.id ?? idx) === tiendaSeleccionadaId) || null;
    const mensajeFinal = tienda
      ? `${texto} (Contexto: tienda seleccionada "${tienda.nombre}")`
      : texto;

    mensajes.innerHTML += `<div class="msg msg-usuario"><strong>Vos:</strong> ${escaparHtml(texto)}</div>`;
    input.value = '';
    if (btn) btn.disabled = true;
    mensajes.scrollTop = mensajes.scrollHeight;

    const idCargando = `msg-${Date.now()}`;
    mensajes.innerHTML += `<div id="${idCargando}" class="msg msg-ia"><strong>TechFinder AI:</strong> Pensando...</div>`;
    mensajes.scrollTop = mensajes.scrollHeight;

    try {
      const respuesta = await consultarChat(mensajeFinal);
      const nodoCargando = document.getElementById(idCargando);
      if (nodoCargando) {
        nodoCargando.innerHTML = `<strong>TechFinder AI:</strong><br />${formatearRespuestaIA(respuesta)}`;
      }
    } catch (err) {
      const nodoCargando = document.getElementById(idCargando);
      if (nodoCargando) {
        nodoCargando.classList.add('msg-error');
        nodoCargando.innerHTML = `<strong>TechFinder AI:</strong> ${escaparHtml(err.message || 'No se pudo obtener respuesta.')}`;
      }
    } finally {
      if (btn) btn.disabled = false;
      mensajes.scrollTop = mensajes.scrollHeight;
    }
  });
});