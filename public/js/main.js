// 通用工具函数
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function showModal(id) {
  document.getElementById(id).style.display = 'flex';
}

// 确认对话框
let confirmCallback = null;

function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  showModal('confirmModal');
}

document.addEventListener('DOMContentLoaded', () => {
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  if (confirmOkBtn) {
    confirmOkBtn.addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      closeModal('confirmModal');
    });
  }
});

// 点击模态框外部关闭
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.style.display = 'none';
  }
});

// 切换内容标签页
function switchContentTab(tab) {
  document.querySelectorAll('.ctab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.content-panel').forEach(c => c.classList.remove('active'));
  document.querySelector(`[onclick="switchContentTab('${tab}')"]`).classList.add('active');
  document.getElementById(`content-${tab}`).classList.add('active');
  // 切换到导入导出标签时初始化下拉框
  if (tab === 'export' && typeof initExportDbSelect === 'function') {
    initExportDbSelect();
  }
}
