// NexusGo - Electron ana surec (main process)
//
// Bu dosyadaki hicbir bilesen ucretli/kullanim-bazli bir servise baglanmaz:
//  - Ekran paylasimi: Electron'un yerlesik desktopCapturer API'si (ucretsiz)
//  - Dosya sec/kaydet: Electron'un yerlesik dialog API'si (ucretsiz)
//  - Uzaktan fare/klavye kontrolu: @nut-tree-fork/nut-js (MIT lisansli, ucretsiz npm paketi)

const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  Menu.setApplicationMenu(null); // File/Edit/View/Window/Help menusu son kullaniciya gerekmiyor

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'NexusGo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // desktopCapturer + dosya IPC icin preload'da node API'lerine ihtiyac var
    },
  });

  mainWindow.loadFile('index.html');

  // Renderer navigator.mediaDevices.getDisplayMedia() cagirdiginda burasi devreye girer.
  // useSystemPicker: true -> Windows 10/11'in kendi "ekran/pencere sec" penceresini gosterir.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: sources[0] });
      } catch (err) {
        console.error('Ekran kaynagi alinamadi:', err);
        callback({});
      }
    },
    { useSystemPicker: true }
  );
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Dosya GONDERME: kullanici dosya secer, renderer parca parca (chunk) okuyup
// WebRTC DataChannel uzerinden karsiya yollar.
// ---------------------------------------------------------------------------

ipcMain.handle('pick-file-to-send', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  return { path: filePath, name: path.basename(filePath), size: stat.size };
});

ipcMain.handle('read-file-chunk', (_e, { filePath, offset, length }) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
});

// ---------------------------------------------------------------------------
// Dosya ALMA: karsi taraftan gelen parcalari kullanicinin sectigi konuma yazar.
// ---------------------------------------------------------------------------

const incomingFiles = new Map(); // transferId -> { fd, filePath }

ipcMain.handle('start-receive-file', async (_e, { transferId, fileName }) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: fileName });
  if (result.canceled || !result.filePath) return null;
  const fd = fs.openSync(result.filePath, 'w');
  incomingFiles.set(transferId, { fd, filePath: result.filePath });
  return result.filePath;
});

ipcMain.handle('write-file-chunk', (_e, { transferId, chunk }) => {
  const entry = incomingFiles.get(transferId);
  if (!entry) return false;
  fs.writeSync(entry.fd, Buffer.from(chunk));
  return true;
});

ipcMain.handle('finish-receive-file', (_e, { transferId }) => {
  const entry = incomingFiles.get(transferId);
  if (!entry) return false;
  fs.closeSync(entry.fd);
  incomingFiles.delete(transferId);
  return entry.filePath;
});

ipcMain.handle('show-file-in-folder', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// Iletisim kartindaki WhatsApp/web sitesi/e-posta baglantilari sistemin
// varsayilan uygulamasinda acilsin diye (uygulama icinde degil).
ipcMain.handle('open-external', (_e, url) => {
  shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// Uzaktan kontrol: karsi taraftan gelen fare/klavye olaylarini bu bilgisayara
// enjekte eder (nut-js). Sadece "Uzaktan kontrole izin ver" isaretliyken
// renderer bu kanali kullanir; burasi da yalnizca cagrildiginda calisir.
// ---------------------------------------------------------------------------

let nutModule = null;
async function getNut() {
  if (!nutModule) {
    nutModule = await import('@nut-tree-fork/nut-js');
  }
  return nutModule;
}

const KEY_MAP = {
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', Space: 'Space',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Shift: 'LeftShift', Control: 'LeftControl', Alt: 'LeftAlt', Meta: 'LeftSuper',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

function resolveKey(Key, jsKey) {
  if (jsKey.length === 1) {
    const upper = jsKey.toUpperCase();
    if (/^[A-Z]$/.test(upper)) return Key[upper];
    if (/^[0-9]$/.test(upper)) return Key[`Num${upper}`];
  }
  const mapped = KEY_MAP[jsKey];
  return mapped ? Key[mapped] : undefined;
}

ipcMain.handle('remote-input', async (_e, evt) => {
  try {
    const { mouse, keyboard, screen, Point, Button, Key } = await getNut();
    switch (evt.type) {
      case 'mousemove': {
        const w = await screen.width();
        const h = await screen.height();
        await mouse.setPosition(new Point(Math.round(evt.x * w), Math.round(evt.y * h)));
        break;
      }
      case 'mousedown':
        await mouse.pressButton(evt.button === 2 ? Button.RIGHT : Button.LEFT);
        break;
      case 'mouseup':
        await mouse.releaseButton(evt.button === 2 ? Button.RIGHT : Button.LEFT);
        break;
      case 'wheel':
        if (evt.deltaY > 0) await mouse.scrollDown(Math.round(Math.abs(evt.deltaY)));
        else await mouse.scrollUp(Math.round(Math.abs(evt.deltaY)));
        break;
      case 'keydown': {
        const key = resolveKey(Key, evt.key);
        if (key !== undefined) await keyboard.pressKey(key);
        break;
      }
      case 'keyup': {
        const key = resolveKey(Key, evt.key);
        if (key !== undefined) await keyboard.releaseKey(key);
        break;
      }
    }
  } catch (err) {
    console.error('Uzaktan girdi enjeksiyon hatasi:', err.message);
  }
});
