const express = require('express');
const router = express.Router();
const dbManager = require('../db');
const fs = require('fs');
const path = require('path');

// 保存的连接配置文件
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'connections.json');

// 读取保存的连接
function loadSavedConnections() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

// 保存连接
function saveConnections(connections) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(connections, null, 2));
}

// 首页 - 连接页面
router.get('/', (req, res) => {
  const savedConnections = loadSavedConnections();
  res.render('index', {
    savedConnections,
    error: req.session.error || null,
    success: req.session.success || null
  });
  req.session.error = null;
  req.session.success = null;
});

// 获取已保存的连接列表
router.get('/saved-connections', (req, res) => {
  const savedConnections = loadSavedConnections();
  res.json(savedConnections);
});

// 删除保存的连接
router.post('/delete-connection', (req, res) => {
  const { id } = req.body;
  let savedConnections = loadSavedConnections();
  savedConnections = savedConnections.filter(c => c.id !== id);
  saveConnections(savedConnections);
  res.json({ success: true });
});

// 主工作区
router.get('/workspace', async (req, res) => {
  const conn = dbManager.getActiveConnection();
  if (!conn || !conn.connected) {
    return res.redirect('/');
  }

  try {
    const databases = await dbManager.getDatabases();
    const currentDb = conn.config.database || databases[0] || '';
    let tables = [];
    if (currentDb) {
      tables = await dbManager.getTables(currentDb);
    }

    res.render('workspace', {
      connection: conn,
      databases,
      currentDb,
      tables,
      error: null,
      success: null
    });
  } catch (err) {
    res.render('workspace', {
      connection: conn,
      databases: [],
      currentDb: '',
      tables: [],
      error: err.message,
      success: null
    });
  }
});

module.exports = router;
