import express from "express";
import os from "os";

import authApiRoute, { requireAuth } from "./routes/auth/api.js";
import memoryRoute from "./routes/widgets/memory.js";
import ssdRoute from "./routes/widgets/ssd.js";
import hddRoute from "./routes/widgets/hdd.js";
import tempRoute from "./routes/widgets/temp.js";
import cpuRoute from "./routes/widgets/cpu.js";
import uptimeRoute from "./routes/widgets/uptime.js";
import networkRoute from "./routes/widgets/network.js";

import actionsApiRoute from "./routes/actions/api.js";
import actionsIframeRoute from "./routes/actions/iframe.js";
const app = express();
app.use(express.json());

// Auth middleware applied before anything else
app.use("/", authApiRoute);
app.use(requireAuth);

app.use(express.static("public"));

app.use("/", actionsApiRoute);
app.use("/", actionsIframeRoute);
app.use("/", uptimeRoute);
app.use("/", networkRoute);
app.use("/", cpuRoute);
app.use("/", tempRoute);
app.use("/", hddRoute);
app.use("/", ssdRoute);
app.use("/", memoryRoute);

const PORT = 1913;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Running corely on http://0.0.0.0:${PORT}`);
});

server.ref();
