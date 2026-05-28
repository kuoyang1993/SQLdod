const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'connections.json');

function loadSavedConnections() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveConnections(connections) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(connections, null, 2));
}

// 连接数据库
router.post('/connect', async (req, res) => {
  const { type, host, port, user, password, database, name, filePath, savePassword } = req.body;

  const connectionId = Date.now().toString();
  const config = {
    type,
    host: host || 'localhost',
    port: port || (type === 'mysql' ? 3306 : type === 'postgresql' ? 5432 : ''),
    user: user || '',
    password: password || '',
    database: database || '',
    filePath: filePath || '',
    name: name || host || 'SQLite'
  };

  try {
    dbManager.addConnection(connectionId, config);
    await dbManager.connect(connectionId);

    // 保存连接配置
    if (savePassword === 'true' || savePassword === true) {
      let savedConnections = loadSavedConnections();
      // 检查是否已存在相同配置
      const exists = savedConnections.findIndex(c =>
        c.type === type && c.host === host && c.port === port &&
        c.user === user && c.database === database
      );
      const saveData = {
        id: connectionId,
        type,
        host: host || '',
        port: port || '',
        user: user || '',
        password: password || '', // 保存密码
        database: database || '',
        filePath: filePath || '',
        name: name || host || 'SQLite',
        savedAt: new Date().toISOString()
      };
      if (exists >= 0) {
        savedConnections[exists] = saveData;
      } else {
        savedConnections.push(saveData);
      }
      saveConnections(savedConnections);
    }

    res.json({ success: true, connectionId });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 使用已保存的连接快速连接
router.post('/quick-connect', async (req, res) => {
  const { id } = req.body;
  const savedConnections = loadSavedConnections();
  const saved = savedConnections.find(c => c.id === id);

  if (!saved) {
    return res.json({ success: false, error: '连接配置未找到' });
  }

  const config = {
    type: saved.type,
    host: saved.host,
    port: saved.port,
    user: saved.user,
    password: saved.password,
    database: saved.database,
    filePath: saved.filePath,
    name: saved.name
  };

  try {
    dbManager.addConnection(saved.id, config);
    await dbManager.connect(saved.id);
    res.json({ success: true, connectionId: saved.id });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 断开连接
router.post('/disconnect', async (req, res) => {
  const conn = dbManager.getActiveConnection();
  if (conn) {
    await dbManager.disconnect(conn.id);
  }
  res.json({ success: true });
});

// 切换数据库
router.post('/switch-database', async (req, res) => {
  const { database } = req.body;
  try {
    await dbManager.switchDatabase(database);
    const tables = await dbManager.getTables(database);
    res.json({ success: true, tables });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
