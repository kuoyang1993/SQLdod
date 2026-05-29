 // ==================== 数据库操作 ====================
let currentDatabase = currentDb;

// ==================== 树状导航 ====================
const SYS_DBS = ['information_schema', 'mysql', 'performance_schema', 'sys'];
let treeShowSysDb = false;
let treeDataCache = {}; // { dbName: [tableName, ...] }
let treeDbExpanded = {}; // { dbName: true/false }

// 系统库判断
function isSysDb(dbName) {
  return SYS_DBS.includes(dbName.toLowerCase());
}

// 数据库是否在树中可见
function isDbVisible(dbName) {
  if (treeShowSysDb) return true;
  return !isSysDb(dbName);
}

// 初始化树
async function initTree() {
  // 标记当前数据库为展开
  if (currentDatabase) {
    treeDbExpanded[currentDatabase] = true;
  }

  // 为当前数据库和展开的非系统库加载表
  try {
    const resp = await fetch('/database/all-with-tables');
    const result = await resp.json();
    if (result.success && result.databases) {
      result.databases.forEach(dbInfo => {
        treeDataCache[dbInfo.name] = dbInfo.tables || [];
        // 渲染该数据库下的表
        renderDbTables(dbInfo.name);
      });
    }
  } catch (err) {
    // 失败时手动加载当前库的表
    if (currentDatabase) {
      await loadDbTablesInTree(currentDatabase);
    }
  }

  // 初始应用系统库过滤
  applySysDbFilter();
}

// 应用系统库过滤
function applySysDbFilter() {
  document.querySelectorAll('.tree-node-db').forEach(node => {
    const dbName = node.id.replace('tree-db-', '');
    if (isDbVisible(dbName)) {
      node.style.display = '';
    } else {
      node.style.display = 'none';
    }
  });
}

// 切换系统库显示
function onToggleSysDb() {
  treeShowSysDb = document.getElementById('showSysDb').checked;
  applySysDbFilter();
}

// 切换连接根节点
function treeToggleNode(nodeId) {
  const children = document.getElementById(nodeId + '-children');
  const arrow = document.querySelector(`#${nodeId} > .tree-row .tree-arrow`);
  if (!children || !arrow) return;
  const isExpanded = children.classList.contains('expanded');
  if (isExpanded) {
    children.classList.remove('expanded');
    arrow.classList.remove('expanded');
  } else {
    children.classList.add('expanded');
    arrow.classList.add('expanded');
  }
}

// 切换数据库节点
async function treeToggleDb(dbName) {
  const nodeId = 'tree-db-' + dbName;
  const children = document.getElementById(nodeId + '-children');
  const arrow = document.querySelector(`#${nodeId} > .tree-row .tree-arrow`);
  if (!children || !arrow) return;

  const isExpanded = children.classList.contains('expanded');
  if (isExpanded) {
    children.classList.remove('expanded');
    arrow.classList.remove('expanded');
    treeDbExpanded[dbName] = false;
  } else {
    children.classList.add('expanded');
    arrow.classList.add('expanded');
    treeDbExpanded[dbName] = true;
    // 加载表数据
    await loadDbTablesInTree(dbName);
    // 选中数据库
    await selectDatabase(dbName);
  }
}

// 加载数据库下的表列表到树中
async function loadDbTablesInTree(dbName) {
  const children = document.getElementById('tree-db-' + dbName + '-children');
  if (!children) return;

  // 如果已缓存，直接渲染
  if (treeDataCache[dbName] && treeDataCache[dbName].length >= 0) {
    renderDbTables(dbName);
    return;
  }

  const loading = document.getElementById('tree-db-' + dbName + '-loading');
  if (loading) loading.style.display = '';

  try {
    const resp = await fetch(`/database/tables/${encodeURIComponent(dbName)}`);
    const result = await resp.json();
    if (result.success) {
      treeDataCache[dbName] = result.tables || [];
      renderDbTables(dbName);
    }
  } catch (err) {
    treeDataCache[dbName] = [];
    renderDbTables(dbName);
  }
}

// 渲染数据库下的表节点
function renderDbTables(dbName) {
  const children = document.getElementById('tree-db-' + dbName + '-children');
  if (!children) return;

  const tables = treeDataCache[dbName] || [];
  const loading = document.getElementById('tree-db-' + dbName + '-loading');
  if (loading) loading.remove();

  if (tables.length === 0) {
    children.innerHTML = '<div class="tree-empty">无数据表</div>';
    return;
  }

  children.innerHTML = tables.map(t => `
    <div class="tree-row tree-row-table" onclick="selectTableInTree('${dbName}', '${t}')" data-table="${t}" data-db="${dbName}">
      <span class="tree-arrow tree-arrow-leaf">▼</span>
      <span class="tree-icon tree-icon-table">📋</span>
      <span class="tree-label">${t}</span>
      <span class="tree-table-actions">
        <button class="tree-table-btn" onclick="event.stopPropagation(); designTableInTree('${dbName}', '${t}')" title="设计表">✏</button>
        <button class="tree-table-btn" onclick="event.stopPropagation(); showFKManagerInTree('${dbName}', '${t}')" title="外键">🔗</button>
        <button class="tree-table-btn" onclick="event.stopPropagation(); showTriggerManagerInTree('${dbName}', '${t}')" title="触发器">⚡</button>
        <button class="tree-table-btn tree-table-btn-danger" onclick="event.stopPropagation(); confirmDropTableInTree('${dbName}', '${t}')" title="删除表">🗑</button>
      </span>
    </div>
  `).join('');
}

// 树中选中表
async function selectTableInTree(dbName, tableName) {
  // 如果数据库不同，先切换
  if (currentDatabase !== dbName) {
    await selectDatabase(dbName);
  }
  // 高亮
  document.querySelectorAll('.tree-row-table').forEach(el => el.classList.remove('active'));
  const row = document.querySelector(`.tree-row-table[data-db="${dbName}"][data-table="${tableName}"]`);
  if (row) row.classList.add('active');
  // 选中表
  selectedTable = tableName;
  currentPage = 1;
  // 获取列信息
  try {
    const colResp = await fetch(`/data/columns/${tableName}?database=${encodeURIComponent(dbName)}`);
    const colResult = await colResp.json();
    if (colResult.success) {
      tableColumns = colResult.columns;
      const pkCol = tableColumns.find(c => c.Key === 'PRI');
      primaryKeyField = pkCol ? pkCol.Field : (tableColumns[0] ? tableColumns[0].Field : '');
    }
  } catch (err) {}
  await loadTableData(tableName);
}

// 树中设计表
function designTableInTree(dbName, tableName) {
  if (currentDatabase !== dbName) {
    selectDatabase(dbName).then(() => designTable(tableName));
  } else {
    designTable(tableName);
  }
}

// 树中外键管理
function showFKManagerInTree(dbName, tableName) {
  if (currentDatabase !== dbName) {
    selectDatabase(dbName).then(() => showFKManager(tableName));
  } else {
    showFKManager(tableName);
  }
}

// 树中触发器管理
function showTriggerManagerInTree(dbName, tableName) {
  if (currentDatabase !== dbName) {
    selectDatabase(dbName).then(() => showTriggerManager(tableName));
  } else {
    showTriggerManager(tableName);
  }
}

// 树中删除表
function confirmDropTableInTree(dbName, tableName) {
  if (currentDatabase !== dbName) {
    selectDatabase(dbName).then(() => confirmDropTable(tableName));
  } else {
    confirmDropTable(tableName);
  }
}

// 全部展开
function treeExpandAll() {
  // 展开连接
  const connChildren = document.getElementById('tree-conn-root-children');
  const connArrow = document.querySelector('#tree-conn-root > .tree-row .tree-arrow');
  if (connChildren) connChildren.classList.add('expanded');
  if (connArrow) connArrow.classList.add('expanded');

  // 展开所有数据库（异步加载表）
  document.querySelectorAll('.tree-node-db').forEach(async node => {
    const dbName = node.id.replace('tree-db-', '');
    if (!isDbVisible(dbName)) return;
    const children = document.getElementById('tree-db-' + dbName + '-children');
    const arrow = node.querySelector('.tree-arrow');
    if (children) children.classList.add('expanded');
    if (arrow) arrow.classList.add('expanded');
    treeDbExpanded[dbName] = true;
    await loadDbTablesInTree(dbName);
  });
}

// 全部收起
function treeCollapseAll() {
  // 收起所有数据库
  document.querySelectorAll('.tree-node-db').forEach(node => {
    const dbName = node.id.replace('tree-db-', '');
    const children = document.getElementById('tree-db-' + dbName + '-children');
    const arrow = node.querySelector('.tree-arrow');
    if (children) children.classList.remove('expanded');
    if (arrow) arrow.classList.remove('expanded');
    treeDbExpanded[dbName] = false;
  });
}

// 刷新树
async function refreshTree() {
  treeDataCache = {};
  try {
    const resp = await fetch('/database/all-with-tables');
    const result = await resp.json();
    if (result.success && result.databases) {
      // 更新数据库列表（需要重新渲染整个树）
      // 先清空旧的数据库节点
      const connChildren = document.getElementById('tree-conn-root-children');
      if (connChildren) {
        // 保留加载中的占位，重新构建
        const newChildrenHtml = result.databases.map(db => {
          const isSys = isSysDb(db.name);
          return `
            <div class="tree-node tree-node-db" id="tree-db-${db.name}">
              <div class="tree-row tree-row-db ${db.name === currentDatabase ? 'active' : ''}" onclick="treeToggleDb('${db.name}')">
                <span class="tree-arrow ${isSys || treeDbExpanded[db.name] ? 'expanded' : ''}">▼</span>
                <span class="tree-icon tree-icon-db">📁</span>
                <span class="tree-label">${db.name}</span>
                ${connType !== 'sqlite' ? `<button class="tree-db-action" onclick="event.stopPropagation(); confirmDropDatabase('${db.name}')" title="删除数据库">🗑</button>` : ''}
              </div>
              <div class="tree-children ${isSys || treeDbExpanded[db.name] ? 'expanded' : ''}" id="tree-db-${db.name}-children">
                <div class="tree-loading" id="tree-db-${db.name}-loading">加载中...</div>
              </div>
            </div>
          `;
        }).join('');
        connChildren.innerHTML = newChildrenHtml;
      }
      // 缓存并渲染
      result.databases.forEach(dbInfo => {
        treeDataCache[dbInfo.name] = dbInfo.tables || [];
        if (treeDbExpanded[dbInfo.name]) {
          renderDbTables(dbInfo.name);
        }
      });
      applySysDbFilter();
    }
  } catch (err) {
    alert('刷新失败: ' + err.message);
  }
}

// ============ 工具函数：日期格式化（前端兜底） ============

/**
 * 将 ISO 日期字符串 / Date 对象转换为 YYYY-MM-DD 格式
 */
function formatDateValue(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  let d = null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    d = val;
  } else if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    }
  } else if (typeof val === 'number') {
    d = new Date(val);
  }

  if (d && !isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return val;
}

/**
 * 判断列类型是否是日期类型
 */
function isDateColumnType(colType) {
  if (!colType) return false;
  const upper = colType.toUpperCase();
  return upper === 'DATE' || upper === 'DATETIME' || upper === 'TIMESTAMP' || upper === 'TIMESTAMPTZ' || upper === 'TIME';
}

/**
 * 格式化数据行中的日期字段（前端兜底）
 */
function formatDateFieldsInRows(rows, columns) {
  if (!rows || !columns || rows.length === 0 || columns.length === 0) return rows;
  const dateFields = columns.filter(c => isDateColumnType(c.Type)).map(c => c.Field);
  if (dateFields.length === 0) return rows;

  return rows.map(row => {
    const newRow = { ...row };
    for (const field of dateFields) {
      if (field in newRow) {
        newRow[field] = formatDateValue(newRow[field]);
      }
    }
    return newRow;
  });
}

async function selectDatabase(dbName) {
  try {
    const resp = await fetch('/connection/switch-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: dbName })
    });
    const result = await resp.json();
    if (result.success) {
      currentDatabase = dbName;
      // 更新树高亮
      document.querySelectorAll('.tree-row-db').forEach(el => el.classList.remove('active'));
      const dbRow = document.querySelector(`#tree-db-${dbName} > .tree-row-db`);
      if (dbRow) dbRow.classList.add('active');
      // 更新树中该库的表
      treeDataCache[dbName] = result.tables || [];
      renderDbTables(dbName);
      // 清空数据区
      document.getElementById('dataArea').innerHTML = '<p class="placeholder-text">请选择一个数据表</p>';
      selectedTable = null;
      // 清除表高亮
      document.querySelectorAll('.tree-row-table').forEach(el => el.classList.remove('active'));
      // 同步更新导入导出面板的数据库选择
      const ioDbSel = document.getElementById('ioTargetDb');
      if (ioDbSel) ioDbSel.value = dbName;
      onExportDbChange();
    } else {
      alert('切换数据库失败: ' + result.error);
    }
  } catch (err) {
    alert('切换数据库失败: ' + err.message);
  }
}

async function refreshDatabases() {
  await refreshTree();
}

async function refreshTables() {
  if (!currentDatabase) {
    try {
      const resp = await fetch('/database/list');
      const result = await resp.json();
      if (result.success && result.databases.length > 0) {
        currentDatabase = result.databases[0];
        await selectDatabase(currentDatabase);
        return;
      }
    } catch (err) {}
    alert('请先选择一个数据库');
    return;
  }
  // 刷新树中当前数据库的表
  treeDataCache[currentDatabase] = null;
  await loadDbTablesInTree(currentDatabase);
}

function renderDatabaseList(databases) {
  // 已被树替换，保留兼容性
  const connChildren = document.getElementById('tree-conn-root-children');
  if (!connChildren) return;
  const newHtml = databases.map(db => {
    const isSys = isSysDb(db);
    return `
      <div class="tree-node tree-node-db" id="tree-db-${db}">
        <div class="tree-row tree-row-db ${db === currentDatabase ? 'active' : ''}" onclick="treeToggleDb('${db}')">
          <span class="tree-arrow ${isSys || treeDbExpanded[db] ? 'expanded' : ''}">▼</span>
          <span class="tree-icon tree-icon-db">📁</span>
          <span class="tree-label">${db}</span>
          ${connType !== 'sqlite' ? `<button class="tree-db-action" onclick="event.stopPropagation(); confirmDropDatabase('${db}')" title="删除数据库">🗑</button>` : ''}
        </div>
        <div class="tree-children ${isSys || treeDbExpanded[db] ? 'expanded' : ''}" id="tree-db-${db}-children">
          <div class="tree-loading" id="tree-db-${db}-loading">加载中...</div>
        </div>
      </div>
    `;
  }).join('');
  connChildren.innerHTML = newHtml;
  applySysDbFilter();
}

function renderTableList(tables) {
  // 已被树替换，保留兼容性
  if (currentDatabase) {
    treeDataCache[currentDatabase] = tables || [];
    renderDbTables(currentDatabase);
  }
}

// ==================== 创建数据库 ====================
function showCreateDatabase() {
  showModal('createDatabaseModal');
}

async function createDatabase() {
  const dbName = document.getElementById('newDbName').value.trim();
  if (!dbName) { alert('请输入数据库名称'); return; }

  const data = { databaseName: dbName };
  if (connType === 'mysql') {
    data.charset = document.getElementById('newDbCharset').value;
    data.collation = document.getElementById('newDbCollation').value;
  }

  try {
    const resp = await fetch('/database/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await resp.json();
    if (result.success) {
      closeModal('createDatabaseModal');
      document.getElementById('newDbName').value = '';
      // 刷新数据库列表到树中
      renderDatabaseList(result.databases);
      // 为新数据库预加载表
      if (treeDbExpanded[dbName]) {
        await loadDbTablesInTree(dbName);
      }
    } else {
      alert('创建失败: ' + result.error);
    }
  } catch (err) {
    alert('创建失败: ' + err.message);
  }
}

// ==================== 删除数据库 ====================
function confirmDropDatabase(dbName) {
  showConfirm('删除数据库', `确定要删除数据库 "${dbName}" 吗？此操作不可撤销！`, async () => {
    try {
      const resp = await fetch('/database/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseName: dbName })
      });
    const result = await resp.json();
    if (result.success) {
      renderDatabaseList(result.databases);
      if (currentDatabase === dbName) {
        currentDatabase = '';
        document.getElementById('dataArea').innerHTML = '<p class="placeholder-text">数据库已删除</p>';
      }
      // 清除缓存
      delete treeDataCache[dbName];
    } else {
        alert('删除失败: ' + result.error);
      }
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  });
}

// ==================== 创建表 ====================
const DATA_TYPES = {
  mysql: ['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'VARCHAR', 'CHAR', 'TEXT', 'LONGTEXT', 'MEDIUMTEXT',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'FLOAT', 'DOUBLE', 'DECIMAL', 'BOOLEAN', 'JSON', 'BLOB', 'LONGBLOB'],
  postgresql: ['INTEGER', 'BIGINT', 'SMALLINT', 'VARCHAR', 'CHAR', 'TEXT', 'DATE', 'TIMESTAMP', 'TIME',
    'REAL', 'DOUBLE PRECISION', 'DECIMAL', 'NUMERIC', 'BOOLEAN', 'JSON', 'JSONB', 'BYTEA', 'UUID'],
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC', 'VARCHAR', 'DATE', 'DATETIME', 'BOOLEAN']
};

function getTypes() {
  return DATA_TYPES[connType] || DATA_TYPES.sqlite;
}

function addColumnRow() {
  const types = getTypes();
  const container = document.getElementById('columnRows');
  const idx = container.querySelectorAll('.designer-row').length;
  const row = document.createElement('div');
  row.className = 'designer-row';
  row.innerHTML = `
    <span class="designer-col-order">
      <button class="btn-order" onclick="moveColumnUp(this)" title="上移">▲</button>
      <button class="btn-order" onclick="moveColumnDown(this)" title="下移">▼</button>
    </span>
    <span class="designer-col-field"><input type="text" placeholder="字段名" class="col-name"></span>
    <span class="designer-col-type"><select class="col-type-sel">${types.map(t => `<option value="${t}">${t}</option>`).join('')}</select></span>
    <span class="designer-col-len"><input type="number" placeholder="长度" class="col-length" min="0"></span>
    <span class="designer-col-dec"><input type="number" placeholder="小数" class="col-decimals" min="0"></span>
    <span class="designer-col-null"><input type="checkbox" class="col-notnull"></span>
    <span class="designer-col-pri"><input type="checkbox" class="col-primary"></span>
    <span class="designer-col-auto"><input type="checkbox" class="col-autoincrement"></span>
    <span class="designer-col-def"><input type="text" placeholder="默认值" class="col-default"></span>
    <span class="designer-col-comment"><input type="text" placeholder="备注" class="col-comment-input"></span>
    <span class="designer-col-action"><button class="btn-delete-field" onclick="deleteColumnRow(this)" title="删除此字段">删除</button></span>
  `;
  container.appendChild(row);
  updateOrderButtons(container);
}

// 上移字段
function moveColumnUp(btn) {
  const row = btn.closest('.designer-row');
  const prev = row.previousElementSibling;
  if (prev && prev.classList.contains('designer-row')) {
    row.parentNode.insertBefore(row, prev);
    updateOrderButtons(row.parentNode);
  }
}

// 下移字段
function moveColumnDown(btn) {
  const row = btn.closest('.designer-row');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('designer-row')) {
    row.parentNode.insertBefore(next, row);
    updateOrderButtons(row.parentNode);
  }
}

// 删除字段行
function deleteColumnRow(btn) {
  const row = btn.closest('.designer-row');
  const container = row.parentNode;
  row.remove();
  updateOrderButtons(container);
}

// 更新所有排序按钮状态
function updateOrderButtons(container) {
  const rows = container.querySelectorAll('.designer-row');
  rows.forEach((row, i) => {
    const upBtn = row.querySelector('.btn-order:first-child');
    const downBtn = row.querySelector('.btn-order:last-child');
    if (upBtn) upBtn.disabled = (i === 0);
    if (downBtn) downBtn.disabled = (i === rows.length - 1);
  });
}

// ==================== 外键配置 ====================
const FK_RULES = ['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION'];

async function addForeignKeyRow() {
  const container = document.getElementById('foreignKeyRows');
  // 移除空状态提示
  const empty = container.querySelector('.fk-empty');
  if (empty) empty.remove();

  // 获取当前表已有的字段名
  const currentFields = [];
  document.querySelectorAll('#columnRows .designer-row .col-name').forEach(input => {
    const name = input.value.trim();
    if (name) currentFields.push(name);
  });

  // 获取数据库中的表列表
  let tables = [];
  try {
    const resp = await fetch(`/database/tables/${currentDatabase}`);
    const result = await resp.json();
    if (result.success) tables = result.tables || [];
  } catch (e) { /* ignore */ }

  const row = document.createElement('div');
  row.className = 'fk-designer-row';
  row.innerHTML = `
    <span class="fk-col-field">
      <select class="fk-col-name">
        <option value="">-- 选择字段 --</option>
        ${currentFields.map(f => `<option value="${f}">${f}</option>`).join('')}
      </select>
    </span>
    <span class="fk-col-ref-table">
      <select class="fk-ref-table" onchange="onFkRefTableChange(this)">
        <option value="">-- 选择关联表 --</option>
        ${tables.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
    </span>
    <span class="fk-col-ref-field">
      <select class="fk-ref-field" disabled>
        <option value="">-- 先选表 --</option>
      </select>
    </span>
    <span class="fk-col-on-delete">
      <select class="fk-on-delete">
        ${FK_RULES.map(r => `<option value="${r}">${r}</option>`).join('')}
      </select>
    </span>
    <span class="fk-col-on-update">
      <select class="fk-on-update">
        ${FK_RULES.map(r => `<option value="${r}">${r}</option>`).join('')}
      </select>
    </span>
    <span class="fk-col-action">
      <button class="btn-delete-field" onclick="deleteForeignKeyRow(this)" title="删除此外键">删除</button>
    </span>
  `;
  container.appendChild(row);
}

// 关联表切换时加载其字段
async function onFkRefTableChange(sel) {
  const refTable = sel.value;
  const fieldSel = sel.closest('.fk-designer-row').querySelector('.fk-ref-field');
  if (!refTable) {
    fieldSel.innerHTML = '<option value="">-- 先选表 --</option>';
    fieldSel.disabled = true;
    return;
  }
  fieldSel.innerHTML = '<option value="">加载中...</option>';
  fieldSel.disabled = true;
  try {
    const resp = await fetch(`/data/columns/${encodeURIComponent(refTable)}?database=${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    if (result.success && result.columns) {
      fieldSel.innerHTML = '<option value="">-- 选择关联字段 --</option>' +
        result.columns.map(c => `<option value="${c.Field}">${c.Field}</option>`).join('');
      fieldSel.disabled = false;
    } else {
      fieldSel.innerHTML = '<option value="">-- 无可用字段 --</option>';
    }
  } catch (e) {
    fieldSel.innerHTML = '<option value="">-- 加载失败 --</option>';
  }
}

// 删除外键行
function deleteForeignKeyRow(btn) {
  const row = btn.closest('.fk-designer-row');
  const container = row.parentNode;
  row.remove();
  // 如果没有行了，显示空提示
  if (container.querySelectorAll('.fk-designer-row').length === 0) {
    container.innerHTML = '<div class="fk-empty">暂未添加外键</div>';
  }
}

function showCreateTable() {
  if (!currentDatabase) {
    alert('请先选择数据库');
    return;
  }
  document.getElementById('columnRows').innerHTML = '';
  document.getElementById('foreignKeyRows').innerHTML = '<div class="fk-empty">暂未添加外键</div>';
  // 默认添加一行字段
  addColumnRow();
  showModal('createTableModal');
}

async function createTable() {
  const tableName = document.getElementById('newTableName').value.trim();
  if (!tableName) { alert('请输入表名'); return; }

  const rows = document.querySelectorAll('#columnRows .designer-row');
  const columns = [];
  rows.forEach(row => {
    const name = row.querySelector('.col-name').value.trim();
    if (!name) return;
    columns.push({
      name,
      type: row.querySelector('.col-type-sel').value,
      length: row.querySelector('.col-length').value || null,
      decimals: row.querySelector('.col-decimals').value || null,
      notNull: row.querySelector('.col-notnull').checked,
      primary: row.querySelector('.col-primary').checked,
      autoIncrement: row.querySelector('.col-autoincrement').checked,
      defaultValue: row.querySelector('.col-default').value,
      comment: row.querySelector('.col-comment-input').value
    });
  });

  if (columns.length === 0) { alert('请添加至少一个字段'); return; }

  // 收集外键数据
  const fkRows = document.querySelectorAll('#foreignKeyRows .fk-designer-row');
  const foreignKeys = [];
  fkRows.forEach(row => {
    const colName = row.querySelector('.fk-col-name').value;
    const refTable = row.querySelector('.fk-ref-table').value;
    const refField = row.querySelector('.fk-ref-field').value;
    const onDelete = row.querySelector('.fk-on-delete').value;
    const onUpdate = row.querySelector('.fk-on-update').value;
    if (colName && refTable && refField) {
      foreignKeys.push({ column: colName, refTable, refField, onDelete, onUpdate });
    }
  });

  try {
    const resp = await fetch('/table/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName, columns, foreignKeys, database: currentDatabase })
    });
    const result = await resp.json();
    if (result.success) {
      closeModal('createTableModal');
      document.getElementById('newTableName').value = '';
      document.getElementById('columnRows').innerHTML = '';
      document.getElementById('foreignKeyRows').innerHTML = '<div class="fk-empty">暂未添加外键</div>';
      // 更新树中表列表
      treeDataCache[currentDatabase] = result.tables;
      renderDbTables(currentDatabase);
    } else {
      alert('创建表失败: ' + result.error);
    }
  } catch (err) {
    alert('创建表失败: ' + err.message);
  }
}

// ==================== 删除表 ====================
function confirmDropTable(tableName) {
  showConfirm('删除数据表', `确定要删除数据表 "${tableName}" 吗？此操作不可撤销！`, async () => {
    try {
      const resp = await fetch('/table/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableName, database: currentDatabase })
      });
    const result = await resp.json();
    if (result.success) {
      // 更新树中表列表
      treeDataCache[currentDatabase] = result.tables;
      renderDbTables(currentDatabase);
      if (selectedTable === tableName) {
        selectedTable = null;
        document.getElementById('dataArea').innerHTML = '<p class="placeholder-text">表已删除</p>';
      }
    } else {
        alert('删除失败: ' + result.error);
      }
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  });
}

// ==================== 设计表（修改表） ====================
function addDesignColumnRow() {
  const types = getTypes();
  const row = document.createElement('div');
  row.className = 'designer-row';
  row.innerHTML = `
    <span class="designer-col-field"><input type="text" placeholder="字段名" class="col-name"></span>
    <span class="designer-col-type"><select class="col-type-sel">${types.map(t => `<option value="${t}">${t}</option>`).join('')}</select></span>
    <span class="designer-col-len"><input type="number" placeholder="长度" class="col-length" min="0"></span>
    <span class="designer-col-dec"><input type="number" placeholder="小数" class="col-decimals" min="0"></span>
    <span class="designer-col-null"><input type="checkbox" class="col-notnull"></span>
    <span class="designer-col-pri"><input type="checkbox" class="col-primary"></span>
    <span class="designer-col-auto"><input type="checkbox" class="col-autoincrement"></span>
    <span class="designer-col-def"><input type="text" placeholder="默认值" class="col-default"></span>
    <span class="designer-col-comment"><input type="text" placeholder="备注" class="col-comment-input"></span>
    <span class="designer-col-action"><button class="btn-icon-sm" onclick="this.closest('.designer-row').remove()" title="删除此字段">✕</button></span>
    <input type="hidden" class="col-original-name" value="">
    <input type="hidden" class="col-action-type" value="add">
  `;
  document.getElementById('designColumnRows').appendChild(row);
}

async function designTable(tableName) {
  if (!currentDatabase) { alert('请先选择数据库'); return; }
  designTableName = tableName;

  try {
    const resp = await fetch(`/table/design/${tableName}?database=${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    if (!result.success) { alert('获取表结构失败: ' + result.error); return; }

    document.getElementById('designTableName').textContent = tableName;
    const container = document.getElementById('designColumnRows');
    container.innerHTML = '';

    const types = getTypes();
    result.structure.forEach(col => {
      // 解析类型和长度
      let type = col.Type || '';
      let length = '';
      let decimals = '';
      const typeMatch = type.match(/^(\w+)\((\d+)(?:,(\d+))?\)/);
      if (typeMatch) {
        type = typeMatch[1];
        length = typeMatch[2];
        decimals = typeMatch[3] || '';
      }

      const row = document.createElement('div');
      row.className = 'designer-row';
      row.innerHTML = `
        <span class="designer-col-field"><input type="text" value="${escapeHtml(col.Field)}" class="col-name"></span>
        <span class="designer-col-type"><select class="col-type-sel">${types.map(t => `<option value="${t}" ${t.toUpperCase() === type.toUpperCase() ? 'selected' : ''}>${t}</option>`).join('')}</select></span>
        <span class="designer-col-len"><input type="number" value="${length}" placeholder="长度" class="col-length" min="0"></span>
        <span class="designer-col-dec"><input type="number" value="${decimals}" placeholder="小数" class="col-decimals" min="0"></span>
        <span class="designer-col-null"><input type="checkbox" class="col-notnull" ${col.Null === 'NO' ? 'checked' : ''}></span>
        <span class="designer-col-pri"><input type="checkbox" class="col-primary" ${col.Key === 'PRI' ? 'checked' : ''}></span>
        <span class="designer-col-auto"><input type="checkbox" class="col-autoincrement" ${(col.Extra || '').toLowerCase().includes('auto_increment') ? 'checked' : ''}></span>
        <span class="designer-col-def"><input type="text" value="${escapeHtml(col.Default || '')}" placeholder="默认值" class="col-default"></span>
        <span class="designer-col-comment"><input type="text" value="${escapeHtml(col.Extra || '')}" placeholder="备注" class="col-comment-input"></span>
        <span class="designer-col-action"><button class="btn-icon-sm" onclick="this.closest('.designer-row').remove()" title="删除此字段">✕</button></span>
        <input type="hidden" class="col-original-name" value="${escapeHtml(col.Field)}">
        <input type="hidden" class="col-action-type" value="modify">
      `;
      container.appendChild(row);
    });

    showModal('designTableModal');
  } catch (err) {
    alert('获取表结构失败: ' + err.message);
  }
}

async function saveTableDesign() {
  const rows = document.querySelectorAll('#designColumnRows .designer-row');
  const operations = [];

  rows.forEach(row => {
    const originalName = row.querySelector('.col-original-name').value;
    const actionType = row.querySelector('.col-action-type').value;
    const name = row.querySelector('.col-name').value.trim();
    if (!name) return;

    const column = {
      name,
      oldName: originalName || undefined,
      type: row.querySelector('.col-type-sel').value,
      length: row.querySelector('.col-length').value || null,
      decimals: row.querySelector('.col-decimals').value || null,
      notNull: row.querySelector('.col-notnull').checked,
      primary: row.querySelector('.col-primary').checked,
      autoIncrement: row.querySelector('.col-autoincrement').checked,
      defaultValue: row.querySelector('.col-default').value,
      comment: row.querySelector('.col-comment-input').value
    };

    operations.push({
      action: actionType === 'add' ? 'addColumn' : 'modifyColumn',
      column,
      columnName: originalName || name
    });
  });

  // 检查是否有已删除的列（不在设计器中的原始列）
  // 简化处理：仅支持添加和修改

  try {
    const resp = await fetch('/table/alter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName: designTableName, database: currentDatabase, operations })
    });
    const result = await resp.json();
    if (result.success) {
      closeModal('designTableModal');
      // 更新树中表列表
      treeDataCache[currentDatabase] = result.tables;
      renderDbTables(currentDatabase);
      if (selectedTable === designTableName) {
        loadTableData(selectedTable);
      }
    } else {
      document.getElementById('designMsg').innerHTML = `<div class="alert alert-error">${result.error}</div>`;
    }
  } catch (err) {
    document.getElementById('designMsg').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ==================== 表数据操作 ====================
let currentPage = 1;
let pageSize = 20;
let totalPages = 1;
let tableColumns = [];
let primaryKeyField = '';

async function selectTable(tableName) {
  selectedTable = tableName;
  currentPage = 1;

  // 高亮选中（树中的表节点）
  document.querySelectorAll('.tree-row-table').forEach(el => el.classList.remove('active'));
  const treeRow = document.querySelector(`.tree-row-table[data-db="${currentDatabase}"][data-table="${tableName}"]`);
  if (treeRow) treeRow.classList.add('active');

  // 获取列信息
  try {
    const colResp = await fetch(`/data/columns/${tableName}?database=${encodeURIComponent(currentDatabase)}`);
    const colResult = await colResp.json();
    if (colResult.success) {
      tableColumns = colResult.columns;
      // 找主键
      const pkCol = tableColumns.find(c => c.Key === 'PRI');
      primaryKeyField = pkCol ? pkCol.Field : (tableColumns[0] ? tableColumns[0].Field : '');
    }
  } catch (err) {}

  await loadTableData(tableName);
}

async function loadTableData(tableName) {
  if (!tableName) tableName = selectedTable;
  if (!tableName) return;

  const dataArea = document.getElementById('dataArea');
  dataArea.innerHTML = '<p style="text-align:center;padding:30px;">加载中...</p>';

  const url = `/data/table/${tableName}?database=${encodeURIComponent(currentDatabase)}&page=${currentPage}&pageSize=${pageSize}`;

  try {
    const resp = await fetch(url);
    const result = await resp.json();

    if (!result.success) {
      dataArea.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      return;
    }

    totalPages = result.totalPages;
    currentPage = result.page;

    // 重新获取列信息
    if (result.data.length > 0) {
      tableColumns = Object.keys(result.data[0]).map(key => {
        const existing = tableColumns.find(c => c.Field === key);
        return existing || { Field: key, Type: '', Null: 'YES', Key: '', Default: null, Extra: '' };
      });
      if (!primaryKeyField) {
        const pkCol = tableColumns.find(c => c.Key === 'PRI');
        primaryKeyField = pkCol ? pkCol.Field : tableColumns[0]?.Field || '';
      }
    }

    renderDataTable(result.data, result.total);
  } catch (err) {
    dataArea.innerHTML = `<div class="alert alert-error">加载失败: ${err.message}</div>`;
  }
}

function renderDataTable(data, total) {
  const dataArea = document.getElementById('dataArea');

  // 前端兜底：格式化日期字段
  data = formatDateFieldsInRows(data, tableColumns);

  let html = `
    <div class="data-table-wrapper">
      <div class="data-toolbar">
        <div class="toolbar-left">
          <strong>${selectedTable}</strong>
          <span style="color:#888;font-size:12px;">共 ${total} 条记录</span>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-sm btn-primary" onclick="showAddRow()">+ 添加数据</button>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              ${tableColumns.map(c => `
                <th>${c.Field}</th>
              `).join('')}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${data.length === 0 ? `<tr><td colspan="${tableColumns.length + 1}" style="text-align:center;padding:30px;color:#999;">暂无数据</td></tr>` : ''}
            ${data.map(row => `
              <tr>
                ${tableColumns.map(c => `<td title="${escapeHtml(String(row[c.Field] ?? ''))}">${escapeHtml(String(row[c.Field] ?? ''))}</td>`).join('')}
                <td class="row-actions">
                  <button class="btn btn-sm" onclick="editRow('${escapeAttr(primaryKeyField)}', '${escapeAttr(String(row[primaryKeyField] ?? ''))}')">编辑</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteRow('${escapeAttr(primaryKeyField)}', '${escapeAttr(String(row[primaryKeyField] ?? ''))}')">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${renderPagination()}
    </div>
  `;

  dataArea.innerHTML = html;
}

// ==================== 表子菜单（外键 / 触发器） ====================
function toggleTableSubmenu(event, tableName) {
  const submenu = document.getElementById('submenu-' + tableName);
  if (submenu) {
    submenu.style.display = submenu.style.display === 'none' ? 'block' : 'none';
  }
}

function renderPagination() {
  let html = '<div class="pagination">';
  html += `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(1)">第一页</button>`;
  html += `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="goToPage(${currentPage - 1})">上一页</button>`;

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
  }

  html += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${currentPage + 1})">下一页</button>`;
  html += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">最后一页</button>`;
  html += `<span class="page-info">第 ${currentPage}/${totalPages} 页</span>`;
  html += `<select class="page-size-select" onchange="changePageSize(this.value)">
    <option value="10" ${pageSize === 10 ? 'selected' : ''}>10条/页</option>
    <option value="20" ${pageSize === 20 ? 'selected' : ''}>20条/页</option>
    <option value="50" ${pageSize === 50 ? 'selected' : ''}>50条/页</option>
    <option value="100" ${pageSize === 100 ? 'selected' : ''}>100条/页</option>
  </select>`;
  html += '</div>';
  return html;
}

function goToPage(page) {
  currentPage = page;
  loadTableData();
}

function changePageSize(size) {
  pageSize = parseInt(size);
  currentPage = 1;
  loadTableData();
}

// ==================== 编辑数据 ====================
function showAddRow() {
  editingRowData = null;
  editingPrimaryKey = primaryKeyField;
  editingPrimaryValue = null;
  document.getElementById('editRowTitle').textContent = '添加数据';

  const fieldsHtml = tableColumns.map(c => {
    const isPrimary = c.Key === 'PRI';
    const isAuto = (c.Extra || '').toLowerCase().includes('auto_increment');
    const disabled = (isPrimary && isAuto) ? 'disabled' : '';
    const isDate = isDateColumnType(c.Type);
    const inputType = isDate ? 'date' : 'text';
    return `
      <div class="form-group">
        <label>${c.Field} ${isPrimary ? '(主键)' : ''} ${isAuto ? '(自增)' : ''}</label>
        <input type="${inputType}" class="form-control edit-field" data-field="${c.Field}" placeholder="${c.Type || ''}" ${disabled}>
      </div>
    `;
  }).join('');

  document.getElementById('editRowFields').innerHTML = fieldsHtml;
  showModal('editRowModal');
}

function editRow(pkField, pkValue) {
  editingPrimaryKey = pkField;
  editingPrimaryValue = pkValue;

  // 查找该行数据
  const cells = document.querySelectorAll(`.data-table td`);
  // 从现有数据重新加载
  loadRowForEdit(pkField, pkValue);
}

async function loadRowForEdit(pkField, pkValue) {
  document.getElementById('editRowTitle').textContent = '编辑数据';
  // 直接从当前显示的表格中获取数据
  const rows = document.querySelectorAll('.data-table tbody tr');
  let rowData = {};

  rows.forEach(row => {
    const tds = row.querySelectorAll('td');
    const pkIdx = tableColumns.findIndex(c => c.Field === pkField);
    if (pkIdx >= 0 && tds[pkIdx] && tds[pkIdx].textContent === pkValue) {
      tableColumns.forEach((c, i) => {
        rowData[c.Field] = tds[i] ? tds[i].textContent : '';
      });
    }
  });

  editingRowData = rowData;

  const fieldsHtml = tableColumns.map(c => {
    const isPrimary = c.Key === 'PRI';
    const val = rowData[c.Field] !== undefined ? rowData[c.Field] : '';
    const isDate = isDateColumnType(c.Type);
    const inputType = isDate ? 'date' : 'text';
    return `
      <div class="form-group">
        <label>${c.Field} ${isPrimary ? '(主键)' : ''}</label>
        <input type="${inputType}" class="form-control edit-field" data-field="${c.Field}" value="${escapeHtml(String(val))}" ${isPrimary ? 'readonly' : ''}>
      </div>
    `;
  }).join('');

  document.getElementById('editRowFields').innerHTML = fieldsHtml;
  showModal('editRowModal');
}

async function saveRow() {
  const fields = document.querySelectorAll('.edit-field');
  const data = {};
  fields.forEach(f => {
    if (!f.disabled) {
      data[f.dataset.field] = f.value;
    }
  });

  try {
    let resp;
    if (editingPrimaryValue) {
      // 更新
      resp = await fetch(`/data/update/${selectedTable}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          database: currentDatabase,
          data,
          primaryKey: editingPrimaryKey,
          primaryValue: editingPrimaryValue
        })
      });
    } else {
      // 插入
      resp = await fetch(`/data/insert/${selectedTable}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: currentDatabase, data })
      });
    }

    const result = await resp.json();
    if (result.success) {
      closeModal('editRowModal');
      loadTableData();
    } else {
      alert('操作失败: ' + result.error);
    }
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
}

function deleteRow(pkField, pkValue) {
  showConfirm('删除数据', '确定要删除这条数据吗？', async () => {
    try {
      const resp = await fetch(`/data/delete/${selectedTable}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: currentDatabase, primaryKey: pkField, primaryValue: pkValue })
      });
      const result = await resp.json();
      if (result.success) {
        loadTableData();
      } else {
        alert('删除失败: ' + result.error);
      }
    } catch (err) {
      alert('删除失败: ' + err.message);
    }
  });
}

// ==================== SQL 查询 ====================
async function executeQuery() {
  const sql = document.getElementById('sqlEditor').value.trim();
  if (!sql) { alert('请输入 SQL 语句'); return; }

  try {
    const resp = await fetch('/query/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, database: currentDatabase })
    });
    const result = await resp.json();
    renderQueryResult(result);
  } catch (err) {
    document.getElementById('queryResult').innerHTML = `<div class="result-error">错误: ${err.message}</div>`;
  }
}

async function executeBatch() {
  const sql = document.getElementById('sqlEditor').value.trim();
  if (!sql) { alert('请输入 SQL 语句'); return; }

  try {
    const resp = await fetch('/query/execute-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, database: currentDatabase })
    });
    const result = await resp.json();
    if (result.success) {
      let html = '';
      result.results.forEach((r, i) => {
        if (r.success) {
          html += `<div style="padding:8px;border-bottom:1px solid #f0f0f0;color:#38a169;">✓ 语句 ${i + 1}: 执行成功 (${r.rows ? r.rows.length : 0} 行)</div>`;
        } else {
          html += `<div style="padding:8px;border-bottom:1px solid #f0f0f0;color:#e53e3e;">✗ 语句 ${i + 1}: ${r.error}</div>`;
        }
      });
      document.getElementById('queryResult').innerHTML = html;
    }
  } catch (err) {
    document.getElementById('queryResult').innerHTML = `<div class="result-error">错误: ${err.message}</div>`;
  }
}

function renderQueryResult(result) {
  const container = document.getElementById('queryResult');
  if (!result.success) {
    container.innerHTML = `<div class="result-error">错误: ${result.error}</div>`;
    return;
  }

  if (!result.rows || result.rows.length === 0) {
    container.innerHTML = '<div class="result-info">查询执行成功，无返回数据</div>';
    return;
  }

  // 检查是否是变更操作结果
  if (result.rows[0] && result.rows[0].changes !== undefined) {
    container.innerHTML = `<div class="result-info">操作成功，影响行数: ${result.rows[0].changes}</div>`;
    return;
  }

  const columns = Object.keys(result.rows[0]);
  let html = `<div class="result-info">查询成功，返回 ${result.rowCount || result.rows.length} 行</div>`;
  html += '<div style="overflow-x:auto;"><table>';
  html += '<thead><tr>' + columns.map(c => `<th>${c}</th>`).join('') + '</tr></thead>';
  html += '<tbody>';
  result.rows.forEach(row => {
    html += '<tr>' + columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// SQL 编辑器快捷键 & 树初始化
document.addEventListener('DOMContentLoaded', () => {
  const sqlEditor = document.getElementById('sqlEditor');
  if (sqlEditor) {
    sqlEditor.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        executeQuery();
      }
    });
  }
  // 初始化树状导航
  initTree();
});

// ==================== 保存查询 ====================
function showSaveQuery() {
  showModal('saveQueryModal');
}

async function saveQuery() {
  const name = document.getElementById('queryName').value.trim();
  const sql = document.getElementById('sqlEditor').value.trim();
  if (!name) { alert('请输入查询名称'); return; }
  if (!sql) { alert('请输入 SQL 语句'); return; }

  try {
    const resp = await fetch('/query/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sql, database: currentDatabase })
    });
    const result = await resp.json();
    if (result.success) {
      closeModal('saveQueryModal');
      document.getElementById('queryName').value = '';
      alert('查询已保存');
    }
  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

let savedQueriesCache = [];

async function loadSavedQueries() {
  try {
    const resp = await fetch('/query/saved');
    const result = await resp.json();
    savedQueriesCache = result.queries || [];
    const list = document.getElementById('savedQueriesList');
    document.getElementById('savedQueryEditArea').style.display = 'none';

    if (!savedQueriesCache || savedQueriesCache.length === 0) {
      list.innerHTML = '<p class="empty-text">暂无保存的查询</p>';
    } else {
      list.innerHTML = savedQueriesCache.map(q => `
        <div class="saved-query-row">
          <div class="saved-query-info">
            <strong class="sq-name">${escapeHtml(q.name)}</strong>
            <span class="sq-sql">${escapeHtml(q.sql.substring(0, 120))}${q.sql.length > 120 ? '...' : ''}</span>
            <span class="sq-meta">${escapeHtml(q.database || '')} · ${q.createdAt ? q.createdAt.substring(0, 10) : ''}</span>
          </div>
          <div class="saved-query-actions">
            <button class="btn btn-sm btn-primary" onclick="useSavedQuery('${q.id}')">执行</button>
            <button class="btn btn-sm" onclick="editSavedQuery('${q.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteSavedQuery('${q.id}')">删除</button>
          </div>
        </div>
      `).join('');
    }
    showModal('savedQueriesModal');
  } catch (err) {
    alert('加载失败');
  }
}

function useSavedQuery(id) {
  const q = savedQueriesCache.find(q => q.id === id);
  if (q) {
    document.getElementById('sqlEditor').value = q.sql;
    closeModal('savedQueriesModal');
    switchContentTab('query');
  }
}

function editSavedQuery(id) {
  const q = savedQueriesCache.find(q => q.id === id);
  if (!q) return;
  document.getElementById('editQueryId').value = q.id;
  document.getElementById('editQueryName').value = q.name;
  document.getElementById('editQuerySql').value = q.sql;
  document.getElementById('savedQueryEditArea').style.display = 'block';
  document.getElementById('editQueryMsg').innerHTML = '';
  // 滚动到编辑区域
  document.getElementById('savedQueryEditArea').scrollIntoView({ behavior: 'smooth' });
}

function cancelEditQuery() {
  document.getElementById('savedQueryEditArea').style.display = 'none';
  document.getElementById('editQueryId').value = '';
  document.getElementById('editQueryName').value = '';
  document.getElementById('editQuerySql').value = '';
  document.getElementById('editQueryMsg').innerHTML = '';
}

async function saveEditedQuery() {
  const id = document.getElementById('editQueryId').value;
  const name = document.getElementById('editQueryName').value.trim();
  const sql = document.getElementById('editQuerySql').value.trim();
  if (!name) { alert('请输入查询名称'); return; }
  if (!sql) { alert('请输入 SQL 语句'); return; }

  const msgDiv = document.getElementById('editQueryMsg');
  msgDiv.innerHTML = '<div style="color:#888;">正在保存...</div>';

  try {
    const resp = await fetch('/query/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, sql })
    });
    const result = await resp.json();
    if (result.success) {
      msgDiv.innerHTML = '<div class="alert alert-success">查询已更新</div>';
      cancelEditQuery();
      await loadSavedQueriesRef();
    } else {
      msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${result.error}</div>`;
    }
  } catch (err) {
    msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${err.message}</div>`;
  }
}

async function saveAsNewQuery() {
  const name = document.getElementById('editQueryName').value.trim();
  const sql = document.getElementById('editQuerySql').value.trim();
  if (!name) { alert('请输入查询名称'); return; }
  if (!sql) { alert('请输入 SQL 语句'); return; }

  const msgDiv = document.getElementById('editQueryMsg');
  msgDiv.innerHTML = '<div style="color:#888;">正在另存...</div>';

  try {
    const resp = await fetch('/query/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, sql, database: currentDatabase })
    });
    const result = await resp.json();
    if (result.success) {
      msgDiv.innerHTML = '<div class="alert alert-success">已另存为新查询</div>';
      cancelEditQuery();
      await loadSavedQueriesRef();
    } else {
      msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${result.error}</div>`;
    }
  } catch (err) {
    msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${err.message}</div>`;
  }
}

// 刷新列表而不重新打开弹窗
async function loadSavedQueriesRef() {
  try {
    const resp = await fetch('/query/saved');
    const result = await resp.json();
    savedQueriesCache = result.queries || [];
    const list = document.getElementById('savedQueriesList');
    if (!savedQueriesCache || savedQueriesCache.length === 0) {
      list.innerHTML = '<p class="empty-text">暂无保存的查询</p>';
    } else {
      list.innerHTML = savedQueriesCache.map(q => `
        <div class="saved-query-row">
          <div class="saved-query-info">
            <strong class="sq-name">${escapeHtml(q.name)}</strong>
            <span class="sq-sql">${escapeHtml(q.sql.substring(0, 120))}${q.sql.length > 120 ? '...' : ''}</span>
            <span class="sq-meta">${escapeHtml(q.database || '')} · ${q.createdAt ? q.createdAt.substring(0, 10) : ''}</span>
          </div>
          <div class="saved-query-actions">
            <button class="btn btn-sm btn-primary" onclick="useSavedQuery('${q.id}')">执行</button>
            <button class="btn btn-sm" onclick="editSavedQuery('${q.id}')">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteSavedQuery('${q.id}')">删除</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {}
}

async function deleteSavedQuery(id) {
  showConfirm('删除查询', '确定要删除这个已保存的查询吗？', async () => {
    await fetch('/query/delete-saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    document.getElementById('savedQueryEditArea').style.display = 'none';
    await loadSavedQueriesRef();
  });
}

// ==================== 新建连接（工作区内） ====================
function showNewConnectionDialog() {
  document.getElementById('ncMsg').innerHTML = '';
  showModal('newConnectionModal');
}

function onNCTypeChange() {
  const type = document.getElementById('ncDbType').value;
  document.getElementById('ncServerFields').style.display = type === 'sqlite' ? 'none' : 'block';
  document.getElementById('ncSqliteFields').style.display = type === 'sqlite' ? 'block' : 'none';
  if (type === 'mysql') {
    document.getElementById('ncPort').value = '3306';
  } else if (type === 'postgresql') {
    document.getElementById('ncPort').value = '5432';
  }
}

async function doNewConnection() {
  const type = document.getElementById('ncDbType').value;
  const name = document.getElementById('ncName').value.trim();
  const host = document.getElementById('ncHost').value.trim();
  const port = document.getElementById('ncPort').value;
  const user = document.getElementById('ncUser').value.trim();
  const password = document.getElementById('ncPassword').value;
  const database = document.getElementById('ncDatabase').value.trim();
  const filePath = document.getElementById('ncFilePath') ? document.getElementById('ncFilePath').value.trim() : '';
  const savePassword = document.getElementById('ncSavePassword').checked;

  const msgDiv = document.getElementById('ncMsg');
  msgDiv.innerHTML = '<div style="color:#888;">正在连接...</div>';

  try {
    const resp = await fetch('/connection/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, host, port, user, password, database, name, filePath, savePassword: savePassword ? 'true' : 'false' })
    });
    const result = await resp.json();
    if (result.success) {
      msgDiv.innerHTML = '<div class="alert alert-success">连接成功，正在跳转...</div>';
      setTimeout(() => {
        window.location.href = '/workspace';
      }, 500);
    } else {
      msgDiv.innerHTML = `<div class="alert alert-error">连接失败: ${result.error}</div>`;
    }
  } catch (err) {
    msgDiv.innerHTML = `<div class="alert alert-error">连接失败: ${err.message}</div>`;
  }
}

// ==================== 导入导出 ====================

// 初始化导入导出的数据库下拉框
async function initExportDbSelect() {
  try {
    const resp = await fetch('/database/list');
    const result = await resp.json();
    if (result.success) {
      const sel = document.getElementById('ioTargetDb');
      sel.innerHTML = '<option value="">-- 请选择数据库 --</option>' +
        result.databases.map(db => `<option value="${db}">${db}</option>`).join('');
      // 默认选中当前数据库
      if (currentDatabase) {
        sel.value = currentDatabase;
        onExportDbChange();
      }
    }
  } catch (err) {}
}

// 切换导出目标数据库时，加载该库下的表列表
async function onExportDbChange() {
  const dbName = document.getElementById('ioTargetDb').value;
  const tableSel = document.getElementById('ioTargetTable');
  if (!dbName) {
    tableSel.innerHTML = '<option value="">-- 全部表 --</option>';
    return;
  }
  try {
    const resp = await fetch(`/database/tables/${encodeURIComponent(dbName)}`);
    const result = await resp.json();
    if (result.success) {
      tableSel.innerHTML = '<option value="">-- 全部表 --</option>' +
        result.tables.map(t => `<option value="${t}">${t}</option>`).join('');
    }
  } catch (err) {}
}

// 导出 CSV
async function doExportCSV() {
  const dbName = document.getElementById('ioTargetDb').value;
  const tableName = document.getElementById('ioTargetTable').value;
  if (!dbName) { alert('请先选择目标数据库'); return; }
  if (!tableName) { alert('导出CSV请选择具体表'); return; }

  const resultDiv = document.getElementById('exportResult');
  resultDiv.innerHTML = '<div class="alert" style="color:#888;">正在导出...</div>';
  try {
    const resp = await fetch('/import-export/export-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: dbName, tableName })
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || '导出失败');
    }
    const blob = await resp.blob();
    downloadBlob(blob, `${tableName}.csv`);
    resultDiv.innerHTML = '<div class="alert alert-success">导出成功！</div>';
  } catch (err) {
    resultDiv.innerHTML = `<div class="alert alert-error">导出失败: ${err.message}</div>`;
  }
}

// 导出 SQL
async function doExportSQL() {
  const dbName = document.getElementById('ioTargetDb').value;
  const tableName = document.getElementById('ioTargetTable').value;
  if (!dbName) { alert('请先选择目标数据库'); return; }

  const exportMode = document.getElementById('exportMode')?.value || 'full';
  const resultDiv = document.getElementById('exportResult');
  resultDiv.innerHTML = '<div class="alert" style="color:#888;">正在导出...</div>';

  try {
    let resp;
    if (tableName) {
      // 导出单表
      resp = await fetch('/import-export/export-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: dbName, tableName, exportMode })
      });
    } else {
      // 导出整个数据库
      resp = await fetch('/import-export/export-database-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: dbName, exportMode })
      });
    }
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || '导出失败');
    }
    const blob = await resp.blob();
    const filename = tableName ? `${tableName}.sql` : `${dbName}.sql`;
    downloadBlob(blob, filename);
    resultDiv.innerHTML = '<div class="alert alert-success">导出成功！</div>';
  } catch (err) {
    resultDiv.innerHTML = `<div class="alert alert-error">导出失败: ${err.message}</div>`;
  }
}

// 导入
async function doImport() {
  const dbName = document.getElementById('ioTargetDb').value;
  const tableName = document.getElementById('ioTargetTable').value;
  if (!dbName) { alert('请先选择目标数据库'); return; }

  const fileInput = document.getElementById('importFile');
  const file = fileInput.files[0];
  if (!file) { alert('请选择文件'); return; }

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'csv' && ext !== 'sql') {
    alert('仅支持 .csv 或 .sql 文件');
    return;
  }
  if (ext === 'csv' && !tableName) {
    alert('导入 CSV 请选择目标表');
    return;
  }

  const container = document.getElementById('importResult');
  container.innerHTML = '<div class="alert" style="color:#888;">正在导入...</div>';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('database', dbName);
  if (tableName) formData.append('tableName', tableName);

  const url = ext === 'csv' ? '/import-export/import-csv' : '/import-export/import-sql';

  try {
    const resp = await fetch(url, { method: 'POST', body: formData });
    const result = await resp.json();
    if (result.success) {
      if (result.imported !== undefined) {
        container.innerHTML = `<div class="alert alert-success">导入成功！共 ${result.imported} / ${result.total} 条记录</div>`;
      } else if (result.total !== undefined) {
        const fails = result.results ? result.results.filter(r => !r.success) : [];
        let html = `<div class="alert alert-success">执行完成！成功 ${result.successCount} 条，失败 ${result.failCount} 条</div>`;
        if (fails.length > 0) {
          html += '<div style="max-height:200px;overflow:auto;margin-top:8px;font-size:12px;">' +
            fails.map(f => `<div style="color:#e53e3e;padding:2px 0;">✗ ${f.sql ? f.sql.substring(0, 100) : ''}: ${f.error}</div>`).join('') +
            '</div>';
        }
        container.innerHTML = html;
      }
      // 刷新数据
      if (selectedTable) loadTableData();
      refreshTables();
    } else {
      container.innerHTML = `<div class="alert alert-error">导入失败: ${result.error}</div>`;
    }
    fileInput.value = '';
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">导入失败: ${err.message}</div>`;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 保留旧函数名作为别名（兼容可能的外部引用）
async function exportTableCSV() { await doExportCSV(); }
async function exportTableSQL() { await doExportSQL(); }
async function exportDatabaseSQL() { await doExportSQL(); }
async function importFile() { await doImport(); }

// ==================== 外键管理 ====================
let fkManagerTable = '';

async function showFKManager(tableName) {
  fkManagerTable = tableName;
  document.getElementById('fkManagerTableName').textContent = tableName;
  document.getElementById('fkAddSection').style.display = 'none';
  document.getElementById('fkManagerMsg').innerHTML = '';
  await loadFKList();
  showModal('fkManagerModal');
}

async function loadFKList() {
  const container = document.getElementById('fkManagerList');
  container.innerHTML = '<p class="placeholder-text">加载中...</p>';

  try {
    const resp = await fetch(`/table/foreign-keys/${encodeURIComponent(fkManagerTable)}?database=${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    if (!result.success) {
      container.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      return;
    }

    const fks = result.foreignKeys || [];
    if (fks.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">暂无外键约束</p>';
      return;
    }

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f7f8fa;">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">约束名</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">字段</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">关联表</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">关联字段</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">删除规则</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">更新规则</th>
            <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e8e8e8;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${fks.map(fk => `
            <tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:8px 12px;">${escapeHtml(fk.constraintName || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(fk.columnName || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(fk.refTable || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(fk.refColumn || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(fk.deleteRule || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(fk.updateRule || '')}</td>
              <td style="padding:8px 12px;text-align:center;">
                <button class="btn btn-sm btn-danger" onclick="dropForeignKey('${escapeAttr(fk.constraintName)}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">加载失败: ${err.message}</div>`;
  }
}

async function loadFkRefTables() {
  try {
    const resp = await fetch(`/database/tables/${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    const sel = document.getElementById('fkAddRefTable');
    if (result.success) {
      sel.innerHTML = '<option value="">-- 选择表 --</option>' +
        result.tables.map(t => `<option value="${t}">${t}</option>`).join('');
    }
  } catch (e) { /* ignore */ }
}

async function onFkAddRefTableChange() {
  const refTable = document.getElementById('fkAddRefTable').value;
  const fieldSel = document.getElementById('fkAddRefField');
  if (!refTable) {
    fieldSel.innerHTML = '<option value="">-- 先选表 --</option>';
    return;
  }
  fieldSel.innerHTML = '<option value="">加载中...</option>';
  try {
    const resp = await fetch(`/data/columns/${encodeURIComponent(refTable)}?database=${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    if (result.success && result.columns) {
      fieldSel.innerHTML = '<option value="">-- 选择关联字段 --</option>' +
        result.columns.map(c => `<option value="${c.Field}">${c.Field}</option>`).join('');
    }
  } catch (e) {
    fieldSel.innerHTML = '<option value="">-- 加载失败 --</option>';
  }
}

async function addForeignKey() {
  const colName = document.getElementById('fkAddColName').value.trim();
  const refTable = document.getElementById('fkAddRefTable').value;
  const refField = document.getElementById('fkAddRefField').value;
  const onDelete = document.getElementById('fkAddOnDelete').value;
  const onUpdate = document.getElementById('fkAddOnUpdate').value;

  if (!colName) { alert('请输入本表字段名'); return; }
  if (!refTable) { alert('请选择关联表'); return; }
  if (!refField) { alert('请选择关联字段'); return; }

  const msgDiv = document.getElementById('fkManagerMsg');
  msgDiv.innerHTML = '<div style="color:#888;">正在添加外键...</div>';

  try {
    const resp = await fetch('/table/foreign-key/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableName: fkManagerTable,
        database: currentDatabase,
        column: colName,
        refTable,
        refColumn: refField,
        onDelete,
        onUpdate
      })
    });
    const result = await resp.json();
    if (result.success) {
      msgDiv.innerHTML = '<div class="alert alert-success">外键添加成功</div>';
      document.getElementById('fkAddColName').value = '';
      document.getElementById('fkAddRefTable').value = '';
      document.getElementById('fkAddRefField').innerHTML = '<option value="">-- 先选表 --</option>';
      document.getElementById('fkAddSection').style.display = 'none';
      await loadFKList();
    } else {
      msgDiv.innerHTML = `<div class="alert alert-error">添加失败: ${result.error}</div>`;
    }
  } catch (err) {
    msgDiv.innerHTML = `<div class="alert alert-error">添加失败: ${err.message}</div>`;
  }
}

async function dropForeignKey(constraintName) {
  showConfirm('删除外键', `确定要删除外键约束 "${constraintName}" 吗？`, async () => {
    try {
      const resp = await fetch('/table/foreign-key/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: fkManagerTable,
          database: currentDatabase,
          constraintName
        })
      });
      const result = await resp.json();
      if (result.success) {
        document.getElementById('fkManagerMsg').innerHTML = '<div class="alert alert-success">外键已删除</div>';
        await loadFKList();
      } else {
        document.getElementById('fkManagerMsg').innerHTML = `<div class="alert alert-error">删除失败: ${result.error}</div>`;
      }
    } catch (err) {
      document.getElementById('fkManagerMsg').innerHTML = `<div class="alert alert-error">删除失败: ${err.message}</div>`;
    }
  });
}

// ==================== 触发器管理 ====================
let triggerManagerTable = '';

async function showTriggerManager(tableName) {
  triggerManagerTable = tableName;
  document.getElementById('triggerManagerTableName').textContent = tableName;
  document.getElementById('triggerManagerMsg').innerHTML = '';
  await loadTriggerList();
  showModal('triggerManagerModal');
}

async function loadTriggerList() {
  const container = document.getElementById('triggerManagerList');
  container.innerHTML = '<p class="placeholder-text">加载中...</p>';

  try {
    const resp = await fetch(`/table/triggers/${encodeURIComponent(triggerManagerTable)}?database=${encodeURIComponent(currentDatabase)}`);
    const result = await resp.json();
    if (!result.success) {
      container.innerHTML = `<div class="alert alert-error">${result.error}</div>`;
      return;
    }

    const triggers = result.triggers || [];
    if (triggers.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:#999;padding:20px;">暂无触发器</p>';
      return;
    }

    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f7f8fa;">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">名称</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">时机</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">事件</th>
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e8e8e8;">语句</th>
            <th style="padding:8px 12px;text-align:center;border-bottom:2px solid #e8e8e8;">操作</th>
          </tr>
        </thead>
        <tbody>
          ${triggers.map(tr => `
            <tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:8px 12px;">${escapeHtml(tr.name || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(tr.timing || '')}</td>
              <td style="padding:8px 12px;">${escapeHtml(tr.event || '')}</td>
              <td style="padding:8px 12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(tr.statement || '')}">${escapeHtml((tr.statement || '').substring(0, 60))}</td>
              <td style="padding:8px 12px;text-align:center;">
                <button class="btn btn-sm" onclick="showEditTrigger('${escapeAttr(tr.name)}', '${escapeAttr(tr.timing || '')}', '${escapeAttr(tr.event || '')}', '${escapeAttr((tr.statement || '').replace(/'/g, "\\'").replace(/\n/g, '\\n'))}')">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="dropTrigger('${escapeAttr(tr.name)}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">加载失败: ${err.message}</div>`;
  }
}

function showCreateTrigger() {
  closeModal('triggerManagerModal');
  document.getElementById('triggerEditTitle').textContent = '新建触发器';
  document.getElementById('triggerEditMode').value = 'create';
  document.getElementById('triggerEditOldName').value = '';
  document.getElementById('triggerName').value = '';
  document.getElementById('triggerTiming').value = 'BEFORE';
  document.getElementById('triggerEvent').value = 'INSERT';
  document.getElementById('triggerBody').value = '';
  document.getElementById('triggerEditMsg').innerHTML = '';
  showModal('triggerEditModal');
}

function showEditTrigger(name, timing, event, statement) {
  closeModal('triggerManagerModal');
  document.getElementById('triggerEditTitle').textContent = '编辑触发器';
  document.getElementById('triggerEditMode').value = 'edit';
  document.getElementById('triggerEditOldName').value = name;
  document.getElementById('triggerName').value = name;
  document.getElementById('triggerTiming').value = timing || 'BEFORE';
  document.getElementById('triggerEvent').value = event || 'INSERT';
  document.getElementById('triggerBody').value = statement || '';
  document.getElementById('triggerEditMsg').innerHTML = '';
  showModal('triggerEditModal');
}

async function saveTrigger() {
  const mode = document.getElementById('triggerEditMode').value;
  const oldName = document.getElementById('triggerEditOldName').value;
  const name = document.getElementById('triggerName').value.trim();
  const timing = document.getElementById('triggerTiming').value;
  const event = document.getElementById('triggerEvent').value;
  const body = document.getElementById('triggerBody').value.trim();

  if (!name) { alert('请输入触发器名称'); return; }
  if (!body) { alert('请输入触发器 SQL 语句'); return; }

  const msgDiv = document.getElementById('triggerEditMsg');
  msgDiv.innerHTML = '<div style="color:#888;">正在保存...</div>';

  try {
    const url = mode === 'create' ? '/table/trigger/create' : '/table/trigger/update';
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableName: triggerManagerTable,
        database: currentDatabase,
        triggerName: name,
        oldTriggerName: oldName,
        timing,
        event,
        body
      })
    });
    const result = await resp.json();
    if (result.success) {
      closeModal('triggerEditModal');
      await loadTriggerList();
      showModal('triggerManagerModal');
    } else {
      msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${result.error}</div>`;
    }
  } catch (err) {
    msgDiv.innerHTML = `<div class="alert alert-error">保存失败: ${err.message}</div>`;
  }
}

async function dropTrigger(triggerName) {
  showConfirm('删除触发器', `确定要删除触发器 "${triggerName}" 吗？`, async () => {
    try {
      const resp = await fetch('/table/trigger/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName: triggerManagerTable,
          database: currentDatabase,
          triggerName
        })
      });
      const result = await resp.json();
      if (result.success) {
        document.getElementById('triggerManagerMsg').innerHTML = '<div class="alert alert-success">触发器已删除</div>';
        await loadTriggerList();
      } else {
        document.getElementById('triggerManagerMsg').innerHTML = `<div class="alert alert-error">删除失败: ${result.error}</div>`;
      }
    } catch (err) {
      document.getElementById('triggerManagerMsg').innerHTML = `<div class="alert alert-error">删除失败: ${err.message}</div>`;
    }
  });
}

// ==================== 辅助函数 ====================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
