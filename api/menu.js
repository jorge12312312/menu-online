/**
 * api/menu.js — Vercel Serverless Function
 *
 * Actúa como proxy seguro entre el frontend y la API de Loyverse.
 * El token nunca sale al navegador: vive en process.env.LOYVERSE_TOKEN.
 *
 * Endpoint: GET /api/menu
 * Respuesta: { categories: [...], items: [...] }
 */

const LOYVERSE_API_URL = 'https://api.loyverse.com/v1.0';

// ─── Helper: pagina automáticamente los endpoints de Loyverse ────────────────
async function fetchAllLoyverseData(endpoint, token) {
    let allData = [];
    let cursor = null;

    do {
        const url = cursor
            ? `${LOYVERSE_API_URL}${endpoint}?cursor=${encodeURIComponent(cursor)}&limit=250`
            : `${LOYVERSE_API_URL}${endpoint}?limit=250`;

        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Loyverse API ${endpoint} → ${response.status}: ${errText}`);
        }

        const data = await response.json();

        // La clave del array varía ('items', 'categories', 'inventory_levels', etc.)
        const dataKey = Object.keys(data).find(k => k !== 'cursor');
        if (dataKey && Array.isArray(data[dataKey])) {
            allData = allData.concat(data[dataKey]);
        }

        cursor = data.cursor || null;
    } while (cursor);

    return allData;
}

// ─── Handler principal ────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
    // Solo GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido.' });
    }

    const token = process.env.LOYVERSE_TOKEN;
    if (!token) {
        console.error('[menu] LOYVERSE_TOKEN no está configurado en las variables de entorno.');
        return res.status(500).json({ error: 'Configuración del servidor incompleta.' });
    }

    try {
        // Tres endpoints en paralelo para minimizar latencia
        const [categoriesData, itemsData, inventoryData] = await Promise.all([
            fetchAllLoyverseData('/categories', token),
            fetchAllLoyverseData('/items', token),
            fetchAllLoyverseData('/inventory', token)
        ]);

        // Mapa de stock por variant_id para búsqueda O(1)
        const stockMap = {};
        inventoryData.forEach(inv => {
            stockMap[inv.variant_id] = inv.in_stock;
        });

        // Transformar ítems al formato que espera el frontend
        const items = itemsData
            .filter(item => item.variants?.length > 0)
            .map(item => {
                const variant    = item.variants[0];
                const storeData  = variant.stores?.[0] ?? null;
                const trackStock = item.track_stock === true;
                const inStock    = stockMap[variant.variant_id] ?? 0;

                let isAvailable = storeData ? storeData.available_for_sale : true;
                if (trackStock && inStock <= 0) isAvailable = false;

                return {
                    id:          item.id,
                    item_id:     item.id,
                    variant_id:  variant.variant_id,
                    name:        item.item_name,
                    description: item.description || '',
                    price:       variant.default_price || 0,
                    image_url:   item.image_url || '',   // URL directa de Loyverse CDN
                    category_id: item.category_id || 'uncategorized',
                    available:   isAvailable,
                    store_id:    storeData?.store_id ?? null,
                    stock:       inStock
                };
            });

        const categories = categoriesData.map(c => ({ id: c.id, name: c.name }));
        if (items.some(i => i.category_id === 'uncategorized')) {
            categories.push({ id: 'uncategorized', name: 'Otros' });
        }

        // Cache de 60 segundos en el borde de Vercel — evita golpear Loyverse en
        // cada visita sin sacrificar frescura del stock
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        res.status(200).json({ categories, items });

    } catch (err) {
        console.error('[menu] Error al obtener datos de Loyverse:', err.message);
        res.status(502).json({ error: 'No se pudo obtener el menú. Intenta más tarde.' });
    }
};
