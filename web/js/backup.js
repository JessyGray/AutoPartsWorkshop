"use strict";

(function initializeCloudBackup(global) {
  const Core = global.InventoryCore;
  const Api = global.WorkshopServerApi;
  let current = { ready: false, lastError: "", folderName: "Supabase Cloud", lastBackup: null, phoneUrl: location.origin, oneDriveEnabled: false, dataRoot: "Supabase Cloud" };
  function emit() { global.dispatchEvent(new CustomEvent("inventory:backup-status", { detail: status() })); }
  function status() { return { ...current }; }
  async function refreshStatus() {
    try {
      const info = await Api.refreshSession();
      current = { ...current, ready: true, lastError: "", phoneUrl: info.phoneUrl, lastBackup: info.lastBackup || current.lastBackup };
    } catch (error) { current.ready = false; current.lastError = error.message; }
    emit();
    return status();
  }
  async function init() { await refreshStatus(); }
  async function chooseFolder() { return manualBackup(); }
  async function manualBackup() {
    const result = await Api.manualBackup();
    current = { ...current, ready: true, lastError: "", lastBackup: result.lastBackup };
    emit();
    return status();
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(Core.data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `WorkshopInventory_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function importJsonFile(file) {
    if (!file) throw new Error("לא נבחר קובץ");
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("קובץ JSON אינו תקין"); }
    const candidate = parsed?.data && Core.isValidShape(parsed.data) ? parsed.data : parsed;
    if (!Core.isValidShape(candidate)) throw new Error("קובץ הגיבוי אינו שייך למערכת זו");
    await Api.restore(candidate);
    await refreshStatus();
  }
  async function backupDiagnostics() {
    const info = await Api.refreshSession();
    return [
      { name: "חיבור לענן", ok: true, info: info.computerName },
      { name: "שמירה ראשית", ok: true, info: "Supabase Cloud" },
      { name: "כניסה מאובטחת", ok: Boolean(info.username), info: info.username },
      { name: "גישה מכל מכשיר", ok: location.protocol === "https:", info: location.origin }
    ];
  }
  global.InventoryBackup = { init, status, refreshStatus, chooseFolder, manualBackup, exportJson, importJsonFile, backupDiagnostics };
})(window);
