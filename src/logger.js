import { promises as fs } from "fs";
import path from "path";

export async function log(level = "INFO", message, workDir) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${level.toUpperCase()}] ${timestamp} - ${message}\n`;
  console.error(logMessage.trim());

  try {
    const logDir = path.join(workDir, "logs");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, "server.log");
    await fs.appendFile(logFile, logMessage);
  } catch (err) {
    console.error(`Failed to write to log file: ${err}`);
  }
}

export async function logOperation(toolName, operationId, status, details = {}, workDir) {
  const level = status === "ERROR" ? "ERROR" : "INFO";
  const detailsStr = Object.entries(details)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  const logMessage = `Operation ${operationId} [${toolName}] - ${status}${detailsStr ? " - " + detailsStr : ""}`;
  await log(level, logMessage, workDir);

  if (!global.operationUpdates[operationId]) {
    global.operationUpdates[operationId] = [];
  }
  global.operationUpdates[operationId].push({
    status,
    details,
    timestamp: new Date().toISOString(),
    message: logMessage,
  });

  if (global.operationUpdates[operationId].length > 100) {
    global.operationUpdates[operationId].shift();
  }
}