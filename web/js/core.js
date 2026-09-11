"use strict";

(function initializeCore(global) {
  const STORAGE_KEY = "WorkshopInventoryOffline.v1";
  const CURRENT_VERSION = 1;
  const DEFAULT_SETTINGS = {
    businessName: "AutoParts Workshop",
    phone: "",
    address: "",
    currency: "ILS",
    accent: "orange",
    theme: "light",
    allowNegativeStock: false
  };

  let database = loadDatabase();

  function createEmptyDatabase() {
    return {
      version: CURRENT_VERSION,
      products: [],
      sales: [],
      movements: [],
      counts: [],
      settings: { ...DEFAULT_SETTINGS },
      seq: { product: 1, sale: 1, count: 1 },
      updatedAt: new Date().toISOString()
    };
  }

  function isValidShape(value) {
    return Boolean(
      value &&
      value.version === CURRENT_VERSION &&
      Array.isArray(value.products) &&
      Array.isArray(value.sales) &&
      Array.isArray(value.movements) &&
      Array.isArray(value.counts) &&
      value.seq
    );
  }

  function normalizeDatabase(value) {
    const db = value;
    db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    db.products = db.products.map((product) => ({
      ...product,
      active: product.active !== false,
      category: String(product.category || ""),
      location: String(product.location || ""),
      barcode: String(product.barcode || ""),
      notes: String(product.notes || ""),
      unit: String(product.unit || "יחידה"),
      quantity: Number.isInteger(product.quantity) ? product.quantity : Number(product.qty || 0),
      minStock: Number.isInteger(product.minStock) ? product.minStock : Number(product.min || 0),
      saleMinor: Number.isFinite(product.saleMinor) ? product.saleMinor : Number(product.sale || 0),
      purchaseMinor: Number.isFinite(product.purchaseMinor) ? product.purchaseMinor : Number(product.buy || 0)
    }));
    db.sales = db.sales.map((sale) => ({
      ...sale,
      discountMinor: Number.isFinite(sale.discountMinor) ? sale.discountMinor : Number(sale.discount || 0),
      totalMinor: Number.isFinite(sale.totalMinor) ? sale.totalMinor : Number(sale.total || 0),
      status: sale.status || "COMPLETED",
      payment: String(sale.payment || "מזומן"),
      notes: String(sale.notes || ""),
      items: Array.isArray(sale.items) ? sale.items.map((item) => ({
        ...item,
        productId: Number(item.productId),
        name: String(item.name || ""),
        sku: String(item.sku || ""),
        quantity: Number.isInteger(item.quantity) ? item.quantity : Number(item.qty || 0),
        unitPriceMinor: Number.isFinite(item.unitPriceMinor) ? item.unitPriceMinor : Number(item.price || 0),
        subtotalMinor: Number.isFinite(item.subtotalMinor) ? item.subtotalMinor : Number(item.subtotal || 0)
      })) : []
    }));
    db.movements = db.movements.map((movement) => ({
      ...movement,
      productName: String(movement.productName || movement.product || ""),
      reason: String(movement.reason || "")
    }));
    db.counts = db.counts.map((count) => ({
      ...count,
      lines: Array.isArray(count.lines) ? count.lines.map((line) => ({
        ...line,
        difference: Number.isFinite(line.difference) ? line.difference : Number(line.diff || 0)
      })) : []
    }));
    db.seq.product = nextSequence(db.seq.product, db.products);
    db.seq.sale = nextSequence(db.seq.sale, db.sales);
    db.seq.count = nextSequence(db.seq.count, db.counts);
    return db;
  }

  function nextSequence(current, rows) {
    return Math.max(Number(current) || 1, rows.reduce((max, row) => Math.max(max, (Number(row.id) || 0) + 1), 1));
  }

  function loadDatabase() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return isValidShape(parsed) ? normalizeDatabase(parsed) : createEmptyDatabase();
    } catch {
      return createEmptyDatabase();
    }
  }

  function save(reason = "change") {
    database.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    } catch {
      throw new Error("אין מקום לשמירת הנתונים בדפדפן. יש ליצור גיבוי ולפנות מקום.");
    }
    global.dispatchEvent(new CustomEvent("inventory:data-saved", { detail: { reason } }));
  }

  function replaceDatabase(value, reason = "restore") {
    if (!isValidShape(value)) throw new Error("קובץ הגיבוי אינו תקין");
    database = normalizeDatabase(structuredClone(value));
    save(reason);
  }

  function activeProducts() {
    return database.products.filter((product) => product.active);
  }

  function findProduct(productId, includeArchived = false) {
    const result = database.products.find((product) => product.id === Number(productId) && (includeArchived || product.active));
    if (!result) throw new Error("החלק לא נמצא");
    return result;
  }

  function moneyToMinor(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error("מחיר לא תקין");
    return Math.round((number + Number.EPSILON) * 100);
  }

  function validateInteger(value, message, minimum = 0) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum) throw new Error(message);
    return number;
  }

  function nextSku() {
    return `P-${String(database.seq.product).padStart(6, "0")}`;
  }

  function validateProductInput(input, editingId = null) {
    const name = String(input.name || "").trim();
    const category = String(input.category || "").trim();
    const sku = String(input.sku || "").trim() || nextSku();
    if (!name) throw new Error("חובה להזין שם חלק");
    if (database.products.some((product) => product.active && product.id !== editingId && product.sku.toLowerCase() === sku.toLowerCase())) {
      throw new Error("המק״ט כבר קיים במערכת");
    }
    return {
      name,
      sku,
      category,
      barcode: String(input.barcode || "").trim(),
      saleMinor: moneyToMinor(input.salePrice),
      purchaseMinor: moneyToMinor(input.purchasePrice || 0),
      quantity: validateInteger(input.quantity || 0, "כמות חייבת להיות מספר שלם"),
      minStock: validateInteger(input.minStock || 0, "מינימום מלאי חייב להיות מספר שלם"),
      unit: String(input.unit || "יחידה").trim() || "יחידה",
      location: String(input.location || "").trim(),
      notes: String(input.notes || "").trim()
    };
  }

  function addProduct(input) {
    const data = validateProductInput(input);
    const product = {
      id: database.seq.product++,
      ...data,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    database.products.push(product);
    if (product.quantity > 0) addMovement(product, 0, product.quantity, "INITIAL_STOCK", "מלאי התחלתי");
    save("product-add");
    return product;
  }

  function updateProduct(productId, input) {
    const product = findProduct(productId);
    const data = validateProductInput({ ...input, quantity: product.quantity }, product.id);
    Object.assign(product, data, { quantity: product.quantity, updatedAt: new Date().toISOString() });
    save("product-edit");
    return product;
  }

  function archiveProduct(productId) {
    const product = findProduct(productId);
    product.active = false;
    product.updatedAt = new Date().toISOString();
    save("product-archive");
  }

  function addMovement(product, before, change, type, reason = "", reference = null) {
    database.movements.unshift({
      id: global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      productId: product.id,
      productName: product.name,
      before,
      change,
      after: before + change,
      type,
      reason,
      reference,
      createdAt: new Date().toISOString()
    });
  }

  function restock(productId, amount, reason) {
    const product = findProduct(productId);
    const quantity = validateInteger(amount, "כמות ההוספה אינה תקינה", 1);
    const before = product.quantity;
    product.quantity += quantity;
    product.updatedAt = new Date().toISOString();
    addMovement(product, before, quantity, "RESTOCK", reason || "הוספת מלאי");
    save("restock");
  }

  function adjustStock(productId, exactQuantity, reason) {
    const product = findProduct(productId);
    const quantity = validateInteger(exactQuantity, "הכמות המדויקת אינה תקינה");
    const before = product.quantity;
    product.quantity = quantity;
    product.updatedAt = new Date().toISOString();
    addMovement(product, before, quantity - before, "MANUAL_ADJUSTMENT", reason || "תיקון ידני");
    save("stock-adjustment");
  }

  function writeOff(productId, amount, reason) {
    const product = findProduct(productId);
    const quantity = validateInteger(amount, "כמות הפחת אינה תקינה", 1);
    if (quantity > product.quantity) throw new Error("כמות הפחת גדולה מהמלאי הקיים");
    if (!String(reason || "").trim()) throw new Error("חובה לציין סיבת פחת");
    const before = product.quantity;
    product.quantity -= quantity;
    product.updatedAt = new Date().toISOString();
    addMovement(product, before, -quantity, "WRITE_OFF", String(reason).trim());
    save("write-off");
  }

  function completeSale(input) {
    if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error("סל המכירה ריק");
    const snapshot = structuredClone(database);
    try {
      const saleId = database.seq.sale++;
      const items = [];
      let subtotal = 0;
      for (const line of input.lines) {
        const product = findProduct(line.productId);
        const quantity = validateInteger(line.quantity, "כמות מכירה אינה תקינה", 1);
        const unitPriceMinor = Number(line.unitPriceMinor);
        if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) throw new Error("מחיר המכירה אינו תקין");
        if (!database.settings.allowNegativeStock && product.quantity < quantity) throw new Error(`אין מספיק מלאי עבור ${product.name}`);
        const before = product.quantity;
        product.quantity -= quantity;
        product.updatedAt = new Date().toISOString();
        addMovement(product, before, -quantity, "SALE", `S-${String(saleId).padStart(6, "0")}`, saleId);
        const itemSubtotal = unitPriceMinor * quantity;
        subtotal += itemSubtotal;
        items.push({ productId: product.id, name: product.name, sku: product.sku, quantity, unitPriceMinor, subtotalMinor: itemSubtotal });
      }
      const discountMinor = moneyToMinor(input.discount || 0);
      const sale = {
        id: saleId,
        number: `S-${String(saleId).padStart(6, "0")}`,
        items,
        discountMinor,
        totalMinor: Math.max(0, subtotal - discountMinor),
        payment: String(input.payment || "מזומן"),
        notes: String(input.notes || "").trim(),
        status: "COMPLETED",
        createdAt: new Date().toISOString()
      };
      database.sales.unshift(sale);
      save("sale");
      return sale;
    } catch (error) {
      database = snapshot;
      throw error;
    }
  }

  function cancelSale(saleId, reason) {
    const sale = database.sales.find((item) => item.id === Number(saleId));
    if (!sale) throw new Error("המכירה לא נמצאה");
    if (sale.status === "CANCELLED") throw new Error("המכירה כבר בוטלה");
    for (const item of sale.items) {
      const product = database.products.find((candidate) => candidate.id === item.productId);
      if (!product) continue;
      const before = product.quantity;
      product.quantity += item.quantity;
      product.updatedAt = new Date().toISOString();
      addMovement(product, before, item.quantity, "SALE_CANCELLATION", reason || `ביטול ${sale.number}`, sale.id);
    }
    sale.status = "CANCELLED";
    sale.cancelledAt = new Date().toISOString();
    sale.cancellationReason = String(reason || "").trim();
    save("sale-cancel");
  }

  function createInventoryCount(lines, notes) {
    if (!Array.isArray(lines) || lines.length === 0) throw new Error("אין שורות בספירה");
    const snapshot = structuredClone(database);
    try {
      const countId = database.seq.count++;
      const number = `C-${String(countId).padStart(6, "0")}`;
      const countLines = lines.map((line) => {
        const product = findProduct(line.productId);
        const counted = validateInteger(line.countedQuantity, "כמות בספירה אינה תקינה");
        const expected = product.quantity;
        const difference = counted - expected;
        if (difference !== 0) {
          product.quantity = counted;
          product.updatedAt = new Date().toISOString();
          addMovement(product, expected, difference, "INVENTORY_COUNT", number, countId);
        }
        return { productId: product.id, name: product.name, sku: product.sku, expected, counted, difference };
      });
      const count = { id: countId, number, notes: String(notes || "").trim(), lines: countLines, createdAt: new Date().toISOString() };
      database.counts.unshift(count);
      save("inventory-count");
      return count;
    } catch (error) {
      database = snapshot;
      throw error;
    }
  }

  function saveSettings(settings) {
    const businessName = String(settings.businessName || "").trim();
    if (!businessName) throw new Error("חובה להזין שם עסק");
    database.settings = {
      businessName,
      phone: String(settings.phone || "").trim(),
      address: String(settings.address || "").trim(),
      currency: ["ILS", "USD", "EUR"].includes(settings.currency) ? settings.currency : "ILS",
      accent: ["orange", "blue", "green"].includes(settings.accent) ? settings.accent : "orange",
      theme: ["light", "dark"].includes(settings.theme) ? settings.theme : "light",
      allowNegativeStock: Boolean(settings.allowNegativeStock)
    };
    save("settings");
  }

  function diagnostics() {
    const productIds = database.products.map((item) => item.id);
    const activeSkus = activeProducts().map((item) => item.sku.trim().toLowerCase()).filter(Boolean);
    return [
      { name: "מבנה בסיס הנתונים", ok: isValidShape(database), info: "גרסה 1" },
      { name: "מזהי חלקים ייחודיים", ok: new Set(productIds).size === productIds.length },
      { name: "מק״טים ייחודיים", ok: new Set(activeSkus).size === activeSkus.length },
      { name: "כמויות ומחירים", ok: database.products.every((item) => Number.isInteger(item.quantity) && item.quantity >= 0 && Number.isInteger(item.saleMinor) && item.saleMinor >= 0) },
      { name: "רשומות מכירה", ok: database.sales.every((sale) => Array.isArray(sale.items) && Number.isInteger(sale.totalMinor) && sale.totalMinor >= 0) }
    ];
  }

  global.InventoryCore = {
    STORAGE_KEY,
    get data() { return database; },
    save,
    replaceDatabase,
    isValidShape,
    activeProducts,
    findProduct,
    addProduct,
    updateProduct,
    archiveProduct,
    restock,
    adjustStock,
    writeOff,
    completeSale,
    cancelSale,
    createInventoryCount,
    saveSettings,
    diagnostics,
    moneyToMinor
  };
})(window);
