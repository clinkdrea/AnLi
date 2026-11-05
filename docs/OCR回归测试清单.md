# OCR 中心回归测试清单

> 生成日期：2026-11-05
> 覆盖引擎：RapidOCR / PaddleOCR / macOS Vision / Docling（MinerU 暂时下线）
> 后端：Node 22 + Fastify + SQLite（node:sqlite）
> Python：优先 `/opt/homebrew/bin/python3.11`，退化到 `python3`

---

## 0. 启动前检查（Pre-check）

| # | 检查项 | 命令 | 期望 |
|---|---|---|---|
| 0.1 | 后端健康 | `curl -s http://localhost:3000/api/health` | `{"ok":true,...}` |
| 0.2 | 有可用 Python | `for c in /opt/homebrew/bin/python3.11 python3.11 python3 python; do $c --version && break; done` | 任意一个能跑 |
| 0.3 | python3.11 依赖 | `/opt/homebrew/bin/python3.11 -c "import fitz, paddleocr, docling, rapidocr_onnxruntime"` | 无 ImportError |
| 0.4 | 端口没被占 | `lsof -iTCP:3000 -sTCP:LISTEN -P -n` | 有 node 进程监听 |
| 0.5 | 后端错误日志 | 看 concurrently 终端 | 无 `EADDRINUSE` / `SyntaxError` / `ERR_INVALID_CHAR` |

---

## 1. 引擎功能（4 个可用引擎）

| # | 场景 | 命令/操作 | 期望 | 备注 |
|---|---|---|---|---|
| 1.1 | RapidOCR 普通 PDF | 创建任务，引擎选 RapidOCR | done，total_pages=实际页数，merged_text 非空 | |
| 1.2 | PaddleOCR 普通 PDF | 同上，引擎 PaddleOCR | done，结果比 RapidOCR 更完整 | 修复过：必须 numpy array 不能 bytes |
| 1.3 | macOS Vision 普通 PDF | 同上，引擎 Vision | done，正确识别全文 | Vision 不是只能图片，PDF 多页也能 |
| 1.4 | Docling 普通 PDF | 同上，引擎 Docling | done，版面+表格都对 | 一次性处理整个 PDF，快且准 |
| 1.5 | 图片文件 | 引擎 Vision，输入 `.jpg` | done，1 页 | Vision 图片专用 |
| 1.6 | 特殊字符文件名 | `辩护意见（马志钦）.pdf` | 4 引擎都 done | 路径里中文/括号/冒号不能崩 |
| 1.7 | 多页 PDF（6 页） | `刑事裁定书.pdf` | total_pages=6，done_pages 跑满 | 修复过：`import()` 没 await 导致 total_pages=1 |
| 1.8 | 超大文件（301 页） | Vision 引擎 | total_pages=301 | 只测页数识别，不一定跑完 |
| 1.9 | Docling 整文件处理 | 任何 PDF | done，版面完整 | Docling 是一次性 convert，不支持分页处理 |

---

## 2. 文件创建路由（四种来源）

| # | 来源 | 接口 | 期望 | 备注 |
|---|---|---|---|---|
| 2.1 | 案件文件（from-file） | `POST /api/ocr/jobs/from-file` | job_ids[]，每个 total_pages 正确 | 修复过：`fitz.open()` 漏传路径 |
| 2.2 | 本地路径（from-path） | `POST /api/ocr/jobs/from-path` | count + output_dir | 支持文件夹批量 |
| 2.3 | 浏览器上传（upload） | `POST /api/ocr/upload` | job_id[] | 修复过：`fitz.open()` 空参数 |
| 2.4 | 批量 from-files | 多个 file_id | 全部创建成功，errors 明细 | |
| 2.5 | from-file 传不存在的 file_id | file_id=99999 | `{"error":"文件不存在","errors":[...]}` | 不 500 |
| 2.6 | from-path 传不存在的路径 | `/tmp/does_not_exist.pdf` | `{"error":"路径不存在"}` | 不 500 |
| 2.7 | total_pages 为 1 兜底 | 非 PDF 文件（图片） | total_pages=1 | |
| 2.8 | total_pages 正确算页数 | 任意 PDF | 和 `python3.11 -c "import fitz; ..."` 结果一致 | |

---

## 3. 任务生命周期

| # | 操作 | 期望 | 备注 |
|---|---|---|---|
| 3.1 | 创建任务 | 立即返回，DB 状态 pending/processing | |
| 3.2 | Cancel 运行中 | SIGUSR2 → 3s 后 SIGKILL，DB canceled | |
| 3.3 | Cancel 等待队列中 | 从 waitingQueue 移除，DB canceled | 修复过：cancelJob 没处理 waitingQueue |
| 3.4 | Pause 运行中 | SIGUSR1 → 状态 paused，Python 进入 sleep 循环 | |
| 3.5 | Resume 暂停中 | **再发 SIGUSR1** → paused=False → 继续 | 修复过：PaddleOCR 只能置 True 不会置 False（改成 toggle）|
| 3.6 | Retry 失败任务 | 清 ocr_pages → 重置 pending → 重跑 | |
| 3.7 | Delete 运行中任务 | cancelJob + 删结果目录 + 删 DB + 删 ocr_pages | |
| 3.8 | Delete 等待队列任务 | waitingQueue 移除 + DB 删除 | |
| 3.9 | Delete + 立即新建同文件 | 新任务立即 start，不被旧残留影响 | DELETE 本身没问题 |
| 3.10 | MinerU 任务 | 三层拒绝：前端 disabled → 调度器 startJob 直接 failed → Python 引擎 fatal | 暂时下线 |

---

## 4. 并发调度

| # | 场景 | 期望 | 备注 |
|---|---|---|---|
| 4.1 | 同时点 5 个任务 | processing ≤ MAX_CONCURRENT，超出排队 | Mac mini 16GB 时 MAX=4 |
| 4.2 | 混合引擎并发 | PaddleOCR + RapidOCR + Vision 同时 | 不崩 |
| 4.3 | Cancel 一个 processing → 下一个自动 dispatch | activeCount 释放 + tryDispatch 取下一个 | |
| 4.4 | Cancel 一个 waiting → 下一个自动 dispatch | 同上 | |
| 4.5 | 等 active 全跑满时再创建 | 新任务 waitingQueue 排队 | |
| 4.6 | 并发上限公式 | `Math.max(1, Math.min(4, Math.floor(MEM_GB / 4)))` | 8GB→1, 16GB→4, 32GB→4 |

---

## 5. 重启恢复（三层保险）

| # | 场景 | 期望 | 备注 |
|---|---|---|---|
| 5.1 | 后端重启（tsx watch 热重载）| pending 任务被 recoverJobsOnStartup 捞起 | SQL 必须包含 pending：`WHERE status IN ('paused','processing','pending')` |
| 5.2 | 后端重启 → processing 任务 | 续跑（断点续做：已 done 的页跳过） | |
| 5.3 | 后端重启 → paused 任务 | 自动恢复 processing | |
| 5.4 | **定时巡检兜底**（15s 一次）| DB 里 pending 但不在 activeCount/waitingQueue 的自动 start | 最后防线，修复过内存状态丢了卡死 |
| 5.5 | 手动 DB 改 pending → 不重启 → 等 15s | 自动被巡检捞起 | 刚测过生效 |
| 5.6 | 巡检 SQL 空集合处理 | activeCount 和 waitingQueue 都空时用 `WHERE status='pending'`，不能拼 `id NOT IN ()` | 语法错误 |

---

## 6. 错误处理

| # | 场景 | 期望 | 备注 |
|---|---|---|---|
| 6.1 | SQLite `LEFT()` 函数 | 改用 `substr(text, 1, 200)` | MySQL-only 函数，SQLite 没有 |
| 6.2 | Python 引擎 init 失败 | try/catch 保护，后端继续监听 3000 | |
| 6.3 | Python 子进程 SIGSEGV | 只影响当前任务，Node 主进程不退出 | `uncaughtException` handler |
| 6.4 | PaddleOCR 3.x 传 bytes | **不接受！必须 numpy array 或文件路径** | 静默忽略返回空结果，难排查 |
| 6.5 | RapidOCR 传 bytes | 能接受 | 两个引擎行为不同 |
| 6.6 | 引擎模型目录锁冲突（PaddleOCR）| 避免多实例同时 init | 单进程串行基本不会撞 |
| 6.7 | startJob route handler race condition | **必须 await startJob() 再 return** | `.catch(() => {})` 吞错 + 先 return 200 |
| 6.8 | 过期清理定时 | 每小时跑，清理终态 + 超过 N 天的任务 + 结果目录 | ocr_retention_days 默认 14 |
| 6.9 | MAX_CONCURRENT 计算 | 退化到 1 至少能跑 | os.totalmem() 异常时 |

---

## 7. 已知坑（踩过的）

| # | 坑 | 现象 | 正确做法 |
|---|---|---|---|
| K1 | `import('node:child_process').then(...)` 没 await | total_pages 永远是 1 | `const { execFileSync } = await import(...)` |
| K2 | `fitz.open()` 漏传路径参数 | 永远抛异常 → catch → total_pages=1 | `fitz.open("${safePath}")` |
| K3 | PaddleOCR 3.x `predict(bytes)` 静默忽略 | 返回空 dict → `rec_texts` 不存在 → 空结果 | 传 numpy array 或文件路径 string |
| K4 | SQLite 没有 `LEFT()` 函数 | detail 接口 500 | 用 `substr(col, 1, 200)` |
| K5 | PauseToken 用同一个 SIGUSR1 做 pause 和 resume | Resume 后 paused=True 永远不恢复 | 改成 toggle：`self.paused = not self.paused` |
| K6 | MINERU 先 return 200 再 .catch() | startJob reject 客户端看不到错误 | 必须 await 后再 return |
| K7 | ESM 里用 `require()` | TypeScript 不报错，tsx 运行时报 `require is not a function` | 统一用 ESM import |
| K8 | Python 找错解释器 | 系统 python3.9 没装 PaddleOCR | `findPython()` 优先 `/opt/homebrew/bin/python3.11` |
| K9 | 文件名含 ASCII 括号 `()` | HTTP header `filename="第6(7)卷.pdf"` 抛 `ERR_INVALID_CHAR` | RFC 5987：同时传 `filename="_6_7__.md"` 和 `filename*=UTF-8''urlencode%E7%AC%AC6(7)%E5%8D%B7.md` |
| K10 | concurrently 没配自动重启 | Python 崩了带死 Node → tsx watch 不知道拉回 | `--restart-tries -1 --restart-after 2000 --kill-others-on-fail` |
| K11 | 后端启动 OCR 相关调用没 try/catch | OCR init 任何异常 → 整个后端崩 | 三处都用 try/catch 包 |
| K12 | recoverJobsOnStartup 漏 pending | 重启后 pending 永远 pending | SQL 加 `pending` + 定时巡检兜底 |

---

## 8. 测试文件路径（真实素材）

```
刑事裁定书.pdf                    — 6 页，正常大小
辩护意见（马志钦）.pdf             — 3 页，含中文括号
立功材料.pdf                      — 22 页
第6(7)卷.pdf                      — 169 页，2.7GB，含 ASCII 括号
第5卷:共7卷（6CD）.pdf            — 含中文冒号、全角括号
WechatIMG8508.jpg                 — 图片测试
2023-06-09-13-58-37-...-1.jpg    — 长文件名
```

---

## 9. 快速验证命令

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"account":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 看所有任务状态
curl -s http://localhost:3000/api/ocr/jobs -H "authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); jobs=d if isinstance(d,list) else d.get('jobs',[])
  [print(f'  job={j[\"id\"]}  {j[\"engine\"]:<12} {j[\"status\"]:<12} pages={j.get(\"done_pages\") or 0}/{j[\"total_pages\"]}')
   for j in sorted(jobs, key=lambda x:-x['id'])[:10]]"

# 直接查 DB
sqlite3 server/data/anli.db "SELECT id,status,engine,total_pages FROM ocr_jobs ORDER BY id DESC LIMIT 10;"

# 看 Python OCR 进程
ps aux | grep ocr_engine | grep -v grep

# 手动触发巡检捞起
sqlite3 server/data/anli.db "UPDATE ocr_jobs SET status='pending' WHERE id=X;"
# 等 15 秒看日志
```

---

## 10. 待补测试

- [ ] MinerU Precision VLM 恢复后（需要 Cloud Token）
- [ ] Docling 大文件断点续做（Docling 一次性处理整个 PDF，不支持分页）
- [ ] 定时巡检的 SQL 空集合边界（已手动测过，但没写自动化）
- [ ] 浏览器上传接口的 multipart 边界（文件 0 字节 / 超大 / 非 PDF）
- [ ] 前端 OcrCenter.tsx 的交互测试（需要 Playwright / Cypress）
