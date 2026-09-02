"use strict";

(async function initializeLogin() {
  const Auth = window.WorkshopCloudAuth;
  const $ = (selector) => document.querySelector(selector);
  const form = $("#authForm");
  const errorBox = $("#authError");
  let signupMode = false;

  function showError(message = "") { errorBox.textContent = message; }
  function updateMode() {
    $("#formKicker").textContent = signupMode ? "הגדרה ראשונה" : "גישה מאובטחת";
    $("#formTitle").textContent = signupMode ? "יצירת חשבון" : "כניסה למערכת";
    $("#formDescription").textContent = signupMode ? "צור חשבון אחד והשתמש בו במחשב ובטלפון." : "היכנס עם אותו חשבון מהמחשב ומהטלפון.";
    $("#confirmLabel").classList.toggle("hidden", !signupMode);
    $("#confirmPassword").required = signupMode;
    $("#submitButton span").textContent = signupMode ? "צור חשבון" : "כניסה";
    $("#modeButton").textContent = signupMode ? "כבר יש חשבון? עבור לכניסה" : "אין חשבון? צור חשבון ראשון";
    showError();
  }
  function busy(value) {
    $("#submitButton").disabled = value;
    $("#modeButton").disabled = value;
    $("#submitButton span").textContent = value ? "נא להמתין…" : signupMode ? "צור חשבון" : "כניסה";
  }

  const existing = await Auth.getSession();
  if (existing?.access_token) { location.replace("/"); return; }

  $("#togglePassword").addEventListener("click", () => {
    const visible = $("#password").type === "text";
    $("#password").type = visible ? "password" : "text";
    $("#confirmPassword").type = visible ? "password" : "text";
    $("#togglePassword").textContent = visible ? "הצג" : "הסתר";
  });
  $("#modeButton").addEventListener("click", () => { signupMode = !signupMode; updateMode(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError();
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("יש להזין כתובת דואר תקינה.");
    if (password.length < 8) return showError("הסיסמה חייבת להכיל לפחות 8 תווים.");
    if (signupMode && password !== $("#confirmPassword").value) return showError("הסיסמאות אינן זהות.");
    busy(true);
    try {
      const result = signupMode ? await Auth.signUp(email, password) : await Auth.signIn(email, password);
      if (signupMode && !result.access_token) {
        signupMode = false;
        updateMode();
        showError("נשלח מייל אישור. אשר את הכתובת ולאחר מכן התחבר.");
        return;
      }
      location.replace("/");
    } catch (error) { showError(error.message || "הכניסה נכשלה"); }
    finally { busy(false); }
  });
})();
