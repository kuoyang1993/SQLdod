const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4888;

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 中间件
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'sqldod-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// 视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 路由
const indexRoutes = require('./routes/index');
const connectionRoutes = require('./routes/connection');
const databaseRoutes = require('./routes/database');
const tableRoutes = require('./routes/table');
const dataRoutes = require('./routes/data');
const queryRoutes = require('./routes/query');
const importExportRoutes = require('./routes/importExport');

app.use('/', indexRoutes);
app.use('/connection', connectionRoutes);
app.use('/database', databaseRoutes);
app.use('/table', tableRoutes);
app.use('/data', dataRoutes);
app.use('/query', queryRoutes);
app.use('/import-export', importExportRoutes);

// 启动服务器
const server = app.listen(PORT, () => {
  const addr = server.address();
  console.log(`SQLdod 数据库管理工具已启动: http://localhost:${addr.port}`);
  console.log('按 Ctrl+C 停止服务器');
  // 写入端口文件
  fs.writeFileSync(path.join(__dirname, 'data', 'port.txt'), String(addr.port));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // 自动尝试下一个端口
    const nextPort = parseInt(PORT) + Math.floor(Math.random() * 1000) + 1;
    console.log(`端口 ${PORT} 已被占用，尝试端口 ${nextPort}...`);
    server.listen(nextPort);
  } else {
    console.error('服务器启动失败:', err.message);
    process.exit(1);
  }
});
