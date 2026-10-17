import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, "web"), output, { recursive: true });
await cp(path.join(root, "customer"), path.join(output, "customer"), { recursive: true });
console.log("Static cloud application built in dist/");
