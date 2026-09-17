# 案理（AnLi）· 律师案件协作平台

律师团队日常案件协作、文书管理、任务跟进的全栈应用。

- 后端：Fastify + SQLite（node:sqlite）
- 前端：React + TypeScript + Tailwind CSS + Vite
- 鉴权：JWT + Cookie，7 天过期
- AI 助手：支持本地 Ollama 或 OpenAI 兼容接口

## 一、环境准备

- Node.js **v22+**（使用了内置 `node:sqlite` 模块）
- npm 或兼容包管理器
- （可选）[Ollama](https://ollama.com) 本地大模型，用于 AI 助手功能

## 二、安装

```bash
# 在项目根目录执行
npm install
```

## 三、首次配置（必读）

1. 复制环境变量模板：

   ```bash
   cp server/.env.example server/.env
   ```

2. 编辑 `server/.env`，按本地实际情况修改（**此文件不会上传 GitHub**）：

   | 变量 | 说明 | 默认值 |
   |---|---|---|
   | `ANLI_DATA_DIR` | 数据根目录（SQLite 数据库存放处） | `./data` |
   | `ANLI_TEMPLATES_DIR` | 文书模板目录，可指向本地原始模板库 | `./data/templates` |
   | `PORT` | 后端服务端口 | `3000` |
   | `JWT_SECRET` | JWT 签名密钥，**生产环境务必改长随机串** | 占位符 |
   | `OLLAMA_URL` | 本地 Ollama 服务地址（方式一） | `http://localhost:11434` |
   | `AI_MODEL` | AI 模型名 | `qwen3:8b` |
   | `OPENAI_BASE_URL` / `OPENAI_API_KEY` | 外部 OpenAI 兼容接口（方式二，留空则不启用） | — |

## 四、启动开发服务（前后端并发）

```bash
# 在项目根目录执行
npm run dev
```

此命令会通过 `concurrently` 同时启动：
- 后端（tsx watch）：`http://localhost:3000`（API 服务）
- 增删改代码自动热重载，无需手动重启
- 前端（Vite）：`http://localhost:5173`（开发服务器）

## 五、访问应用

浏览器打开 **http://localhost:5173** 即可。

> Vite 开发服务器已配置代理，`/api` 请求自动转发到后端 `localhost:3000`，无需关心跨域。

默认管理员账号：

| 账号 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 系统管理员 |

> ⚠️ 该密码为初始种子账号，仅在本地开发使用。如部署到公网，请登录后尽快在「用户管理」修改密码。

## 六、常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 同时启动前后端开发服务（热重载） |
| `npm run dev -w server` | 仅启动后端 |
| `npm run dev -w client` | 仅启动前端 |
| `npm run build` | 编译前后端产物（server/dist、client/dist） |
| `npm run start -w server` | 生产模式运行后端（需先 build） |
| `npm run preview -w client` | 预览前端构建产物 |

## 七、注意事项

1. **Node.js 版本**：必须 v22+，低于此版本无法使用内置 `node:sqlite`。
2. **端口占用**：启动前确保 3000（后端）和 5173（前端）未被占用；可通过 `lsof -iTCP:3000 -sTCP:LISTEN` 检查。
3. **数据安全**：`server/data/` 下存放 SQLite 数据库与案件资料，含敏感信息，已通过 `.gitignore` 排除，不会上传 GitHub。
4. **文书模板**：`ANLI_TEMPLATES_DIR` 指向的目录为本机路径，项目仓库不保存模板文件；如换电脑需重新配置路径或同步模板目录。
5. **AI 助手**：依赖 Ollama 或外部 API，两者都未配置时 AI Tab 会提示连接失败，不影响其他功能。
6. **停止服务**：在运行 `npm run dev` 的终端按 `Ctrl+C` 即可停止前后端。

## 八、项目结构

```
AnLi/
├── client/              前端（React + Vite）
│   └── src/
│       ├── pages/        页面（Dashboard、Cases、CaseDetail 等）
│       ├── components/   组件（case/ 下为案件详情各 Tab）
│       ├── api.ts        封装 fetch 调用
│       └── constants.ts 前端共享常量（案件类型、状态）
├── server/              后端（Fastify + node:sqlite）
│   ├── src/
│   │   ├── db/           数据库 schema 与种子数据
│   │   ├── routes/        API 路由（cases、tasks、files 等）
│   │   ├── plugins/      鉴权插件
│   │   └── services/     OCR、审计日志等
│   └── .env              本地配置（不上传）
└── package.json          monorepo 根配置
```

## 九、默认功能一览

- 案件 CRUD、搜索筛选、置顶、近期打开
- 案件详情：概览（二次编辑）、看板（拖拽排序）、资料、证据、任务、时间轴、联系人
- 待办事项：列表/日历视图、可关联案件或个人待办、开庭自动生成高优待办
- 文书模板库浏览、从模板/其他案件复制文书到当前案件
- 评论与 AI 助手右侧双 Tab 面板
- OCR 文字识别（依赖 macOS Vision）
- 审计日志、用户管理、权限控制
