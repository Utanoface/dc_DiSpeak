'use strict';
// デスクトップにショートカットアイコン追加
if (require('electron-squirrel-startup')) return;
// モジュールの読み込み
const {app, Menu, Tray, shell, BrowserWindow, dialog, ipcMain, autoUpdater} = require('electron');
const {execFile} = require('child_process');
const fs = require('fs');
const packageJson = require('./package.json');
const userData = app.getPath('userData'); // \AppData\Roaming\DiSpeak
// DiSpeakの設定ファイル
const appSetting = `${userData}\\setting.json`;
let appSettingObj = {};
// windowの設定ファイル
const winSetting = `${userData}\\window.json`;
let winSettingObj = (() => {
  const res = readFileSync(winSetting);
  if (res == null) return {};
  return res;
})();
// 変数の指定
const nowVersion = packageJson['version'];
const appName = app.getName();
let mainWindow = null; // メインウィンドウはGCされないようにグローバル宣言
let tray = null;
// 起動時にバージョンのチェックを行う
let updateFirst = true; // 初回の時のみtrue
let updateInterval = false; // 定期アップデートの時のみtrue
let updateDownloaded = false; // ダウンロード済みの場合true
autoUpdater.setFeedURL('https://prfac.com/dispeak/update');
autoUpdateCheck();
setInterval(() => {
  autoUpdateCheck('interval');
}, 1000 * 60 * 60);
function autoUpdateCheck(timing) {
  sendDebugLog('[autoUpdateCheck] timing', timing);
  sendDebugLog('[autoUpdateCheck] updateInterval', updateInterval);
  if (timing == 'interval') updateInterval = true;
  try { autoUpdater.checkForUpdates(); } catch(e) {} // batから起動したときの対策
}
autoUpdater.on("update-downloaded", () => {
  const mesOptions = {
    type: 'warning',
    buttons: ['する', 'あとで'],
    title: '再起動するっす？',
    message: '新しいバージョンをダウンロードしたっす！',
    detail: '再起動してインストールするっす？\nあとでを選んだときは終了時にインストールするっすよ。'
  };
  dialog.showMessageBox(mesOptions, (res) => {
    if (res == 0) {
      autoUpdater.quitAndInstall();
    } else {
      updateDownloaded = true;
    }
  });
  updateFirst = false;
  updateInterval = false;
});
autoUpdater.on("update-not-available", () => {
  sendDebugLog('[update-not-available] updateFirst', updateFirst);
  sendDebugLog('[update-not-available] updateInterval', updateInterval);
  if (updateFirst || updateInterval) {
    updateFirst = false;
    return;
  }
  // ダウンロードが合った場合（＝ダウンロード済み）
  else if (updateDownloaded) {
    const mesOptions = {
      type: 'warning',
      buttons: ['する', 'あとで'],
      title: '再起動するっす？',
      message: '新しいバージョンをダウンロードしたっす！',
      detail: '再起動してインストールするっす？\nあとでを選んだときは終了時にインストールするっすよ。'
    };
    dialog.showMessageBox(mesOptions, (res) => {
      if (res == 0) autoUpdater.quitAndInstall();
    });
  }
  // ダウンロードが無かった場合
  else {
    const mesOptions = {
      type: 'info',
      buttons: ['OK'],
      title: 'アップデートないっす！',
      message: 'おぉ…！！',
      detail: '最新のバージョンを使ってるっす。ありがとおぉおおぉっ！！'
    };
    dialog.showMessageBox(mesOptions);
  }
  updateInterval = false;
});
autoUpdater.on("error", (e) => {
  if (updateFirst || updateInterval) return;
  const mesOptions = {
    type: 'error',
    buttons: ['OK'],
    title: 'エラーが発生したっす…',
    message: '最新のバージョン取得に失敗しました。',
    detail: '時間を置いてからご確認ください。お願いします。'
  };
  dialog.showMessageBox(mesOptions);
  updateFirst = false;
  updateInterval = false;
  // エラーの送信
  const obj = {};
  obj.time = whatTimeIsIt(true);
  obj.version = nowVersion;
  obj.process = 'main';
  obj.message = e.message;
  obj.stack = e.stack;
  const jsn = JSON.stringify(obj);
  mainWindow.webContents.send('log-error', jsn);
});
// 多重起動を防ぐ
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
    }
  });
  // Electronの初期化完了後に実行
  app.on('ready', () => {
    createMainwindow(); // mainWindowの生成
  });
}
// 全てのウィンドウが閉じたら終了
app.on('window-all-closed', () => {
  if (process.platform != 'darwin') {
    app.quit();
  }
});
// ------------------------------
// 処理用の関数
// ------------------------------
// メインウィンドウの処理
function createMainwindow() {
  // タスクトレイを表示
  createTray();
  //ウィンドウサイズを設定する
  mainWindow = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true
    },
    frame: false,
    show: false,
    width: 960,
    height: 540,
    minWidth: 768,
    minHeight: 432,
    icon: `${__dirname}/images/icon.png`,
    backgroundColor: '#4a5459'
  });
  // ウィンドウの準備ができたら表示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  // ウィンドウメニューをカスタマイズ
  const template = mainWindowMenu();
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  // 使用するhtmlファイルを指定する
  mainWindow.loadURL(`file://${__dirname}/index.html`);
  // リンクをデフォルトブラウザで開く
  mainWindow.webContents.on('new-window', (ev, url) => {
    ev.preventDefault();
    shell.openExternal(url);
  });
  // winSettingObjに設定があれば処理する
  if (winSettingObj.bounds != null) {
    const bounds = winSettingObj.bounds;
    if (bounds) mainWindow.setBounds(bounds);
    if (winSettingObj.maximized) mainWindow.maximize();
    if (winSettingObj.minimized) mainWindow.minimize();
  }
  // ウィンドウが閉じる時
  mainWindow.on('close', () => {
    let ary = {};
    const isMaximized = mainWindow.isMaximized(); // true, false
    const isMinimized = mainWindow.isMinimized();
    const bounds = mainWindow.getBounds(); // {x:0, y:0, width:0, height:0}
    ary.maximized = isMaximized;
    ary.minimized = isMinimized;
    if (isMaximized) {
      ary.bounds = winSettingObj.bounds; // 最大化してるときは変更しない
    } else {
      ary.bounds = bounds;
    }
    const close = objectCheck(appSettingObj, 'dispeak.window');
    if (close) writeFileSync(winSetting, ary);
  });
  // ウィンドウが閉じられたらアプリも終了
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}
// タスクトレイ
function createTray() {
  tray = new Tray(`${__dirname}/images/icon.png`);
  const template = taskTrayMenu();
  const menu = Menu.buildFromTemplate(template)
  tray.setContextMenu(menu);
  tray.setToolTip(`${appName} v${nowVersion}`);
  tray.on('click', () => {
    mainWindow.show();
  });
}
// ファイルの読み込み
function readFileSync(target) {
  let res = {};
  try {
    const data = fs.readFileSync(target, 'utf8');
    const ary = JSON.parse(data);
    Object.assign(res, ary);
  } catch (err) {
    return null;
  }
  return res;
}
// ファイルの書き込み
function writeFileSync(target, data) {
  const json = JSON.stringify(data, null, 2);
  try {
    fs.writeFileSync(target, json, 'utf8');
  } catch (err) {
    return err.code;
  }
  return true;
}
// 連想配列にアクセス
function objectCheck(obj, path) {
  if (!(obj instanceof Object)) return null;
  if (/\./.test(path)) {
    path = path.split('.');
  } else {
    path = [path];
  }
  let cursor = obj;
  for (let i = 0; i < path.length; i++) {
    if (cursor[path[i]] == null) return null; // 見つからないときはnullを
    cursor = cursor[path[i]]; // 見つかったときはその情報を返す
  }
  return cursor;
}
// 現在の時刻を取得
function whatTimeIsIt(iso) {
  const time = new Date();
  const year = time.getFullYear();
  const month = zeroPadding(time.getMonth() + 1);
  const day = zeroPadding(time.getDate());
  const hours = zeroPadding(time.getHours());
  const minutes = zeroPadding(time.getMinutes());
  const seconds = zeroPadding(time.getSeconds());
  const text = (() => {
    if (iso == null) return `${year}/${month}/${day} ${hours}:${minutes}`;
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+0900`;
  })();
  return text;
}
// ゼロパディング
function zeroPadding(num) {
  const str = String(num);
  const txt = (() => {
    if (str.length == 1) return `0${str}`;
    return str;
  })();
  return txt;
}
// ------------------------------
// レンダラープロセスとのやりとり
// ------------------------------
// 現在のバージョンを返す
ipcMain.on('now-version-check', (event) => {
  event.returnValue = nowVersion;
});
// 設定ファイルを返す
ipcMain.on('setting-file-read', (event) => {
  appSettingObj = readFileSync(appSetting);
  event.returnValue = appSettingObj;
});
// 設定ファイルを保存する
ipcMain.on('setting-file-write', (event, data) => {
  appSettingObj = data;
  event.returnValue = writeFileSync(appSetting, data);
});
// UIの挙動
ipcMain.on('window-minimize', () => {
  mainWindow.minimize();
});
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (objectCheck(appSettingObj, 'dispeak.close') == null) {
    mainWindow.close();
  } else if (objectCheck(appSettingObj, 'dispeak.close')) {
    mainWindow.close();
  } else {
    mainWindow.hide();
  }
});
// 棒読みちゃんのディレクトリ
ipcMain.on('bouyomi-dir-dialog', (event) => {
  const options = {
    title: '選択',
    filters: [{
      name: 'EXE File',
      extensions: ['exe']
    }],
    defaultPath: '.',
    properties: ['openFile'],
  };
  dialog.showOpenDialog(options, (filePaths) => {
    const filePath = (() => {
      if (filePaths == void 0) return '';
      return filePaths[0];
    })();
    event.returnValue = filePath;
  });
});
ipcMain.on('bouyomi-exe-start', (event, data) => {
  const child = execFile(data, (error, stdout, stderr) => {});
  const res = (() => {
    if (child.pid == null) return false;
    return true;
  })();
  event.returnValue = res;
});
// バージョンチェック
ipcMain.on('version-check', () => {
  updateInterval = false;
  autoUpdateCheck();
});
// ログアウト処理
ipcMain.on('logout-process', () => {
  fs.unlink(appSetting, function (e) {
    if (e) {
      const obj = {};
      obj.time = whatTimeIsIt(true);
      obj.version = nowVersion;
      obj.process = 'main';
      obj.message = e.message;
      obj.stack = e.stack;
      const jsn = JSON.stringify(obj);
      mainWindow.webContents.send('log-error', jsn);
    } else {
      mainWindow.reload();
    }
  });
});
// ------------------------------
// その他
// ------------------------------
// エラーの処理
process.on('uncaughtException', (e) => {
  const obj = {};
  obj.time = whatTimeIsIt(true);
  obj.version = nowVersion;
  obj.process = 'main';
  obj.message = e.message;
  obj.stack = e.stack;
  const jsn = JSON.stringify(obj);
  mainWindow.webContents.send('log-error', jsn);
});
// ログ
function sendDebugLog(title, data) {
  if (mainWindow != null) mainWindow.webContents.send('log-debug', title, data);
}
// ウィンドウメニューをカスタマイズ
function mainWindowMenu() {
  const template = [{
    label: 'メニュー',
    submenu: [
      {
        label: 'Wikiを開く',
        accelerator: 'F1',
        click: () => {shell.openExternal('https://github.com/micelle/dc_DiSpeak/wiki')}
      },
      {
        label: 'リロード',
        accelerator: 'CmdOrCtrl+R',
        click: () => {mainWindow.reload()}
      },
      {
        label: '最新のバージョンを確認',
        accelerator: 'CmdOrCtrl+H',
        click:  () => {autoUpdateCheck()}
      },
      {
        label: 'ウィンドウを閉じる',
        accelerator: 'CmdOrCtrl+W',
        click:  () => {mainWindow.hide()}
      },
      {
        label: '終了する',
        accelerator: 'CmdOrCtrl+Shift+Q',
        click:  () => {mainWindow.close()}
      },
      {
        label: 'デバッグ',
        accelerator: 'CmdOrCtrl+Shift+I',
        click:  () => {mainWindow.toggleDevTools()}
      },
      {
        label: 'エラー',
        accelerator: 'CmdOrCtrl+Shift+E',
        click:  () => {if (objectCheck(appSettingObj, 'dispeak.debug')) console.log(this_variable_is_error)}
      }
    ]
  }];
  return template;
}

function taskTrayMenu() {
  const template = [
    {
      label: '表示する',
      click: () => {mainWindow.show()}
    },
    {
      label: 'サイズを元に戻す',
      click: () => {mainWindow.setSize(960, 540), mainWindow.center()}
    },
    {
      type: "separator"
    },
    {
      label: 'Wikiを開く',
      click: () => {shell.openExternal('https://github.com/micelle/dc_DiSpeak/wiki')}
    },
    {
      type: "separator"
    },
    {
      label: 'Roamingを開く',
      click: () => {shell.openExternal(process.env.APPDATA + '\\DiSpeak')}
    },
    {
      label: 'Localを開く',
      click: () => {shell.openExternal(process.env.LOCALAPPDATA + '\\DiSpeak')}
    },
    {
      type: "separator"
    },
    {
      label: '終了する',
      click: () => {mainWindow.close()}
    }
  ];
  return template;
}