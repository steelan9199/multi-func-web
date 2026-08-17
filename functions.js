// 功能中心 · 中心配置
// 新增功能只需：1) 在此数组加一项；2) 在 functions/<id>/ 下建 index.html + index.js
window.FUNCTIONS = [
  {
    id: "skill-link",
    name: "技能链接生成器",
    icon: "🔗",
    desc: "输入技能名，一键生成 GitHub 链接并复制到剪贴板",
  },
  {
    id: "filename-fix",
    name: "文件名纠错",
    icon: "🧹",
    desc: "清理文件名里的特殊符号，输出 Windows 安全可用的干净文件名",
  },
  {
    id: "color-wheel",
    name: "色轮取色器",
    icon: "🎨",
    desc: "鼠标移到色轮读取像素颜色，按 C 切换 HEX/RGB，单击复制",
  },
];
