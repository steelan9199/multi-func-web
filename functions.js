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
  {
    id: "wechat-publish",
    name: "Markdown 发公众号",
    icon: "📤",
    desc: "输入 .md 绝对路径，编辑配置，一键发到公众号草稿箱（需后台）",
  },
  {
    id: "file-icon",
    name: "文件图标更换器",
    icon: "🖼️",
    desc: "上传 PNG/JPG + 输入目标路径，一键更换文件/文件夹图标（需后台）",
  },
];
