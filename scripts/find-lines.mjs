import { execSync } from "child_process";
import fs from "fs";

const orig = execSync("git show HEAD:src/components/AdminDashboard.jsx", { encoding: "utf8" });
fs.writeFileSync("scripts/AdminDashboard.orig.jsx", orig);
const lines = orig.split(/\r?\n/);
const names = [
  "SessionsManager", "ItemGroupsManager", "ItemsManager", "UsersManager", "CategoriesManager",
  "CategoryForm", "LocationForm", "UserAssignmentModal", "ItemSelectionModal",
  "ItemGroupEditor", "GroupItemsModal", "SessionEditor", "ItemEditor", "UserEditor",
  "CategoryEditor", "LocationEditor",
];
for (const n of names) {
  const i = lines.findIndex((l) => l.startsWith(`const ${n}`));
  console.log(n, i);
}