"use strict";

(function initializeCloudApi(global) {
  const Core = global.InventoryCore;
  const Auth = global.WorkshopCloudAuth;
  const config = global.WorkshopCloudConfig;
  let revision = 0;
  let session = null;
  let inFlight = 0;
  let pollTimer = null;
  let mutationTail = Promise.resolve();
  let lastBackup = null;

  function emit(name, detail) { global.dispatchEvent(new CustomEvent(name, { detail })); }
  async function ensureSession() {
    session = await Auth.getSession();
    if (!session?.access_token || !session?.user?.id) {
      location.replace("/login.html");
      throw new Error("נדרשת כניסה מחדש");
    }
    return session;
  }
  async function supabase(path, options = {}) {
    await ensureSession();
    const response = await fetch(`${config.url}${path}`, {
      cache: "no-store",
      ...options,
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const body = await response.text();
    let payload = null;
    try { payload = body ? JSON.parse(body) : null; } catch { payload = { message: body }; }
    if (response.status === 401) {
      localStorage.removeItem("AutoPartsWorkshop.CloudSession.v1");
      location.replace("/login.html");
    }
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.hint || payload?.error || "שגיאת ענן");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  function installData(payload, remote = false) {
    if (!payload?.data) return;
    revision = Number(payload.revision) || revision;
    Core.replaceDatabase(payload.data, remote ? "cloud-refresh" : "cloud-response");
    if (remote) emit("workshop:remote-update", { revision });
  }
  async function fetchRow() {
    const rows = await supabase(`/rest/v1/workshop_states?owner_id=eq.${encodeURIComponent(session.user.id)}&select=revision,data,updated_at`);
    return rows?.[0] || null;
  }
  async function createInitialRow() {
    const rows = await supabase("/rest/v1/workshop_states", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: session.user.id, revision: 1, data: Core.data })
    });
    return rows?.[0];
  }
  async function init() {
    await ensureSession();
    let row;
    try { row = await fetchRow(); }
    catch (error) {
      if (/workshop_states|schema cache|relation/i.test(error.message)) throw new Error("מסד הנתונים עדיין לא הוגדר. יש להריץ את SUPABASE_SETUP.sql פעם אחת.");
      throw error;
    }
    if (!row) row = await createInitialRow();
    installData(row);
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, 4000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    emit("workshop:server-status", { connected: true, ...(await refreshSession()) });
    return session;
  }
  async function poll() {
    if (document.hidden || inFlight) return;
    try {
      const row = await fetchRow();
      if (row && Number(row.revision) !== revision) installData(row, true);
      emit("workshop:server-status", { connected: true });
    } catch (error) { emit("workshop:server-status", { connected: false, error: error.message }); }
  }
  async function commit(action, result, before) {
    try {
      const rows = await supabase("/rest/v1/rpc/workshop_commit", {
        method: "POST",
        body: JSON.stringify({ p_expected_revision: revision, p_data: Core.data, p_reason: action })
      });
      const next = Number(rows?.[0]?.new_revision || rows?.new_revision);
      if (!next) throw Object.assign(new Error("DATA_CHANGED"), { status: 409 });
      revision = next;
      return result;
    } catch (error) {
      const latest = await fetchRow().catch(() => null);
      if (latest && Number(latest.revision) !== revision) {
        installData(latest, true);
        throw new Error("הנתונים השתנו במכשיר אחר. המערכת עודכנה — נסה שוב.");
      }
      Core.replaceDatabase(before, "cloud-rollback");
      throw error;
    }
  }
  async function performMutation(action, args) {
    inFlight += 1;
    const before = structuredClone(Core.data);
    try {
      const method = Core[action];
      if (typeof method !== "function") throw new Error("פעולה לא מוכרת");
      return await commit(action, method(...args), before);
    } finally { inFlight -= 1; }
  }
  function mutate(action, args = []) {
    const operation = mutationTail.then(() => performMutation(action, args), () => performMutation(action, args));
    mutationTail = operation.catch(() => {});
    return operation;
  }
  async function manualBackup() {
    await supabase("/rest/v1/rpc/workshop_manual_backup", { method: "POST", body: "{}" });
    lastBackup = new Date().toISOString();
    return { ok: true, lastBackup, backupError: "", oneDriveEnabled: false };
  }
  async function restore(data) {
    inFlight += 1;
    try {
      const rows = await supabase("/rest/v1/rpc/workshop_restore", { method: "POST", body: JSON.stringify({ p_expected_revision: revision, p_data: data }) });
      const next = Number(rows?.[0]?.new_revision || rows?.new_revision);
      if (!next) throw new Error("השחזור נכשל בגלל שינוי ממכשיר אחר");
      installData({ revision: next, data });
      return { revision: next, data };
    } finally { inFlight -= 1; }
  }
  async function refreshSession() {
    await ensureSession();
    return { username: session.user.email, computerName: "SUPABASE CLOUD", dataRoot: "Supabase Cloud", phoneUrl: location.origin, lastBackup, backupError: "", oneDriveEnabled: false };
  }
  async function logout() { await Auth.signOut(); location.replace("/login.html"); }

  global.WorkshopServerApi = { init, poll, mutate, manualBackup, restore, refreshSession, logout, get session() { return session; }, get revision() { return revision; } };
})(window);
