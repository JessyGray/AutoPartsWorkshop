"use strict";

(function applyStoredThemeBeforePaint() {
  try {
    const saved = localStorage.getItem("workshopTheme");
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", saved ? (saved === "dark" ? "dark" : "light") : (systemDark ? "dark" : "light"));
  } catch {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();
