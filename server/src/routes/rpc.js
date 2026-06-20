import { Hono } from "hono";
import { handleRpc } from "./rest.js";

const router = new Hono();

router.post("/:fn", (c) => handleRpc(c));

export default router;