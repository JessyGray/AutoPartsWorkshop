"use strict";

(function initializeCloudAuth(global) {
  const config = global.WorkshopCloudConfig;
  const STORAGE_KEY = "AutoPartsWorkshop.CloudSession.v1";

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
    catch { return null; }
  }
  function saveSession(session) {
    if (session?.access_token) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }
  async function authRequest(path, body, accessToken = "") {
    let response;
    try {
      response = await fetch(`${config.url}/auth/v1/${path}`, {
        method: "POST",
        headers: { apikey: config.publishableKey, "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body || {})
      });
    } catch {
      // The browser reports a down or paused Supabase project as a bare "Failed to fetch".
      throw new Error("השרת אינו זמין כרגע. בדוק את החיבור לאינטרנט ונסה שוב בעוד דקה.");
    }
    if (response.status >= 520) throw new Error("השרת אינו זמין כרגע. נסה שוב בעוד דקה.");
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.error_description || result.message || "שגיאת התחברות");
    return result;
  }
  function normalize(result) {
    return { ...result, expires_at_ms: Date.now() + Number(result.expires_in || 3600) * 1000 };
  }
  async function signIn(email, password) {
    const result = normalize(await authRequest("token?grant_type=password", { email, password }));
    saveSession(result);
    return result;
  }
  async function signUp(email, password) {
    const redirect = encodeURIComponent(`${location.origin}/login.html`);
    const result = await authRequest(`signup?redirect_to=${redirect}`, { email, password });
    if (result.access_token) saveSession(normalize(result));
    return result;
  }
  async function refresh() {
    const current = readSession();
    if (!current?.refresh_token) return null;
    try {
      const result = normalize(await authRequest("token?grant_type=refresh_token", { refresh_token: current.refresh_token }));
      saveSession(result);
      return result;
    } catch { saveSession(null); return null; }
  }
  async function getSession() {
    const current = readSession();
    if (!current?.access_token) return null;
    if (Number(current.expires_at_ms || 0) - Date.now() < 90000) return refresh();
    return current;
  }
  async function signOut() {
    const current = readSession();
    if (current?.access_token) {
      try { await authRequest("logout", {}, current.access_token); } catch { /* local sign-out still succeeds */ }
    }
    saveSession(null);
  }
  global.WorkshopCloudAuth = { signIn, signUp, signOut, getSession, refresh };
})(window);
