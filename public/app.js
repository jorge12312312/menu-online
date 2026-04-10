let globalCategories = [];
let globalItems = [];
let cart = [];
let fuse = null;
let activeCatId = null;

// Categorías que NUNCA aparecen en la UI
const HIDDEN_CATEGORIES = ['Helados', 'Especiales del dia', 'Extras', 'Otros'];
// Subcategorías agrupadas bajo "Bebidas"
const BEBIDAS_SUBCATS   = ['Con Alcohol', 'Sin alcohol'];
// Orden estricto de la barra de navegación
const CATEGORY_ORDER    = ['Entradas', 'Pollos', 'Platos criollos', 'Pescados y Mariscos', 'Bebidas'];

// DOM Elements
const loader             = document.getElementById('loader');
const mainContent        = document.getElementById('main-content');
const categoryNav        = document.getElementById('category-nav');
const fabCart            = document.getElementById('fab-cart');
const fabBadge           = document.getElementById('fab-badge');
const fabTotal           = document.getElementById('fab-total');
const cartOverlay        = document.getElementById('cart-overlay');
const cartModal          = document.getElementById('cart-modal');
const cartItemsContainer = document.getElementById('cart-items');
const modalTotal         = document.getElementById('modal-total');
const btnCloseCart       = document.getElementById('btn-close-cart');
const btnCheckoutTransfer = document.getElementById('btn-checkout-transfer');
const btnCheckoutCash    = document.getElementById('btn-checkout-cash');
const toastContainer     = document.getElementById('toast-container');

// Payment Modal Elements
const paymentOverlay  = document.getElementById('payment-overlay');
const paymentModal    = document.getElementById('payment-modal');
const btnClosePayment = document.getElementById('btn-close-payment');
const btnWhatsapp     = document.getElementById('btn-whatsapp');

// ── Web Audio Engine ──────────────────────────────────────────────────
let _audioCtx = null;
function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
}

/* Sonido 1: Swoosh suave (papel/flip) — al girar tarjeta y cambiar categoría */
function playFlipSound() {
    try {
        const ctx  = getAudioCtx();
        const dur  = 0.11;
        const sr   = ctx.sampleRate;
        const buf  = ctx.createBuffer(1, Math.floor(sr * dur), sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const t  = i / sr;
            data[i]  = (Math.random() * 2 - 1) * Math.exp(-t * 45) * 0.28;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.setValueAtTime(1600, ctx.currentTime);
        filt.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + dur);
        filt.Q.value = 1.8;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.55, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
        src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
        src.start();
    } catch(e) { /* fail silently */ }
}

/* Sonido 2: Campanilla de moneda (ding) — al añadir al carrito */
function playAddSound() {
    try {
        const ctx = getAudioCtx();
        const t   = ctx.currentTime;
        [[880, 0, 0.18], [1320, 0.06, 0.14], [1760, 0.11, 0.10]].forEach(([freq, delay, vol]) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0, t + delay);
            gain.gain.linearRampToValueAtTime(vol, t + delay + 0.009);
            gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.42);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(t + delay); osc.stop(t + delay + 0.45);
        });
    } catch(e) { /* fail silently */ }
}


// Search / View Elements
const searchInput       = document.getElementById('search-input');
const menuGridWrapper   = document.getElementById('menu-grid-wrapper');
const searchResultsView = document.getElementById('search-results-view');

// ── Init ────────────────────────────────────────────────────────────────────
async function initApp() {
    try {
        const res = await fetch('/api/menu');
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        globalCategories = data.categories || [];
        // 1) Quitar agotados
        globalItems = (data.items || []).filter(i => i.available !== false);
    } catch (error) {
        console.error('Error detallado:', error);
        loader.innerHTML = `<p style="color:#ff6b6b">Error al cargar el menú. Por favor recarga la página.</p>`;
        return;
    }

    // Inicializar Fuse solo con ítems disponibles
    if (typeof Fuse !== 'undefined') {
        fuse = new Fuse(globalItems, {
            keys: ['name', 'description'],
            threshold: 0.4,
            includeScore: true,
        });
    } else {
        console.warn('Fuse.js no disponible — búsqueda desactivada');
    }

    renderApp();
    setupSearch();
}

// ── Card Factory ─────────────────────────────────────────────────────────────
function createCard(item) {
    const card = document.createElement('div');

    if (item.available === false) {
        card.className = 'menu-card out-of-stock';
        card.onclick = (e) => {
            if (e.target.closest('.btn-add')) return;
            card.classList.toggle('flipped');
            playFlipSound();
        };
    } else {
        card.className = 'menu-card';
        card.onclick = (e) => {
            if (e.target.closest('.btn-add')) return;
            card.classList.toggle('flipped');
            playFlipSound();
        };
    }

    const badgeHtml = item.available === false
        ? `<div class="badge-out-of-stock">Agotado</div>`
        : '';

    const btnHtml = item.available === false
        ? `<button class="btn-add disabled" disabled>
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                   <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
               </svg>
           </button>`
        : `<button class="btn-add" aria-label="Añadir al carrito" onclick="event.stopPropagation(); playAddSound(); addToCartById('${item.id}')">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                   <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
               </svg>
           </button>`;

    card.innerHTML = `
        <div class="card-inner">
            <div class="card-face card-front">
                <div class="card-image-wrap">
                    <img src="${item.image_url || ''}" class="card-image" alt="${item.name}" loading="lazy" onerror="this.parentElement.style.background='#1c1c1c'">
                    ${badgeHtml}
                    ${btnHtml}
                </div>
                <div class="card-content">
                    <div class="card-title">${item.name}</div>
                    <div class="card-price">S/ ${item.price.toFixed(2)}</div>
                </div>
            </div>
            <div class="card-face card-back">
                <div class="card-back-title">${item.name}</div>
                <div class="card-back-desc">${item.description || '<span class="no-desc">Sin descripción disponible</span>'}</div>
                <div class="card-back-price">S/ ${item.price.toFixed(2)}</div>
            </div>
        </div>
    `;
    return card;
}

// ── Render App ───────────────────────────────────────────────────────────────
function renderApp() {
    loader.style.display = 'none';

    const categoryMap = {};
    globalCategories.forEach(c => { categoryMap[c.id] = c.name; });

    // IDs de subcategorías de Bebidas
    const bebidasIds = globalCategories
        .filter(c => BEBIDAS_SUBCATS.includes(c.name))
        .map(c => c.id);

    // Mapa nombre → id (incluyendo lo que revelan los ítems)
    const nameToId = {};
    globalCategories.forEach(c => { nameToId[c.name] = c.id; });
    globalItems.forEach(item => {
        const name = categoryMap[item.category_id] || '';
        if (name && !nameToId[name]) nameToId[name] = item.category_id;
    });

    // IDs que realmente tienen ítems disponibles
    const presentCatIds = new Set(globalItems.map(i => i.category_id));

    // ── Nav Pills (orden estricto) ──
    categoryNav.innerHTML = '';
    const subBar = document.getElementById('sub-categories-bar');
    subBar.innerHTML = '';
    subBar.style.display = 'none';

    let defaultCatId = null; // primera categoría visible → activa por defecto

    CATEGORY_ORDER.forEach(catName => {

        // ── Pill maestro "Bebidas" ──
        if (catName === 'Bebidas') {
            const hasItems = bebidasIds.some(id => presentCatIds.has(id));
            if (!hasItems) return;

            const pill = buildPill('Bebidas', '__bebidas__');
            pill.onclick = () => {
                playFlipSound();
                const isActive = pill.classList.contains('active');
                setAllPillsInactive();
                if (isActive) {
                    subBar.style.display = 'none';
                    // volver a la categoría por defecto
                    filterByCategory(defaultCatId);
                    markPillActive(defaultCatId);
                } else {
                    pill.classList.add('active');
                    filterByCategory(bebidasIds);
                    showSubBar(bebidasIds, subBar);
                }
                pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            };
            categoryNav.appendChild(pill);
            return;
        }

        // ── Categoría normal ──
        const catId = nameToId[catName];
        if (!catId || !presentCatIds.has(catId)) return;
        if (HIDDEN_CATEGORIES.includes(catName)) return;

        const pill = buildPill(catName, catId);
        if (defaultCatId === null) defaultCatId = catId; // primera → default

        pill.onclick = () => {
            playFlipSound();
            setAllPillsInactive();
            pill.classList.add('active');
            subBar.style.display = 'none';
            filterByCategory(catId);
            pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        };
        categoryNav.appendChild(pill);
    });

    // Activar pill visualmente (sin filtrar todavía, el grid no existe aún)
    if (defaultCatId) markPillActive(defaultCatId);

    // ── Grid: renderizar todos los ítems válidos ──
    const grid = document.getElementById('menu-grid');
    grid.innerHTML = '';
    globalItems.forEach(item => {
        const catName = categoryMap[item.category_id] || '';
        // Excluir categorías ocultas que NO son bebidas
        if (HIDDEN_CATEGORIES.includes(catName) && !BEBIDAS_SUBCATS.includes(catName)) return;
        const card = createCard(item);
        card.dataset.catId = item.category_id || 'uncategorized';
        grid.appendChild(card);
    });

    // Aplicar el filtro inicial DESPUÉS de que el grid esté construido
    if (defaultCatId) filterByCategory(defaultCatId);
}

// Crea un <li> pill genérico
function buildPill(text, catId) {
    const pill = document.createElement('li');
    pill.className = 'nav-pill';
    pill.dataset.catId = catId;
    pill.textContent = text;
    return pill;
}

// Marca activo el pill por catId
function markPillActive(catId) {
    document.querySelectorAll('#category-nav .nav-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.catId === (catId || ''));
    });
}

function setAllPillsInactive() {
    document.querySelectorAll('#category-nav .nav-pill').forEach(p => p.classList.remove('active'));
}

// Muestra la barra de sub-pills bajo la nav principal
function showSubBar(bebidasIds, subBar) {
    subBar.innerHTML = '';
    subBar.style.display = 'flex';
    const subCats = globalCategories.filter(c => BEBIDAS_SUBCATS.includes(c.name));
    subCats.forEach(sc => {
        const sub = document.createElement('button');
        sub.className = 'sub-pill';
        sub.textContent = sc.name;
        sub.onclick = () => {
            playFlipSound();
            subBar.querySelectorAll('.sub-pill').forEach(s => s.classList.remove('active'));
            sub.classList.add('active');
            filterByCategory(sc.id);
        };
        subBar.appendChild(sub);
    });
}

// Stub: sub-pills ya no están en la nav principal
function removeSubPills() {}



// ── Category Filter ───────────────────────────────────────────────────────────
// catId: null = todos | string = un catId | string[] = varios catIds (Bebidas)
function filterByCategory(catId) {
    activeCatId = catId;

    // Update active pill (solo pills no-sub)
    document.querySelectorAll('.nav-pill:not(.nav-sub-pill)').forEach(p => {
        if (Array.isArray(catId)) {
            p.classList.toggle('active', p.dataset.catId === '__bebidas__');
        } else {
            p.classList.toggle('active', p.dataset.catId === (catId || ''));
        }
    });

    // Show/hide cards
    document.querySelectorAll('#menu-grid .menu-card').forEach(card => {
        let match;
        if (!catId) {
            match = true;
        } else if (Array.isArray(catId)) {
            match = catId.includes(card.dataset.catId);
        } else {
            match = card.dataset.catId === catId;
        }
        card.style.display = match ? '' : 'none';
    });
}

// ── Fuzzy Search ─────────────────────────────────────────────────────────────
function setupSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) {
            menuGridWrapper.style.display = '';
            searchResultsView.style.display = 'none';
            searchResultsView.innerHTML = '';
            filterByCategory(activeCatId);
            return;
        }
        // Desmarcar pills al buscar
        document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
        menuGridWrapper.style.display = 'none';
        renderSearchResults(query);
    });
}

function renderSearchResults(query) {
    // Mostrar explícitamente (override del inline style inicial)
    searchResultsView.style.display = 'block';

    if (!fuse) {
        // Fallback: búsqueda simple por includes si Fuse no cargó
        const q = query.toLowerCase();
        const fallback = globalItems.filter(item =>
            item.name.toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q)
        );
        renderResultGrid(fallback, query);
        return;
    }

    const results = fuse.search(query).map(r => r.item);
    renderResultGrid(results, query);
}

function renderResultGrid(items, query) {
    if (items.length === 0) {
        searchResultsView.innerHTML = `<p class="search-empty">Sin resultados para "${query}"</p>`;
        return;
    }
    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    items.forEach(item => grid.appendChild(createCard(item)));
    searchResultsView.innerHTML = '';
    searchResultsView.appendChild(grid);
}

// ── Cart Logic ───────────────────────────────────────────────────────────────
window.addToCartById = function(itemId) {
    const item = globalItems.find(i => i.id === itemId);
    if (item) addToCart(item);
};

function addToCart(item) {
    const existing = cart.find(i => i.id === item.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({ ...item, quantity: 1 });
    }
    updateCartUI();
    showToast(`Añadido: ${item.name}`);
}

window.updateCartQuantity = function updateCartQuantity(itemId, delta) {
    const index = cart.findIndex(i => i.id === itemId);
    if (index > -1) {
        cart[index].quantity += delta;
        if (cart[index].quantity <= 0) cart.splice(index, 1);
        updateCartUI();
    }
}

function updateCartUI() {
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (count > 0) {
        fabCart.style.display = 'flex';
        fabCart.style.animation = 'none';
        fabCart.offsetHeight;
        fabCart.style.animation = 'slideDown 0.3s cubic-bezier(0.2, 0, 0, 1)';
    } else {
        fabCart.style.display = 'none';
        closeCartSettings();
    }

    fabBadge.textContent = count;
    fabTotal.textContent = `S/ ${totalAmount.toFixed(2)}`;
    modalTotal.textContent = `S/ ${totalAmount.toFixed(2)}`;
    renderCartModal();
}

function renderCartModal() {
    cartItemsContainer.innerHTML = '';
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p style="text-align:center;color:#666;padding:30px 0">El carrito está vacío</p>';
        btnCheckoutTransfer.disabled = true;
        btnCheckoutCash.disabled = true;
        return;
    }

    btnCheckoutTransfer.disabled = false;
    btnCheckoutCash.disabled = false;

    cart.forEach(item => {
        const row = document.createElement('div');
        row.className = 'cart-item';
        row.innerHTML = `
            <div class="cart-item-details">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">S/ ${(item.price * item.quantity).toFixed(2)}</div>
            </div>
            <div class="cart-controls">
                <button class="control-btn" onclick="updateCartQuantity('${item.id}', -1)">−</button>
                <span>${item.quantity}</span>
                <button class="control-btn" onclick="updateCartQuantity('${item.id}', 1)">+</button>
            </div>
        `;
        cartItemsContainer.appendChild(row);
    });
}

// ── Modal Triggers ───────────────────────────────────────────────────────────
fabCart.addEventListener('click', () => {
    cartOverlay.classList.add('active');
    cartModal.classList.add('active');
    document.body.classList.add('cart-open');
    document.body.style.overflow = 'hidden';
});

function closeCartSettings() {
    cartOverlay.classList.remove('active');
    cartModal.classList.remove('active');
    document.body.classList.remove('cart-open');
    document.body.style.overflow = '';
}

function closePaymentModal() {
    paymentOverlay.classList.remove('active');
    paymentModal.classList.remove('active');
}

btnCloseCart.addEventListener('click', closeCartSettings);
cartOverlay.addEventListener('click', closeCartSettings);
btnClosePayment.addEventListener('click', closePaymentModal);
paymentOverlay.addEventListener('click', closePaymentModal);

// ── WhatsApp Checkout ────────────────────────────────────────────────────────
function buildWhatsAppMessage(totalAmount, method) {
    let text = `Hola! Quiero hacer este pedido:\n`;
    cart.forEach(item => {
        text += `- ${item.quantity}x ${item.name}  (S/ ${(item.price * item.quantity).toFixed(2)})\n`;
    });
    text += `\n*Total: S/ ${totalAmount.toFixed(2)}*\n`;
    text += `*Método de pago: ${method}*`;
    return text;
}

btnCheckoutTransfer.addEventListener('click', () => {
    if (cart.length === 0) return;
    cartModal.classList.remove('active');
    paymentOverlay.classList.add('active');
    paymentModal.classList.add('active');
});

async function processCheckout(paymentType) {
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    try {
        const response = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart, total: totalAmount, paymentType })
        });
        const data = await response.json();
        return { ok: response.ok, success: data.success };
    } catch (err) {
        console.error(err);
        return { ok: false, success: false };
    }
}

btnCheckoutCash.addEventListener('click', () => {
    if (cart.length === 0) return;
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const waLink = `https://wa.me/5491125565977?text=${encodeURIComponent(buildWhatsAppMessage(totalAmount, 'Efectivo'))}`;
    processCheckout('cash').catch(() => {});
    cart = [];
    updateCartUI();
    closeCartSettings();
    window.open(waLink, '_blank');
});

btnWhatsapp.addEventListener('click', () => {
    if (cart.length === 0) return;
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const waLink = `https://wa.me/5491125565977?text=${encodeURIComponent(buildWhatsAppMessage(totalAmount, 'Transferencia'))}`;
    processCheckout('transfer').catch(() => {});
    cart = [];
    updateCartUI();
    closePaymentModal();
    closeCartSettings();
    window.open(waLink, '_blank');
});

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

document.addEventListener('DOMContentLoaded', initApp);
