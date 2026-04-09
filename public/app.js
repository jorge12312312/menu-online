let globalCategories = [];
let globalItems = [];
let cart = [];
let fuse = null;
let activeCatId = null; // null = todas las categorías visibles

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
        globalItems      = data.items      || [];
    } catch (error) {
        console.error('Error detallado:', error);
        loader.innerHTML = `<p style="color:#ff6b6b">Error al cargar el menú. Por favor recarga la página.</p>`;
        return;
    }

    // Inicializar Fuse solo después de tener los datos y solo si la librería cargó
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
        card.onclick = (e) => { e.preventDefault(); };
    } else {
        card.className = 'menu-card';
        card.onclick = (e) => {
            if (e.target.closest('.btn-add')) return;
            addToCart(item);
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
        : `<button class="btn-add" aria-label="Añadir al carrito" onclick="event.stopPropagation(); addToCartById('${item.id}')">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                   <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
               </svg>
           </button>`;

    card.innerHTML = `
        <div class="card-image-wrap">
            <img src="${item.image_url || ''}" class="card-image" alt="${item.name}" loading="lazy" onerror="this.parentElement.style.background='#1c1c1c'">
            ${badgeHtml}
            ${btnHtml}
        </div>
        <div class="card-content">
            <div class="card-title">${item.name}</div>
            ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
            <div class="card-price">S/ ${item.price.toFixed(2)}</div>
        </div>
    `;
    return card;
}

// ── Render App ───────────────────────────────────────────────────────────────
function renderApp() {
    loader.style.display = 'none';

    // Build category map
    const categoryMap = {};
    globalCategories.forEach(c => { categoryMap[c.id] = c.name; });

    // Collect unique category IDs preserved in item order
    const seenCats = [];
    globalItems.forEach(item => {
        const catId = item.category_id || 'uncategorized';
        if (!seenCats.find(c => c.id === catId)) {
            seenCats.push({ id: catId, name: categoryMap[catId] || 'Otros' });
        }
    });

    // ── Nav Pills ──
    categoryNav.innerHTML = '';

    // "Todos" pill
    const allPill = document.createElement('li');
    allPill.className = 'nav-pill active';
    allPill.dataset.catId = '';
    allPill.textContent = 'Todos';
    allPill.onclick = () => filterByCategory(null);
    categoryNav.appendChild(allPill);

    seenCats.forEach(cat => {
        const pill = document.createElement('li');
        pill.className = 'nav-pill';
        pill.dataset.catId = cat.id;
        pill.textContent = cat.name;
        pill.onclick = () => filterByCategory(cat.id);
        categoryNav.appendChild(pill);
    });

    // ── Single Grid with all cards ──
    const grid = document.getElementById('menu-grid');
    grid.innerHTML = '';
    globalItems.forEach(item => {
        const card = createCard(item);
        card.dataset.catId = item.category_id || 'uncategorized';
        grid.appendChild(card);
    });
}

// ── Category Filter ───────────────────────────────────────────────────────────
function filterByCategory(catId) {
    activeCatId = catId;

    // Update active pill
    document.querySelectorAll('.nav-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.catId === (catId || ''));
    });

    // Show/hide cards
    document.querySelectorAll('#menu-grid .menu-card').forEach(card => {
        const match = !catId || card.dataset.catId === catId;
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
    document.body.style.overflow = 'hidden';
});

function closeCartSettings() {
    cartOverlay.classList.remove('active');
    cartModal.classList.remove('active');
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
