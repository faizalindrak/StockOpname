import fs from "fs";
import { execSync } from "child_process";

const orig = fs.existsSync("scripts/AdminDashboard.orig.jsx")
  ? fs.readFileSync("scripts/AdminDashboard.orig.jsx", "utf8")
  : execSync("git show HEAD:src/components/AdminDashboard.jsx", { encoding: "utf8" });
const lines = orig.split(/\r?\n/);

const blocks = [
  { name: "SessionsManager", start: 411, end: 751, out: "admin/SessionsManager.jsx", imports: [
    "import SessionEditor from './modals/SessionEditor.jsx';",
    "import UserAssignmentModal from './modals/UserAssignmentModal.jsx';",
    "import ItemSelectionModal from './modals/ItemSelectionModal.jsx';",
  ]},
  { name: "ItemGroupsManager", start: 752, end: 941, out: "admin/ItemGroupsManager.jsx", imports: [
    "import ItemGroupEditor from './modals/ItemGroupEditor.jsx';",
    "import GroupItemsModal from './modals/GroupItemsModal.jsx';",
  ]},
  { name: "ItemsManager", start: 942, end: 1839, out: "admin/ItemsManager.jsx", imports: [
    "import ItemEditor from './modals/ItemEditor.jsx';",
  ]},
  { name: "UsersManager", start: 1840, end: 1971, out: "admin/UsersManager.jsx", imports: [
    "import UserEditor from './modals/UserEditor.jsx';",
  ]},
  { name: "CategoriesManager", start: 1972, end: 2268, out: "admin/CategoriesManager.jsx", imports: [
    "import CategoryEditor from './modals/CategoryEditor.jsx';",
    "import LocationEditor from './modals/LocationEditor.jsx';",
    "import CategoryForm from './forms/CategoryForm.jsx';",
    "import LocationForm from './forms/LocationForm.jsx';",
  ]},
  { name: "CategoryForm", start: 2269, end: 2301, out: "admin/forms/CategoryForm.jsx", imports: [] },
  { name: "LocationForm", start: 2302, end: 2348, out: "admin/forms/LocationForm.jsx", imports: [] },
  { name: "UserAssignmentModal", start: 2349, end: 2531, out: "admin/modals/UserAssignmentModal.jsx", imports: [] },
  { name: "ItemSelectionModal", start: 2532, end: 3190, out: "admin/modals/ItemSelectionModal.jsx", imports: [] },
  { name: "ItemGroupEditor", start: 3191, end: 3325, out: "admin/modals/ItemGroupEditor.jsx", imports: [] },
  { name: "GroupItemsModal", start: 3326, end: 3777, out: "admin/modals/GroupItemsModal.jsx", imports: [] },
  { name: "SessionEditor", start: 3778, end: 4195, out: "admin/modals/SessionEditor.jsx", imports: [] },
  { name: "ItemEditor", start: 4196, end: 4398, out: "admin/modals/ItemEditor.jsx", imports: [] },
  { name: "UserEditor", start: 4399, end: 4557, out: "admin/modals/UserEditor.jsx", imports: [] },
  { name: "CategoryEditor", start: 4558, end: 4660, out: "admin/modals/CategoryEditor.jsx", imports: [] },
  { name: "LocationEditor", start: 4661, end: 4767, out: "admin/modals/LocationEditor.jsx", imports: [] },
];

function baseImportsFor(out) {
  const depth = out.split("/").length - 1;
  const root = depth === 1 ? "../.." : "../../..";
  return `import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '${root}/contexts/AuthContext';
import {
  Package, Users, Building, ClipboardList, Plus, Search, Edit, Trash2, Save, X,
  ChevronDown, AlertCircle, Calendar, Clock, UserPlus, UserMinus, Download,
  CheckCircle, Tag, Hash, Code, Folder, Layers
} from 'lucide-react';
import { supabase, checkCategoryUsage, checkLocationUsage, softDeleteLocation, reactivateLocation } from '${root}/lib/supabase';
import * as XLSX from 'xlsx';
`;
}

for (const b of blocks) {
  const body = lines.slice(b.start, b.end + 1).join("\n");
  const extra = b.imports.length ? b.imports.join("\n") + "\n" : "";
  const full = `${baseImportsFor(b.out)}${extra}${body}\n\nexport default ${b.name};\n`;
  const dir = "src/components/" + b.out.split("/").slice(0, -1).join("/");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync("src/components/" + b.out, full);
}

const shellLines = lines.slice(0, 409);
const shell = shellLines.join("\n") + `
import SessionsManager from './admin/SessionsManager.jsx';
import ItemGroupsManager from './admin/ItemGroupsManager.jsx';
import ItemsManager from './admin/ItemsManager.jsx';
import UsersManager from './admin/UsersManager.jsx';
import CategoriesManager from './admin/CategoriesManager.jsx';

export default React.memo(AdminDashboard);
`;
fs.writeFileSync("src/components/AdminDashboard.jsx", shell);
console.log("split complete");