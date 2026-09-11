import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const read = (relative) => fs.readFileSync(path.join(dist, relative), "utf8");

for (const page of ["index.html", "login.html"]) {
  const html = read(page);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${page}: duplicate IDs`);
  assert.match(html, /<html[^>]+lang="he"[^>]+dir="rtl"/);
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (target.startsWith("/") || target.startsWith("#")) continue;
    assert.ok(fs.existsSync(path.join(dist, target)), `${page}: missing ${target}`);
  }
}

for (const file of fs.readdirSync(path.join(dist, "js")).filter((name) => name.endsWith(".js"))) {
  new vm.Script(read(`js/${file}`), { filename: file });
}

const config = read("js/cloud-config.js");
assert.match(config, /https:\/\/[a-z0-9]+\.supabase\.co/);
assert.match(config, /sb_publishable_/);
assert.doesNotMatch(config, /service_role|sb_secret_/);

const index = read("index.html");
assert.match(index, /class="currency-input"[\s\S]*?>₪<[\s\S]*?id="discount"/);
assert.match(index, /<select id="productCategory">/);
assert.doesNotMatch(index, /id="productCategory"[^>]*\brequired\b/);
assert.doesNotMatch(index, /<datalist id="categoryOptions">/);
const categoryMarkup = index.match(/<select id="productCategory">([\s\S]*?)<\/select>/)?.[1] || "";
assert.ok((categoryMarkup.match(/<option/g) || []).length >= 35, "product category list should remain comprehensive");
assert.ok(index.indexOf("cloud-config.js") < index.indexOf("cloud-auth.js"));
assert.ok(index.indexOf("cloud-auth.js") < index.indexOf("server-api.js"));

const appCss = read("css/styles.css");
const loginCss = read("css/login.css");
assert.match(appCss, /@media \(max-width: 780px\)[\s\S]*?input, select, textarea \{ font-size: 16px; \}/);
assert.match(loginCss, /@media \(max-width: 900px\)[\s\S]*?#authForm input \{ font-size: 16px; \}/);

const core = read("js/core.js");
assert.doesNotMatch(core, /חובה לבחור קטגוריה/);

const sql = fs.readFileSync(path.join(root, "supabase", "SUPABASE_SETUP.sql"), "utf8");
assert.match(sql, /enable row level security/);
assert.match(sql, /owner_id = auth\.uid\(\)/);
assert.match(sql, /workshop_commit/);
assert.match(sql, /before_restore/);

console.log("Cloud static QA passed");
