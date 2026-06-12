import { app, BrowserWindow } from "electron";
import { startServer } from "../server.mjs";

let mainWindow = null;
let serverHandle = null;

app.whenReady().then(async () => {
  serverHandle = await startServer({ port: 0 });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "ZTE U50S 调试后台",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(serverHandle.url);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("window-all-closed", () => {
  if (serverHandle) serverHandle.close();
  app.quit();
});
