import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist", "customer");
const read = (relative) => fs.readFileSync(path.join(dist, relative), "utf8");

const html = read("index.html");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "customer: duplicate IDs");
assert.match(html, /<html[^>]+lang="he"[^>]+dir="rtl"/);
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const target = match[1];
  if (target.startsWith("/") || target.startsWith("#")) continue;
  assert.ok(fs.existsSync(path.join(dist, target)), `customer: missing ${target}`);
}
assert.ok(html.indexOf("customer-config.js") < html.indexOf("i18n.js"));
assert.ok(html.indexOf("i18n.js") < html.indexOf("customer.js"));

const context = { window: {} };
vm.createContext(context);
for (const file of ["customer-config.js", "i18n.js"]) vm.runInContext(read(`js/${file}`), context, { filename: file });
new vm.Script(read("js/customer.js"), { filename: "customer.js" });

const config = context.window.CustomerShopConfig;
assert.match(config.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
assert.match(config.publishableKey, /^sb_publishable_/);
assert.doesNotMatch(read("js/customer-config.js"), /service_role|sb_secret_/);

// Every translation has the same keys and every service has a name.
const { STRINGS } = context.window.CustomerI18n;
const heKeys = Object.keys(STRINGS.he).sort();
for (const [lang, strings] of Object.entries(STRINGS)) {
  assert.deepEqual(Object.keys(strings).sort(), heKeys, `${lang}: keys differ from he`);
  for (const service of [...config.services.map((item) => item.id), "newTire"]) {
    assert.ok(strings.services[service], `${lang}: missing service ${service}`);
  }
}
for (const key of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
  assert.ok(key[1] in STRINGS.he, `customer: unknown i18n key ${key[1]}`);
}

const manifest = JSON.parse(read("manifest.webmanifest"));
for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(dist, icon.src)), `manifest: missing ${icon.src}`);

const sql = fs.readFileSync(path.join(root, "supabase", "CUSTOMER_APP_SETUP.sql"), "utf8");
assert.match(sql, /customer_requests enable row level security/);
assert.match(sql, /owner_id = auth\.uid\(\)/);
assert.match(sql, /grant execute on function public\.customer_catalog\(uuid, text\) to anon/);
assert.doesNotMatch(sql.match(/function public\.customer_catalog[\s\S]*?\$\$;/)[0], /purchaseMinor|notes|location/, "catalog must not expose private fields");

console.log("Customer static QA passed");
