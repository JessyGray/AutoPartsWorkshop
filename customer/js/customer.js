"use strict";

(function initializeCustomerApp(global) {
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo");
  const config = demo && !global.CustomerShopConfig.phone
    ? { ...global.CustomerShopConfig, phone: "050-0000000", address: "Demo St 1, Haifa", wazeQuery: "Haifa" }
    : global.CustomerShopConfig;
  const { STRINGS, LANGS } = global.CustomerI18n;
  const LANG_KEY = "TireShop.Customer.Lang.v1";
  const TIME_ZONE = "Asia/Jerusalem";
  const DEMO_TIRES = [
    { id: 1, name: "Michelin Primacy 4 205/55R16", sku: "T-205-55-16", sale_minor: 42000, in_stock: true },
    { id: 2, name: "Bridgestone Turanza 195/65R15", sku: "T-195-65-15", sale_minor: 33000, in_stock: true },
    { id: 3, name: "Continental EcoContact 6 185/65R15", sku: "T-185-65-15", sale_minor: 31000, in_stock: false },
    { id: 4, name: "Pirelli Cinturato P7 225/45R17", sku: "T-225-45-17", sale_minor: 52000, in_stock: true }
  ];

  const $ = (id) => document.getElementById(id);
  const backendReady = Boolean(config.shopId && config.url && config.publishableKey);
  let lang = readLang();
  let tires = null;
  let tiresFailed = false;
  let lastRequestText = "";

  function readLang() {
    const fromUrl = params.get("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch { /* storage blocked */ }
    return "he";
  }

  function t(key) { return STRINGS[lang][key] ?? STRINGS.he[key] ?? key; }
  function serviceName(id) { return STRINGS[lang].services[id] || STRINGS.he.services[id] || id; }

  function money(minor) {
    return new Intl.NumberFormat(lang === "he" ? "he-IL" : lang, { style: "currency", currency: "ILS", maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  }

  function digits(value) { return String(value || "").replace(/\D/g, ""); }
  function intlPhone(value) {
    const d = digits(value);
    return d.startsWith("0") ? `972${d.slice(1)}` : d;
  }
  function waUrl(text) {
    const number = intlPhone(config.whatsapp || config.phone);
    const query = `text=${encodeURIComponent(text)}`;
    return number ? `https://wa.me/${number}?${query}` : `https://wa.me/?${query}`;
  }
  function normalizeSize(value) { return String(value || "").toLowerCase().replace(/[\s/\\\-.zr]/g, ""); }

  // Current weekday (0 = Sunday) and minutes since midnight in Israel.
  function israelNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).map((part) => [part.type, part.value]));
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
  }
  function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
  function toHHMM(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
  function dayRange(weekday) {
    if (config.closedWeekdays.includes(weekday)) return null;
    return { start: toMinutes(config.dayStart), end: toMinutes(weekday === 5 ? config.fridayEnd : config.dayEnd) };
  }
  function addDays(isoDate, days) {
    const date = new Date(`${isoDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  // Today if a slot is still free, otherwise the next open day.
  function firstBookableDay() {
    const now = israelNow();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays(now.date, offset);
      const range = dayRange(new Date(`${date}T12:00:00Z`).getUTCDay());
      if (range && (offset > 0 || now.minutes + 30 < range.end)) return date;
    }
    return now.date;
  }

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = t("dir");
    $("langSelect").value = lang;
    document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    renderStatic();
    renderServices();
    renderServiceOptions();
    renderTires();
    renderHours();
    renderTimes();
  }

  function renderStatic() {
    $("shopName").textContent = config.shopName;
    document.title = config.shopName;
    $("callLink").href = config.phone ? `tel:${digits(config.phone)}` : "#";
    $("callLink").hidden = !config.phone;
    $("waLink").href = waUrl(t("waIntro"));
    $("wazeLink").href = `https://waze.com/ul?q=${encodeURIComponent(config.wazeQuery || config.address || config.shopName)}&navigate=yes`;
    $("wazeLink").hidden = !(config.wazeQuery || config.address);
    $("flatLink").href = waUrl(t("waFlat"));
    $("askSizeLink").href = waUrl(`${t("waAsk")} `);
    $("addressText").textContent = config.address;
    const now = israelNow();
    const range = dayRange(now.weekday);
    const open = Boolean(range && now.minutes >= range.start && now.minutes < range.end + config.slotMinutes);
    $("openStatus").textContent = open ? t("openNow") : t("closedNow");
    $("openStatus").classList.toggle("is-open", open);
  }

  function renderServices() {
    const list = $("serviceList");
    list.replaceChildren(...config.services.map((service) => {
      const item = document.createElement("li");
      const unit = service.unit === "tire" ? ` ${t("perTire")}` : service.unit === "wheel" ? ` ${t("perWheel")}` : "";
      const price = service.priceMinor ? `${service.from ? t("from") : ""}${money(service.priceMinor)}${unit}` : t("free");
      item.innerHTML = `<div><strong></strong><span class="price"></span></div><button type="button" class="chip"></button>`;
      item.querySelector("strong").textContent = serviceName(service.id);
      item.querySelector(".price").textContent = price;
      const button = item.querySelector("button");
      button.textContent = t("bookThis");
      button.addEventListener("click", () => { $("fService").value = service.id; toggleTireSize(); showTab("book"); });
      return item;
    }));
  }

  function renderServiceOptions() {
    const select = $("fService");
    const previous = select.value;
    const ids = [...config.services.map((service) => service.id), "newTire"];
    select.replaceChildren(new Option("—", ""), ...ids.map((id) => new Option(serviceName(id), id)));
    select.value = previous;
    toggleTireSize();
  }

  function toggleTireSize() {
    $("tireSizeField").hidden = !["replace", "newTire", "puncture"].includes($("fService").value);
  }

  async function loadTires() {
    if (demo && !backendReady) { tires = DEMO_TIRES; renderTires(); return; }
    if (!backendReady) { tiresFailed = true; renderTires(); return; }
    try {
      const response = await fetch(`${config.url}/rest/v1/rpc/customer_catalog`, {
        method: "POST",
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_shop: config.shopId, p_category: config.tireCategory })
      });
      if (!response.ok) throw new Error(String(response.status));
      tires = await response.json();
    } catch {
      tiresFailed = true;
    }
    renderTires();
  }

  function renderTires() {
    const list = $("tireList");
    const status = $("tireStatus");
    if (!tires) {
      list.replaceChildren();
      status.textContent = tiresFailed ? t("tiresOffline") : t("tiresLoading");
      return;
    }
    const query = normalizeSize($("tireSearch").value);
    const matches = tires.filter((tire) => !query || normalizeSize(`${tire.name} ${tire.sku}`).includes(query));
    status.textContent = matches.length ? "" : t("tiresEmpty");
    list.replaceChildren(...matches.map((tire) => {
      const item = document.createElement("li");
      item.classList.toggle("is-out", !tire.in_stock);
      item.innerHTML = `<div><strong></strong><span class="stock"></span></div><div class="tire-side"><span class="price"></span><a class="chip" target="_blank" rel="noopener"></a></div>`;
      item.querySelector("strong").textContent = tire.name;
      item.querySelector(".stock").textContent = tire.in_stock ? t("inStock") : t("outOfStock");
      item.querySelector(".price").textContent = tire.sale_minor ? money(Number(tire.sale_minor)) : "";
      const link = item.querySelector("a");
      link.textContent = tire.in_stock ? t("reserve") : t("askSize");
      link.href = waUrl(`${t("waTire")}: ${tire.name}`);
      return item;
    }));
  }

  function renderHours() {
    $("hoursList").replaceChildren(...config.hours.flatMap((row) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = row.days;
      dd.textContent = row.time;
      return [dt, dd];
    }));
  }

  function renderTimes() {
    const select = $("fTime");
    const previous = select.value;
    const value = $("fDate").value;
    select.replaceChildren();
    if (!value) return;
    const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
    const range = dayRange(weekday);
    const now = israelNow();
    const slots = [];
    if (range) {
      for (let minutes = range.start; minutes <= range.end; minutes += config.slotMinutes) {
        if (value === now.date && minutes <= now.minutes + 30) continue;
        slots.push(toHHMM(minutes));
      }
    }
    if (!slots.length) select.append(new Option(t("errNoSlots"), ""));
    else select.append(...slots.map((slot) => new Option(slot, slot)));
    if (slots.includes(previous)) select.value = previous;
  }

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.tab === name)));
    document.querySelectorAll(".panel").forEach((panel) => { panel.hidden = panel.id !== `panel-${name}`; });
    if (name === "tires" && !tires && !tiresFailed) loadTires();
    document.querySelector(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showError(key) {
    $("formError").textContent = t(key);
    $("formError").hidden = false;
  }

  function buildRequestText(request) {
    return [
      t("waIntro"),
      `${t("name")}: ${request.name}`,
      `${t("phone")}: ${request.phone}`,
      `${t("service")}: ${serviceName(request.service)}`,
      request.tireSize && `${t("tireSize")}: ${request.tireSize}`,
      `${t("date")}: ${request.date} ${request.time}`,
      request.plate && `${t("plate")}: ${request.plate}`,
      request.notes && `${t("notes")}: ${request.notes}`
    ].filter(Boolean).join("\n");
  }

  async function submitRequest(event) {
    event.preventDefault();
    $("formError").hidden = true;
    const request = {
      name: $("fName").value.trim(),
      phone: $("fPhone").value.trim(),
      service: $("fService").value,
      tireSize: $("tireSizeField").hidden ? "" : $("fTireSize").value.trim(),
      date: $("fDate").value,
      time: $("fTime").value,
      plate: $("fPlate").value.trim(),
      notes: $("fNotes").value.trim()
    };
    if (request.name.length < 2 || !request.phone || !request.service || !request.date) return showError("errRequired");
    if (!/^[0-9+][0-9 -]{7,19}$/.test(request.phone)) return showError("errPhone");
    if (!request.time) return showError("errNoSlots");
    lastRequestText = buildRequestText(request);

    if (backendReady) {
      const button = $("submitButton");
      button.disabled = true;
      button.textContent = t("sending");
      try {
        const response = await fetch(`${config.url}/rest/v1/rpc/customer_submit_request`, {
          method: "POST",
          headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            p_shop: config.shopId, p_kind: request.service === "newTire" ? "tire" : "booking",
            p_name: request.name, p_phone: request.phone, p_plate: request.plate,
            p_service: serviceName(request.service), p_tire_size: request.tireSize,
            p_date: request.date, p_time: request.time, p_notes: request.notes, p_lang: lang
          })
        });
        if (!response.ok) {
          const body = await response.text();
          return showError(body.includes("TOO_MANY_REQUESTS") ? "errTooMany" : "errGeneric");
        }
      } catch {
        return showError("errGeneric");
      } finally {
        button.disabled = false;
        button.textContent = t("submit");
      }
    }
    $("doneWaLink").href = waUrl(lastRequestText);
    $("bookForm").hidden = true;
    $("bookDone").hidden = false;
  }

  function init() {
    const today = israelNow().date;
    $("fDate").min = today;
    $("fDate").max = addDays(today, 60);
    $("fDate").value = firstBookableDay();
    applyLanguage();
    $("langSelect").addEventListener("change", (event) => {
      lang = event.target.value;
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
      applyLanguage();
    });
    document.querySelectorAll("[data-tab]").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
    $("tireSearch").addEventListener("input", renderTires);
    $("fService").addEventListener("change", toggleTireSize);
    $("fDate").addEventListener("change", renderTimes);
    $("bookForm").addEventListener("submit", submitRequest);
    $("newRequest").addEventListener("click", () => {
      $("bookForm").reset();
      $("fDate").value = firstBookableDay();
      renderTimes();
      toggleTireSize();
      $("bookForm").hidden = false;
      $("bookDone").hidden = true;
    });
    const tab = params.get("tab");
    if (["services", "tires", "book", "info"].includes(tab)) showTab(tab);
  }

  init();
})(window);
