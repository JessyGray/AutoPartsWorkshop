"use strict";

(function initializeApplication(global) {
  const Core = global.InventoryCore;
  const Api = global.WorkshopServerApi;
  const Backup = global.InventoryBackup;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const pageMeta = {
    dashboard: ["לוח ראשי", "תמונת מצב מהירה של הסדנה"],
    sale: ["מכירה חדשה", "בחר קטגוריה והוסף חלקים לסל"],
    inventory: ["מלאי חלקים", "חיפוש, עדכון ומעקב אחר הכמויות"],
    product: ["חלק חילוף חדש", "יצירת כרטיס חלק מפורט"],
    sales: ["היסטוריית מכירות", "כל העסקאות והביטולים במקום אחד"],
    count: ["ספירת מלאי", "התאמת הכמות במערכת למלאי הפיזי"],
    movements: ["תנועות מלאי", "יומן מלא של כל שינוי בכמות"],
    backup: ["גיבוי ושחזור", "שמירת עותקים ובדיקת תקינות"],
    settings: ["הגדרות", "פרטי העסק והתנהגות המערכת"]
  };

  const movementNames = {
    INITIAL_STOCK: "מלאי התחלתי",
    RESTOCK: "הוספת מלאי",
    MANUAL_ADJUSTMENT: "תיקון ידני",
    ADJUSTMENT: "תיקון ידני",
    SALE: "מכירה",
    SALE_CANCELLATION: "ביטול מכירה",
    WRITE_OFF: "פחת / נזק",
    INVENTORY_COUNT: "ספירת מלאי"
  };

  let currentPage = "dashboard";
  let selectedCategory = "ALL";
  let cart = [];
  let toastTimer;
  let dialogResolver = null;
  let serverWasDisconnected = false;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function formatMoney(minorValue) {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: Core.data.settings.currency || "ILS" }).format((Number(minorValue) || 0) / 100);
  }

  function formatDate(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
  }

  function downloadCountCsv(count) {
    const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Product ID", "SKU", "Product", "Expected", "Counted", "Difference"],
      ...count.lines.map((line) => [line.productId, line.sku, line.name, line.expected, line.counted, line.difference])
    ];
    const blob = new Blob([`\ufeff${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${count.number}_${count.createdAt.slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = "toast"; }, 3800);
  }

  function categorySymbol(category = "") {
    const normalized = category.toLowerCase();
    if (normalized.includes("בלמ")) return "◉";
    if (normalized.includes("פילטר")) return "▥";
    if (normalized.includes("מנוע") || normalized.includes("גיר")) return "⚙";
    if (normalized.includes("חשמל") || normalized.includes("הצת")) return "ϟ";
    if (normalized.includes("שמן") || normalized.includes("נוזל")) return "◆";
    if (normalized.includes("צמיג") || normalized.includes("גלגל")) return "◌";
    if (normalized.includes("תאורה")) return "◐";
    if (normalized.includes("קירור") || normalized.includes("מיזוג")) return "❄";
    return "⌁";
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Repaints the page and updates the switcher's visual state. Does NOT
  // persist — the inline <head> script already applied the saved theme
  // before first paint, so this only needs to run after a real change
  // (toggle click) or to keep the switch in sync with loaded settings.
  function applyTheme(theme) {
    const resolved = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", resolved);
    try { localStorage.setItem("workshopTheme", resolved); } catch (error) { /* private mode etc. */ }
    const toggle = $("#themeToggle");
    if (toggle) toggle.setAttribute("aria-checked", resolved === "dark" ? "true" : "false");
  }

  async function persistTheme(theme) {
    try { await Api.mutate("saveSettings", [{ ...Core.data.settings, theme }]); }
    catch (error) { showToast(error.message, true); }
  }

  function applySettings() {
    const settings = Core.data.settings;
    document.documentElement.dataset.accent = settings.accent || "orange";
    applyTheme(settings.theme || currentTheme());
    document.title = `${settings.businessName} · Inventory`;
    $("#brandName").textContent = settings.businessName;
    $("#profileBusiness").textContent = settings.businessName;
    $("#splashName").textContent = settings.businessName;
    $("#heroTitle").textContent = `${settings.businessName} — מלאי ומכירות בלי בלגן`;
    const initials = settings.businessName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
    $(".profile-mark").textContent = initials || "AP";
  }

  function closeSidebar() {
    $("#sidebar").classList.remove("open");
    $("#menuButton").setAttribute("aria-expanded", "false");
  }

  function bindSidebarEvents() {
    const sidebar = $("#sidebar");
    const menuButton = $("#menuButton");
    const mobile = window.matchMedia("(max-width: 780px)");
    menuButton.setAttribute("aria-controls", "sidebar");
    closeSidebar();
    menuButton.addEventListener("click", () => {
      if (!mobile.matches) return;
      const open = sidebar.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("pointerdown", (event) => {
      if (mobile.matches && !sidebar.contains(event.target) && !menuButton.contains(event.target)) {
        closeSidebar();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (mobile.matches && event.key === "Escape" && sidebar.classList.contains("open")) {
        closeSidebar();
        menuButton.focus();
      }
    });
    mobile.addEventListener("change", closeSidebar);
  }

  function showPage(pageName) {
    closeSidebar();
    if (!pageMeta[pageName]) pageName = "dashboard";
    currentPage = pageName;
    $$(".page").forEach((page) => page.classList.toggle("active", page.id === `page-${pageName}`));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === pageName));
    $("#pageTitle").textContent = pageMeta[pageName][0];
    $("#pageSubtitle").textContent = pageMeta[pageName][1];
    renderPage(pageName);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderPage(pageName = currentPage) {
    const renderers = {
      dashboard: renderDashboard,
      sale: renderSale,
      inventory: renderInventory,
      product: () => {},
      sales: renderSales,
      count: renderCounts,
      movements: renderMovements,
      backup: renderBackup,
      settings: renderSettings
    };
    renderers[pageName]?.();
  }

  function openActionDialog(options) {
    const dialog = $("#actionDialog");
    $("#dialogTitle").textContent = options.title || "אישור פעולה";
    $("#dialogDescription").textContent = options.description || "";
    $("#dialogValueField").classList.toggle("hidden", !options.valueLabel);
    $("#dialogReasonField").classList.toggle("hidden", !options.reasonLabel);
    $("#dialogValueField").firstChild.textContent = options.valueLabel || "כמות";
    $("#dialogReasonField").firstChild.textContent = options.reasonLabel || "סיבה";
    $("#dialogValue").value = options.defaultValue ?? "";
    $("#dialogValue").min = options.minimum ?? "";
    $("#dialogValue").step = options.step ?? 1;
    $("#dialogValue").type = options.valueType || "number";
    $("#dialogReason").value = options.defaultReason || "";
    $("#dialogReason").required = Boolean(options.requireReason);
    $("#dialogConfirm").textContent = options.confirmText || "אישור";
    $("#dialogConfirm").className = `button ${options.danger ? "ghost" : "primary"}`;
    if (options.danger) $("#dialogConfirm").style.color = "var(--danger)";
    else $("#dialogConfirm").style.color = "";
    dialog.showModal();
    setTimeout(() => (options.valueLabel ? $("#dialogValue") : options.reasonLabel ? $("#dialogReason") : $("#dialogConfirm")).focus(), 20);
    return new Promise((resolve) => { dialogResolver = resolve; });
  }

  function closeActionDialog(result) {
    if ($("#actionDialog").open) $("#actionDialog").close();
    dialogResolver?.(result);
    dialogResolver = null;
  }

  function renderDashboard() {
    const products = Core.activeProducts();
    const today = new Date().toDateString();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const todaySales = Core.data.sales.filter((sale) => sale.status === "COMPLETED" && new Date(sale.createdAt).toDateString() === today).reduce((sum, sale) => sum + sale.totalMinor, 0);
    const writeOffUnits = Core.data.movements.filter((movement) => movement.type === "WRITE_OFF" && movement.createdAt.startsWith(currentMonth)).reduce((sum, movement) => sum + Math.abs(movement.change), 0);
    const stats = [
      ["חלקים פעילים", products.length, "קטלוג זמין"],
      ["יחידות במלאי", products.reduce((sum, product) => sum + product.quantity, 0), "סך כל הכמויות"],
      ["מלאי נמוך", products.filter((product) => product.quantity <= product.minStock).length, "דורש בדיקה"],
      ["מכירות היום", formatMoney(todaySales), "עסקאות שהושלמו"],
      ["פחת החודש", writeOffUnits, "נזק או אובדן"]
    ];
    $("#stats").innerHTML = stats.map(([label, value, note]) => `<article class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`).join("");
    const lowStock = products.filter((product) => product.quantity <= product.minStock).sort((a, b) => a.quantity - b.quantity).slice(0, 5);
    $("#lowStockList").innerHTML = lowStock.length
      ? lowStock.map((product) => `<div class="compact-row"><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku)} · ${escapeHtml(product.location || "ללא מיקום")}</small></div><span class="stock-pill ${product.quantity <= 0 ? "out" : ""}">${product.quantity} ${escapeHtml(product.unit)}</span></div>`).join("")
      : `<div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>אין התראות מלאי</b><span>כל החלקים מעל רמת המינימום.</span></div>`;
    renderBackupBanner();
  }

  function categories() {
    return [...new Set(Core.activeProducts().map((product) => product.category.trim() || "ללא קטגוריה"))].sort((a, b) => a.localeCompare(b, "he"));
  }

  function renderSaleCategories() {
    const availableCategories = categories();
    if (selectedCategory !== "ALL" && !availableCategories.includes(selectedCategory)) selectedCategory = "ALL";
    $("#saleCategories").innerHTML = [
      `<button class="category-chip ${selectedCategory === "ALL" ? "active" : ""}" data-category="ALL">כל החלקים</button>`,
      ...availableCategories.map((category) => `<button class="category-chip ${selectedCategory === category ? "active" : ""}" data-category="${escapeHtml(category)}">${categorySymbol(category)} ${escapeHtml(category)}</button>`)
    ].join("");
  }

  function renderSale() {
    renderSaleCategories();
    const query = $("#saleSearch").value.trim().toLowerCase();
    const products = Core.activeProducts().filter((product) => {
      const category = product.category.trim() || "ללא קטגוריה";
      const inCategory = selectedCategory === "ALL" || category === selectedCategory;
      const matches = !query || [product.name, product.sku, product.barcode, product.category, product.notes].some((value) => String(value).toLowerCase().includes(query));
      return inCategory && matches;
    });
    $("#saleProducts").innerHTML = products.length
      ? products.map((product) => `<button class="product-card" data-add-product="${product.id}" ${product.quantity <= 0 && !Core.data.settings.allowNegativeStock ? "disabled" : ""}><span class="part-symbol">${categorySymbol(product.category)}</span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku)} · מלאי ${product.quantity}</small><span class="product-meta"><span class="category-label">${escapeHtml(product.category || "ללא קטגוריה")}</span><span class="product-price">${formatMoney(product.saleMinor)}</span></span></button>`).join("")
      : `<div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>לא נמצאו חלקים</b><span>נסה קטגוריה אחרת או שנה את החיפוש.</span></div>`;
    renderCart();
  }

  function renderCart() {
    let subtotal = 0;
    let totalUnits = 0;
    $("#cart").innerHTML = cart.length
      ? cart.map((line) => {
          subtotal += line.quantity * line.unitPriceMinor;
          totalUnits += line.quantity;
          return `<div class="cart-line"><span class="cart-line-name"><b>${escapeHtml(line.name)}</b><small>${escapeHtml(line.sku)}</small></span><input data-cart-quantity="${line.productId}" type="number" min="1" max="${line.available}" step="1" value="${line.quantity}" aria-label="כמות"><input data-cart-price="${line.productId}" type="number" min="0" step="0.01" value="${(line.unitPriceMinor / 100).toFixed(2)}" aria-label="מחיר"><button class="remove-line" data-remove-line="${line.productId}" aria-label="הסר">×</button></div>`;
        }).join("")
      : `<div class="cart-empty"><img src="assets/images/empty-parts.svg" alt=""><b>הסל עדיין ריק</b><span>בחר קטגוריה ולחץ על חלק כדי להוסיף.</span></div>`;
    let discount = 0;
    try { discount = Core.moneyToMinor($("#discount").value || 0); } catch { discount = 0; }
    $("#total").textContent = formatMoney(Math.max(0, subtotal - discount));
    $("#cartCount").textContent = totalUnits;
  }

  function filteredInventory() {
    const query = $("#inventorySearch").value.trim().toLowerCase();
    const filter = $("#stockFilter").value;
    return Core.activeProducts().filter((product) => {
      const matchesSearch = !query || [product.name, product.sku, product.barcode, product.category, product.location, product.notes].some((value) => String(value).toLowerCase().includes(query));
      const matchesStock = !filter || (filter === "in" && product.quantity > product.minStock) || (filter === "low" && product.quantity > 0 && product.quantity <= product.minStock) || (filter === "out" && product.quantity <= 0);
      return matchesSearch && matchesStock;
    });
  }

  function renderInventory() {
    const products = filteredInventory();
    $("#inventoryRows").innerHTML = products.length
      ? products.map((product) => {
          const stockClass = product.quantity <= 0 ? "out" : product.quantity <= product.minStock ? "low" : "";
          const stockText = product.quantity <= 0 ? "אזל" : product.quantity <= product.minStock ? "נמוך" : "במלאי";
          return `<tr><td class="product-cell"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.notes || "ללא הערה")}</small></td><td>${escapeHtml(product.sku)}</td><td>${escapeHtml(product.category || "ללא קטגוריה")}</td><td><span class="quantity-status ${stockClass}">${product.quantity} ${escapeHtml(product.unit)} · ${stockText}</span></td><td class="money">${formatMoney(product.saleMinor)}</td><td>${escapeHtml(product.location || "—")}</td><td><div class="row-actions"><button class="row-action" data-product-action="edit" data-id="${product.id}">עריכה</button><button class="row-action" data-product-action="restock" data-id="${product.id}">הוסף מלאי</button><button class="row-action" data-product-action="adjust" data-id="${product.id}">תיקון</button><button class="row-action danger" data-product-action="writeoff" data-id="${product.id}">פחת</button><button class="row-action danger" data-product-action="archive" data-id="${product.id}">ארכיון</button></div></td></tr>`;
        }).join("")
      : `<tr><td colspan="7"><div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>אין חלקים להצגה</b><span>שנה את החיפוש או הוסף חלק חדש.</span></div></td></tr>`;
  }

  function fillProductForm(product) {
    $("#productId").value = product.id;
    $("#productName").value = product.name;
    $("#productSku").value = product.sku;
    const categorySelect = $("#productCategory");
    categorySelect.querySelector("[data-custom-category]")?.remove();
    if (product.category && ![...categorySelect.options].some((option) => option.value === product.category)) {
      const legacyCategory = new Option(product.category, product.category);
      legacyCategory.dataset.customCategory = "true";
      categorySelect.add(legacyCategory);
    }
    categorySelect.value = product.category;
    $("#productBarcode").value = product.barcode;
    $("#productSale").value = (product.saleMinor / 100).toFixed(2);
    $("#productBuy").value = (product.purchaseMinor / 100).toFixed(2);
    $("#productQuantity").value = product.quantity;
    $("#productQuantity").disabled = true;
    $("#productMin").value = product.minStock;
    $("#productUnit").value = product.unit;
    $("#productLocation").value = product.location;
    $("#productNotes").value = product.notes;
    $("#productFormTitle").textContent = "עריכת חלק חילוף";
    $("#cancelProductEdit").classList.remove("hidden");
  }

  function resetProductForm() {
    $("#productForm").reset();
    $("#productCategory").querySelector("[data-custom-category]")?.remove();
    $("#productId").value = "";
    $("#productQuantity").disabled = false;
    $("#productQuantity").value = 0;
    $("#productMin").value = 0;
    $("#productUnit").value = "יחידה";
    $("#productFormTitle").textContent = "חלק חילוף חדש";
    $("#cancelProductEdit").classList.add("hidden");
  }

  function productFormData() {
    return {
      name: $("#productName").value,
      sku: $("#productSku").value,
      category: $("#productCategory").value,
      barcode: $("#productBarcode").value,
      salePrice: $("#productSale").value,
      purchasePrice: $("#productBuy").value,
      quantity: $("#productQuantity").value,
      minStock: $("#productMin").value,
      unit: $("#productUnit").value,
      location: $("#productLocation").value,
      notes: $("#productNotes").value
    };
  }

  function renderSales() {
    const query = $("#salesSearch").value.trim().toLowerCase();
    const sales = Core.data.sales.filter((sale) => !query || sale.number.toLowerCase().includes(query) || sale.items.some((item) => item.name.toLowerCase().includes(query)));
    $("#salesList").innerHTML = sales.length
      ? sales.map((sale) => `<article class="sale-record ${sale.status === "CANCELLED" ? "cancelled" : ""}"><div class="sale-record-head"><span class="sale-number">${escapeHtml(sale.number)}</span><span>${formatDate(sale.createdAt)}</span><span>${escapeHtml(sale.payment)}</span><span class="sale-status ${sale.status === "CANCELLED" ? "cancelled" : ""}">${sale.status === "CANCELLED" ? "בוטלה" : "הושלמה"}</span><span class="money">${formatMoney(sale.totalMinor)}</span>${sale.status === "COMPLETED" ? `<button class="row-action danger" data-cancel-sale="${sale.id}">ביטול מכירה</button>` : ""}</div><div class="sale-items">${sale.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity} — ${formatMoney(item.subtotalMinor)}`).join("<br>")}${sale.notes ? `<br><b>הערה:</b> ${escapeHtml(sale.notes)}` : ""}</div></article>`).join("")
      : `<div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>אין מכירות להצגה</b><span>מכירות חדשות יופיעו כאן.</span></div>`;
  }

  function renderCounts() {
    $("#countHistory").innerHTML = Core.data.counts.length
      ? Core.data.counts.map((count) => `<article class="history-card"><b>${escapeHtml(count.number)}</b><span>${formatDate(count.createdAt)}</span><span>${count.lines.length} חלקים · סך הפרש ${count.lines.reduce((sum, line) => sum + Math.abs(line.difference), 0)}</span></article>`).join("")
      : `<div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>אין ספירות קודמות</b></div>`;
  }

  function renderMovements() {
    $("#movementRows").innerHTML = Core.data.movements.length
      ? Core.data.movements.slice(0, 1500).map((movement) => `<tr><td>${formatDate(movement.createdAt)}</td><td>${escapeHtml(movement.productName)}</td><td>${movement.before}</td><td class="${movement.change < 0 ? "money" : ""}">${movement.change > 0 ? "+" : ""}${movement.change}</td><td>${movement.after}</td><td>${escapeHtml(movementNames[movement.type] || movement.type)}</td><td>${escapeHtml(movement.reason || "—")}</td></tr>`).join("")
      : `<tr><td colspan="7"><div class="empty-state"><img src="assets/images/empty-parts.svg" alt=""><b>אין תנועות מלאי</b></div></td></tr>`;
  }

  function renderBackup() {
    updateBackupUi(Backup.status());
  }

  function renderBackupBanner() {
    const status = Backup.status();
    const banner = $("#backupWarning");
    if (status.ready && !status.lastError) {
      banner.className = "system-banner ok";
      banner.innerHTML = `✓ הגיבוי מחובר לתיקייה <b>${escapeHtml(status.folderName)}</b>. שינויי המלאי נשמרים אוטומטית.`;
    } else {
      banner.className = "system-banner";
      banner.innerHTML = `⚠ ${status.lastError ? `שגיאת גיבוי: ${escapeHtml(status.lastError)}` : "תיקיית גיבוי אינה מחוברת. יש לבחור תיקייה קבועה לפני תחילת העבודה."}`;
    }
  }

  function updateBackupUi(status) {
    const sidebarStatus = $("#sidebarBackup");
    sidebarStatus.classList.toggle("connected", status.ready && !status.lastError);
    sidebarStatus.classList.toggle("error", Boolean(status.lastError));
    sidebarStatus.querySelector("b").textContent = status.lastError ? "שגיאת גיבוי" : status.ready ? "גיבוי מחובר" : "גיבוי לא מחובר";
    sidebarStatus.querySelector("small").textContent = status.lastError || (status.ready ? `${status.folderName} · ${status.lastBackup ? formatDate(status.lastBackup) : "ממתין לגיבוי"}` : "בחר תיקייה קבועה");
    $("#backupFolderInfo").textContent = status.lastError ? `שמירה מקומית פעילה; דורש בדיקה: ${status.lastError}` : status.ready ? `שמירה: ${status.folderName} · גיבוי אחרון: ${formatDate(status.lastBackup)}` : "לא ניתן להתחבר לתיקיית הנתונים";
    if ($("#phoneUrl")) $("#phoneUrl").textContent = status.phoneUrl || "לא נמצאה כתובת רשת";
    if (currentPage === "dashboard") renderBackupBanner();
  }

  function renderSettings() {
    const settings = Core.data.settings;
    $("#settingBusinessName").value = settings.businessName;
    $("#settingPhone").value = settings.phone;
    $("#settingAddress").value = settings.address;
    $("#settingCurrency").value = settings.currency;
    $("#settingAccent").value = settings.accent;
    $("#settingNegative").checked = settings.allowNegativeStock;
  }

  async function handleProductAction(button) {
    const product = Core.findProduct(button.dataset.id);
    const action = button.dataset.productAction;
    if (action === "edit") {
      fillProductForm(product);
      showPage("product");
      return;
    }
    if (action === "restock") {
      const result = await openActionDialog({ title: "הוספת מלאי", description: `${product.name} · מלאי נוכחי ${product.quantity}`, valueLabel: "כמות להוספה", reasonLabel: "הערה", minimum: 1, defaultValue: 1, defaultReason: "רכישת מלאי", confirmText: "הוסף למלאי" });
      if (!result) return;
      await Api.mutate("restock", [product.id, result.value, result.reason]);
      showToast("המלאי עודכן");
    }
    if (action === "adjust") {
      const result = await openActionDialog({ title: "תיקון כמות", description: `${product.name} · הכמות במערכת ${product.quantity}`, valueLabel: "הכמות המדויקת כעת", reasonLabel: "סיבת התיקון", minimum: 0, defaultValue: product.quantity, defaultReason: "ספירה ידנית", confirmText: "עדכן כמות" });
      if (!result) return;
      await Api.mutate("adjustStock", [product.id, result.value, result.reason]);
      showToast("הכמות תוקנה ונרשמה ביומן");
    }
    if (action === "writeoff") {
      const result = await openActionDialog({ title: "רישום פחת", description: `${product.name} · זמין ${product.quantity}`, valueLabel: "כמות פגומה / אבודה", reasonLabel: "סיבה חובה", minimum: 1, defaultValue: 1, requireReason: true, confirmText: "רשום פחת", danger: true });
      if (!result) return;
      await Api.mutate("writeOff", [product.id, result.value, result.reason]);
      showToast("הפחת נרשם והמלאי הופחת");
    }
    if (action === "archive") {
      const result = await openActionDialog({ title: "העברה לארכיון", description: `${product.name} יוסתר מהמלאי, אך היסטוריית המכירות תישמר.`, confirmText: "העבר לארכיון", danger: true });
      if (!result) return;
      await Api.mutate("archiveProduct", [product.id]);
      showToast("החלק הועבר לארכיון");
    }
  }

  function bindEvents() {
    $("#mainNav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (button) {
        closeSidebar();
        if (button.dataset.page === "product") resetProductForm();
        showPage(button.dataset.page);
      }
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-go]");
      if (button) {
        if (button.dataset.go === "product") resetProductForm();
        showPage(button.dataset.go);
      }
    });
    bindSidebarEvents();
    $("#themeToggle").addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      persistTheme(next);
    });
    $("#headerSettings").addEventListener("click", () => showPage("settings"));
    $("#openBackupFromSettings").addEventListener("click", () => showPage("backup"));
    $("#logoutButton").addEventListener("click", async () => {
      try { await Api.logout(); } catch (error) { showToast(error.message, true); }
    });

    $("#dialogForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const reason = $("#dialogReason").value.trim();
      if ($("#dialogReason").required && !reason) { showToast("חובה להזין סיבה", true); return; }
      closeActionDialog({ value: $("#dialogValue").value, reason });
    });
    $("#dialogCancel").addEventListener("click", () => closeActionDialog(null));
    $("#actionDialog").addEventListener("cancel", (event) => { event.preventDefault(); closeActionDialog(null); });

    $("#saleSearch").addEventListener("input", renderSale);
    $("#saleCategories").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      selectedCategory = button.dataset.category;
      renderSale();
    });
    $("#saleProducts").addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-product]");
      if (!button) return;
      const product = Core.findProduct(button.dataset.addProduct);
      const existing = cart.find((line) => line.productId === product.id);
      if (existing) {
        if (!Core.data.settings.allowNegativeStock && existing.quantity >= product.quantity) { showToast("אין מספיק מלאי", true); return; }
        existing.quantity += 1;
      } else {
        cart.push({ productId: product.id, name: product.name, sku: product.sku, available: product.quantity, quantity: 1, unitPriceMinor: product.saleMinor });
      }
      renderCart();
    });
    $("#cart").addEventListener("change", (event) => {
      const productId = Number(event.target.dataset.cartQuantity || event.target.dataset.cartPrice);
      const line = cart.find((item) => item.productId === productId);
      if (!line) return;
      try {
        if (event.target.dataset.cartQuantity) {
          const quantity = Number(event.target.value);
          if (!Number.isInteger(quantity) || quantity < 1 || (!Core.data.settings.allowNegativeStock && quantity > line.available)) throw new Error("כמות אינה תקינה או גדולה מהמלאי");
          line.quantity = quantity;
        } else {
          line.unitPriceMinor = Core.moneyToMinor(event.target.value);
        }
        renderCart();
      } catch (error) {
        showToast(error.message, true);
        renderCart();
      }
    });
    $("#cart").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-line]");
      if (!button) return;
      cart = cart.filter((line) => line.productId !== Number(button.dataset.removeLine));
      renderCart();
    });
    $("#discount").addEventListener("input", renderCart);
    $("#completeSale").addEventListener("click", async () => {
      const button = $("#completeSale");
      button.disabled = true;
      try {
        const sale = await Api.mutate("completeSale", [{ lines: cart, discount: $("#discount").value, payment: $("#payment").value, notes: $("#saleNote").value }]);
        cart = [];
        $("#discount").value = 0;
        $("#saleNote").value = "";
        renderSale();
        showToast(`המכירה ${sale.number} נשמרה — ${formatMoney(sale.totalMinor)}`);
      } catch (error) { showToast(error.message, true); }
      finally { button.disabled = false; }
    });

    $("#inventorySearch").addEventListener("input", renderInventory);
    $("#stockFilter").addEventListener("change", renderInventory);
    $("#inventoryRows").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-product-action]");
      if (!button) return;
      try { await handleProductAction(button); } catch (error) { showToast(error.message, true); }
    });

    $("#productForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        const id = Number($("#productId").value);
        if (id) await Api.mutate("updateProduct", [id, productFormData()]);
        else await Api.mutate("addProduct", [productFormData()]);
        resetProductForm();
        showToast(id ? "החלק עודכן" : "החלק נוסף למלאי");
        showPage("inventory");
      } catch (error) { showToast(error.message, true); }
      finally { if (button) button.disabled = false; }
    });
    $("#clearProductForm").addEventListener("click", resetProductForm);
    $("#cancelProductEdit").addEventListener("click", resetProductForm);

    $("#salesSearch").addEventListener("input", renderSales);
    $("#salesList").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-cancel-sale]");
      if (!button) return;
      const result = await openActionDialog({ title: "ביטול מכירה", description: "המלאי יוחזר והעסקה תישאר בהיסטוריה כמבוטלת.", reasonLabel: "סיבת הביטול", requireReason: true, confirmText: "בטל מכירה", danger: true });
      if (!result) return;
      try { await Api.mutate("cancelSale", [button.dataset.cancelSale, result.reason]); showToast("המכירה בוטלה והמלאי הוחזר"); } catch (error) { showToast(error.message, true); }
    });

    $("#startCount").addEventListener("click", () => {
      const products = Core.activeProducts();
      $("#countRows").innerHTML = products.length ? products.map((product) => `<div class="count-row"><b>${escapeHtml(product.name)} · ${escapeHtml(product.sku)}</b><span>במערכת: ${product.quantity}</span><input data-count-product="${product.id}" type="number" min="0" step="1" value="${product.quantity}" aria-label="כמות בפועל"></div>`).join("") : `<div class="empty-state"><b>אין חלקים לספירה</b></div>`;
      $("#saveCount").classList.toggle("hidden", products.length === 0);
    });
    $("#saveCount").addEventListener("click", async () => {
      const result = await openActionDialog({ title: "שמירת ספירת מלאי", description: "הכמויות במערכת יעודכנו לפי הספירה הפיזית ויישמר דוח.", confirmText: "שמור ועדכן" });
      if (!result) return;
      try {
        const lines = $$("[data-count-product]").map((input) => ({ productId: Number(input.dataset.countProduct), countedQuantity: Number(input.value) }));
        const count = await Api.mutate("createInventoryCount", [lines, $("#countNote").value]);
        downloadCountCsv(count);
        $("#countRows").innerHTML = "";
        $("#saveCount").classList.add("hidden");
        $("#countNote").value = "";
        renderCounts();
        showToast(`הספירה ${count.number} נשמרה`);
      } catch (error) { showToast(error.message, true); }
    });

    $("#chooseBackupFolder").addEventListener("click", async () => {
      try { await Backup.chooseFolder(); showToast("הגיבוי נבדק ונשמר בהצלחה"); } catch (error) { showToast(error.message, true); }
    });
    const manualBackup = async () => {
      try { await Backup.manualBackup(); showToast("הגיבוי נשמר בהצלחה"); } catch (error) { showToast(error.message, true); }
    };
    $("#backupNow").addEventListener("click", manualBackup);
    $("#headerBackup").addEventListener("click", manualBackup);
    $("#exportBackup").addEventListener("click", () => Backup.exportJson());
    $("#copyPhoneUrl").addEventListener("click", async () => {
      const value = $("#phoneUrl").textContent;
      try { await navigator.clipboard.writeText(value); showToast("כתובת הטלפון הועתקה"); }
      catch { showToast("לא ניתן להעתיק. לחץ לחיצה ארוכה על הכתובת.", true); }
    });
    $("#importBackup").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const result = await openActionDialog({ title: "שחזור גיבוי", description: "המידע הנוכחי יוחלף. קודם יירד למחשב עותק בטיחות.", confirmText: "שחזר קובץ", danger: true });
      if (!result) { event.target.value = ""; return; }
      try { await Backup.importJsonFile(file); applySettings(); renderPage(); showToast("השחזור הושלם"); } catch (error) { showToast(error.message, true); } finally { event.target.value = ""; }
    });
    $("#runDiagnostics").addEventListener("click", async () => {
      const tests = [...Core.diagnostics(), ...(await Backup.backupDiagnostics())];
      $("#diagnostics").innerHTML = tests.map((test) => `<div class="diagnostic ${test.ok ? "" : "fail"}"><i>${test.ok ? "✓" : "!"}</i><div><b>${escapeHtml(test.name)}</b><small>${escapeHtml(test.info || (test.ok ? "תקין" : "דורש טיפול"))}</small></div></div>`).join("");
      showToast(tests.every((test) => test.ok) ? "כל הבדיקות עברו בהצלחה" : "נמצאו סעיפים שדורשים טיפול", !tests.every((test) => test.ok));
    });

    $("#settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        await Api.mutate("saveSettings", [{ businessName: $("#settingBusinessName").value, phone: $("#settingPhone").value, address: $("#settingAddress").value, currency: $("#settingCurrency").value, accent: $("#settingAccent").value, theme: currentTheme(), allowNegativeStock: $("#settingNegative").checked }]);
        applySettings();
        showToast("ההגדרות נשמרו");
      } catch (error) { showToast(error.message, true); }
      finally { if (button) button.disabled = false; }
    });

    global.addEventListener("inventory:data-saved", () => renderPage());
    global.addEventListener("inventory:backup-status", (event) => updateBackupUi(event.detail));
    global.addEventListener("workshop:remote-update", () => {
      cart = [];
      applySettings();
      renderPage();
      showToast("הנתונים עודכנו ממכשיר אחר");
    });
    global.addEventListener("workshop:server-status", (event) => {
      if (!event.detail?.connected) {
        serverWasDisconnected = true;
        updateBackupUi({ ...Backup.status(), ready: false, lastError: "החיבור לענן נותק" });
      } else if (serverWasDisconnected) {
        serverWasDisconnected = false;
        Backup.refreshStatus().catch(() => {});
      }
    });
  }

  function updateClock() {
    $("#clock").textContent = new Intl.DateTimeFormat("he-IL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  async function start() {
    await Api.init();
    applySettings();
    bindEvents();
    await Backup.init();
    updateClock();
    setInterval(updateClock, 30000);
    renderDashboard();
    const reducedMotion = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const splash = $("#splash");
    const splashStatus = $("#splashStatus");
    if (reducedMotion) {
      setTimeout(() => splash.classList.add("done"), 100);
      return;
    }
    setTimeout(() => { splashStatus.textContent = "טוענים מלאי והיסטוריית מכירות…"; }, 470);
    setTimeout(() => {
      splashStatus.textContent = "המערכת מוכנה לעבודה";
      splash.classList.add("ready");
    }, 1120);
    setTimeout(() => splash.classList.add("done"), 1880);
  }

  start().catch((error) => {
    $("#splash").classList.add("done");
    showToast(`שגיאת הפעלה: ${error.message}`, true);
  });
})(window);
