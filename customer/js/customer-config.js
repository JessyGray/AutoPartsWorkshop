"use strict";

// Shop details shown to customers. Edit these values, they are public.
// Prices are in agorot (5000 = ₪50). shopId comes from CUSTOMER_APP_SETUP.sql.
window.CustomerShopConfig = Object.freeze({
  url: "https://ifhialvnwhwdnnqrebjm.supabase.co",
  publishableKey: "sb_publishable_Tp5DpP-L14bUZxdcOFo2Zw_JpKr_DnT",
  shopId: "",
  shopName: "פנצ'רייה",
  phone: "",
  whatsapp: "",
  address: "",
  wazeQuery: "",
  hours: [
    { days: "א׳–ה׳", time: "08:00–19:00" },
    { days: "ו׳", time: "08:00–14:00" },
    { days: "שבת", time: "סגור" }
  ],
  slotMinutes: 30,
  dayStart: "08:00",
  dayEnd: "18:30",
  fridayEnd: "13:30",
  closedWeekdays: [6],
  tireCategory: "צמיגים וגלגלים",
  services: [
    { id: "puncture", priceMinor: 5000, from: false },
    { id: "replace", priceMinor: 4000, from: false, unit: "tire" },
    { id: "balance", priceMinor: 3000, from: false, unit: "wheel" },
    { id: "alignment", priceMinor: 15000, from: false },
    { id: "valve", priceMinor: 1500, from: false, unit: "wheel" },
    { id: "rim", priceMinor: 20000, from: true },
    { id: "rotation", priceMinor: 8000, from: false },
    { id: "pressure", priceMinor: 0, from: false }
  ]
});
