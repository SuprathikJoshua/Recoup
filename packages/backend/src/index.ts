import Fastify from "fastify";
import cors from "@fastify/cors";
import { apiRoutes } from "./api/routes.js";
import { prisma, pool } from "./config/db.js";

const server = Fastify({
  logger: true,
});

// Register CORS for Frontend Communication
await server.register(cors, {
  origin: [
    "http://localhost:5173",
    "https://recoup-frontend.vercel.app/",
  ],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
});

// Health check route
server.get("/health", async () => ({
  status: "ok",
  timestamp: new Date().toISOString(),
  service: "recoup-backend",
}));

// Register Core Recoup API Routes
await server.register(apiRoutes);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 Recoup API Server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown handling
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, closing server...`);
    await server.close();
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  });
}

start();
