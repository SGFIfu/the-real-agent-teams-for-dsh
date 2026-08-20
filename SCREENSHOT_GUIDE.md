# 📸 截图指南 / Screenshot Guide

本文档说明如何为 **The Real Agent Teams for DSH** 创建展示截图。

---

## 🎯 需要的截图 / Required Screenshots

### 1. 专注模式 (Focus Mode)
**文件名**: `docs/screenshots/focus-mode.png`
**尺寸**: 建议 800x1200 或更大
**内容要求**:
- 显示右侧专注模式侧边栏
- 保留左侧Harness主界面的部分内容
- 展示团队进度、成员状态、最近活动
- 如果有多个团队，显示下拉选择器（新功能）

**截图步骤**:
1. 启动DSH: `dsh --profile web web`
2. 打开浏览器: `http://127.0.0.1:3080/`
3. 点击侧栏的 "Agent Teams" 按钮
4. 选择一个活动团队
5. 确保在 **专注模式** (右侧轻量侧栏)
6. 调整浏览器窗口到合适尺寸
7. 截图工具: Win+Shift+S (Windows) / Cmd+Shift+4 (Mac)

---

### 2. 工作台总览 (Workspace Overview)
**文件名**: `docs/screenshots/workspace-overview.png`
**尺寸**: 建议 1600x1000 或更大（宽屏）
**内容要求**:
- 点击 "展开工作台" 按钮进入完整视图
- 显示 "Overview" 标签页
- 包含：团队指标、Captain卡片、成员状态、进度条
- 如果有多个团队，Captain卡片应显示下拉选择器（新功能✨）

**截图步骤**:
1. 在专注模式点击 "展开工作台" 按钮
2. 确保在 "Overview" 标签
3. 等待数据加载完成
4. 全屏或最大化浏览器窗口
5. 截图完整工作台视图

---

### 3. 成员面板 (Members Panel)
**文件名**: `docs/screenshots/workspace-members.png`
**尺寸**: 建议 1400x900
**内容要求**:
- 切换到 "Members" 标签
- 显示所有团队成员的卡片
- 每个成员显示：头像、名称、角色、状态、当前任务
- 状态颜色清晰可见（working=蓝色, idle=灰色, blocked=黄色等）

**截图步骤**:
1. 在工作台视图点击 "Members" 标签
2. 确保至少有4-6个成员可见
3. 等待所有成员状态加载完成
4. 截图成员网格布局

---

### 4. 任务依赖图 (Task Dependencies)
**文件名**: `docs/screenshots/workspace-dependencies.png`
**尺寸**: 建议 1400x900
**内容要求**:
- 切换到 "Dependencies" 标签
- 显示任务依赖图的层级结构
- 包含任务状态（pending/working/completed/blocked）
- 显示任务所有者信息
- 依赖箭头 ↓ 清晰可见

**截图步骤**:
1. 在工作台视图点击 "Dependencies" 标签
2. 确保任务图有多个层级
3. 等待任务状态更新完成
4. 截图完整任务依赖视图

---

### 5. Agent Inspector
**文件名**: `docs/screenshots/agent-inspector.png`
**尺寸**: 建议 1200x800
**内容要求**:
- 点击任意成员打开Inspector
- 显示4个标签：Activity / Tasks / Messages / Files
- Activity标签应展示Session的公开消息和Tool调用
- 底部有发送消息和中断控制按钮

**截图步骤**:
1. 在工作台的成员卡片上点击
2. 等待Inspector加载
3. 确保在 "Activity" 标签
4. 滚动显示一些消息和Tool调用
5. 截图整个Inspector面板

---

### 6. 语言切换 (Language Toggle)
**文件名**: `docs/screenshots/language-toggle.png`
**尺寸**: 建议 600x400
**内容要求**:
- 显示语言切换按钮（右上角 "中" / "EN"）
- 或者打开设置面板显示自定义标签界面
- 最好截取前后对比图

**截图步骤**:
1. 点击右上角的语言切换按钮
2. 或点击设置按钮⚙打开自定义标签面板
3. 截图设置界面

---

## 📂 目录结构 / Directory Structure

创建以下目录结构：

```
dsh-agent-teams/
├── docs/
│   └── screenshots/
│       ├── focus-mode.png
│       ├── workspace-overview.png
│       ├── workspace-members.png
│       ├── workspace-dependencies.png
│       ├── agent-inspector.png
│       └── language-toggle.png
└── README.md
```

## 🎨 截图最佳实践 / Best Practices

### 1. 屏幕分辨率
- 使用高分辨率显示器（推荐2K或4K）
- 浏览器缩放100%（避免模糊）
- 截图后可适当缩小但保持清晰度

### 2. 数据内容
使用真实的团队示例：
- 团队名称：Tiny Notes 验收团队
- 角色：Lead, Architect, Backend, Frontend, Tester, Reviewer
- 任务：明确的功能开发任务
- 状态：多样化（working/idle/blocked/reviewing/completed）

### 3. 时间点选择
- 团队进度约50-70%（显示进行中状态）
- 至少2-3个任务已完成
- 有些成员working，有些idle
- 有消息和活动记录

### 4. 界面状态
- 所有数据加载完成
- 没有错误提示
- LIVE连接状态显示绿色
- 进度条和状态图标清晰

### 5. 截图工具推荐
**Windows**:
- Win + Shift + S (系统截图)
- Snagit (专业工具)
- ShareX (开源免费)

**Mac**:
- Cmd + Shift + 4 (系统截图)
- Cmd + Shift + 5 (截图工具栏)
- CleanShot X (专业工具)

**浏览器扩展**:
- Awesome Screenshot
- Nimbus Screenshot
- GoFullPage (全页截图)

---

## 🔄 截图后处理 / Post-Processing

### 可选的优化步骤：

1. **裁剪**: 去除多余边框
2. **标注**: 添加箭头和文字说明（可选）
3. **压缩**: 优化文件大小但保持清晰度
   - 推荐工具: TinyPNG, Squoosh, ImageOptim
   - 目标: PNG < 500KB, JPG < 300KB
4. **文件名**: 使用英文小写加连字符
5. **提交**: 使用git lfs（如果文件>100KB）

---

## ✅ 提交清单 / Submission Checklist

准备提交截图前，检查：

- [ ] 所有6张截图都已创建
- [ ] 文件名正确（focus-mode.png等）
- [ ] 放置在 `docs/screenshots/` 目录
- [ ] 截图清晰，分辨率足够
- [ ] 显示真实数据和功能
- [ ] 没有敏感信息（API keys等）
- [ ] 文件大小合理（<1MB）
- [ ] README.md中的图片链接正确

---

## 📤 快速创建示例 / Quick Setup Example

如果你需要快速生成可截图的团队，使用以下Prompt：

```text
Use Agent Teams to build a tiny notes app.

Create these teammates:
- Lead (Architect-架构师): captain role
- Backend (Backend-后端): backend role  
- Frontend (Frontend-前端): frontend role
- Tester (Tester-测试): tester role

Break into tasks:
T1 [Architect] 架构设计与 API 契约
T2 [Backend] 实现 Notes REST API (depends on T1)
T3 [Frontend] 实现 Notes 网页界面 (depends on T1)
T4 [Tester] 编写测试计划与测试用例 (depends on T2, T3)

Run the team and let members work for 2-3 minutes.
Then I will take screenshots.
```

等待团队运行2-3分钟，会产生足够的活动数据供截图使用。

---

## 🎬 视频录制（可选）

如果要制作演示视频：

**工具推荐**:
- OBS Studio (免费开源)
- Loom (在线录制)
- ScreenFlow (Mac专业工具)

**内容建议**:
1. 启动DSH和浏览器 (5秒)
2. 点击Agent Teams按钮 (3秒)
3. 选择团队 (5秒)
4. 展示专注模式 (10秒)
5. 切换到工作台 (5秒)
6. 浏览各个标签 (20秒)
7. 打开Inspector (10秒)
8. 演示团队切换（新功能）(10秒)
9. 语言切换 (5秒)

总时长约60-90秒。

---

**准备好后，执行**:

```bash
# 创建目录
mkdir -p docs/screenshots

# 添加截图文件到git
git add docs/screenshots/*.png

# 提交
git commit -m "docs: add screenshots for README showcase"

# 推送到GitHub
git push origin main
```

截图将在GitHub README上自动显示！🎉
