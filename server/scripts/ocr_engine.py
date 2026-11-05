#!/usr/bin/env python3
"""
案理 OCR 引擎 — 可插拔架构，支持断点续做

用法:
  python3 ocr_engine.py <input_file> [options]

通用选项:
  --engine rapidocr|docling|vision    引擎选择（默认 rapidocr）
  --start-page N                      从第 N 页开始（默认 1，断点续做时传已完成+1）
  --end-page N                        处理到第 N 页（默认 PDF 全部 / 图片固定 1）
  --format markdown|json|plain        输出格式（默认 markdown）
  --output-dir PATH                   单页结果存放目录（默认临时目录）

进度协议 (JSONL stdout):
  {"type": "progress", "page": 5, "total": 20, "status": "done"}
  {"type": "page_text", "page": 5, "text": "...", "path": "..."}
  {"type": "page_error", "page": 5, "error": "..."}
  {"type": "info", "msg": "已跳过 3 个已完成页"}
  {"type": "done", "pages_done": 20, "pages_failed": 0, "elapsed_sec": 45.2}
  {"type": "fatal", "error": "..."}
"""

import sys, os, json, time, argparse, tempfile, signal, traceback

# ========== 公共工具 ==========

def emit(obj: dict):
    """向 stdout 发 JSON 事件（单行），Node.js 逐行解析"""
    print(json.dumps(obj, ensure_ascii=False), flush=True)

class PauseToken:
    """暂停/取消信号
    SIGUSR1 = pause toggle（第一次暂停，第二次恢复）
    SIGUSR2 = cancel
    """
    def __init__(self):
        self.paused = False
        self.canceled = False
        signal.signal(signal.SIGUSR1, self._toggle_pause)
        signal.signal(signal.SIGUSR2, self._on_cancel)
    def _toggle_pause(self, *a):
        self.paused = not self.paused
    def _on_cancel(self, *a):
        self.canceled = True
    def check(self):
        """返回 True 表示应该暂停或退出"""
        if self.canceled:
            emit({"type": "fatal", "error": "任务已取消"})
            sys.exit(130)
        if self.paused:
            emit({"type": "info", "msg": "收到暂停信号，等待恢复..."})
            while self.paused:
                if self.canceled:
                    emit({"type": "fatal", "error": "任务已取消"})
                    sys.exit(130)
                time.sleep(0.5)
            emit({"type": "info", "msg": "恢复执行"})
            return True
        return False

def get_pdf_pages(path: str) -> int:
    """获取 PDF 总页数"""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        n = len(doc)
        doc.close()
        return n
    except ImportError:
        emit({"type": "fatal", "error": "缺少依赖 PyMuPDF: pip install pymupdf"})
        sys.exit(1)

def pdf_page_to_image(path: str, page_num: int, dpi: int = 300) -> bytes:
    """PDF 指定页 → PNG bytes"""
    import fitz
    doc = fitz.open(path)
    page = doc[page_num - 1]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    doc.close()
    return pix.tobytes("png")

# ========== 引擎: RapidOCR ==========

def run_rapidocr(file_path: str, start_page: int, end_page: int, fmt: str, out_dir: str, pause: PauseToken):
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        emit({"type": "fatal", "error": "缺少依赖 RapidOCR: pip install rapidocr-onnxruntime"})
        sys.exit(1)

    ocr = RapidOCR()

    is_pdf = file_path.lower().endswith('.pdf')
    total = get_pdf_pages(file_path) if is_pdf else 1

    page_range = range(max(1, start_page), min(end_page or total, total) + 1)
    done = failed = 0

    emit({"type": "info", "msg": f"RapidOCR 启动，共 {total} 页，处理 {len(list(page_range))} 页"})

    if is_pdf:
        for p in page_range:
            pause.check()
            emit({"type": "progress", "page": p, "total": total, "status": "processing"})
            try:
                img_bytes = pdf_page_to_image(file_path, p)
                result, elapse = ocr(img_bytes)
                if result:
                    # RapidOCR 返回: [[bbox, text, conf], ...]
                    lines = [item[1] for item in result]
                    text = '\n'.join(lines)
                else:
                    text = ''

                # 单页结果持久化
                page_path = os.path.join(out_dir, f'page_{p:05d}.txt')
                os.makedirs(out_dir, exist_ok=True)
                with open(page_path, 'w', encoding='utf-8') as f:
                    f.write(text)

                if text.strip():
                    emit({"type": "page_text", "page": p, "text": text, "path": page_path})
                    done += 1
                else:
                    emit({"type": "page_text", "page": p, "text": "(无文字)", "path": page_path})
                    done += 1  # 无文字也算完成
            except Exception as e:
                failed += 1
                emit({"type": "page_error", "page": p, "error": str(e)})
    else:
        # 图片
        pause.check()
        emit({"type": "progress", "page": 1, "total": 1, "status": "processing"})
        try:
            result, _ = ocr(file_path)
            text = '\n'.join([item[1] for item in result]) if result else ''
            page_path = os.path.join(out_dir, 'page_00001.txt')
            os.makedirs(out_dir, exist_ok=True)
            with open(page_path, 'w', encoding='utf-8') as f:
                f.write(text)
            emit({"type": "page_text", "page": 1, "text": text, "path": page_path})
            done = 1
        except Exception as e:
            failed = 1
            emit({"type": "page_error", "page": 1, "error": str(e)})

    emit({"type": "done", "pages_done": done, "pages_failed": failed})

# ========== 引擎: Vision (macOS，单图快速识别) ==========

def run_vision(file_path: str, start_page: int, end_page: int, fmt: str, out_dir: str, pause: PauseToken):
    """调用 Swift 编译的 vision 二进制（复用现有 ocr.swift 能力）"""
    import subprocess as sp

    is_pdf = file_path.lower().endswith('.pdf')
    total = get_pdf_pages(file_path) if is_pdf else 1

    # 复用项目已编译的 ocr 二进制
    swift_bin = os.path.join(os.path.dirname(__file__), 'ocr')
    if not os.path.exists(swift_bin):
        emit({"type": "fatal", "error": f"Swift OCR 二进制不存在: {swift_bin}（需先 swiftc 编译 ocr.swift）"})
        sys.exit(1)

    page_range = range(max(1, start_page), min(end_page or total, total) + 1)
    done = failed = 0

    if is_pdf:
        for p in page_range:
            pause.check()
            emit({"type": "progress", "page": p, "total": total, "status": "processing"})
            try:
                import tempfile
                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                    tmp.write(pdf_page_to_image(file_path, p))
                    img_path = tmp.name
                try:
                    text = sp.run([swift_bin, img_path], capture_output=True, text=True, timeout=60).stdout.strip()
                finally:
                    os.unlink(img_path)

                page_path = os.path.join(out_dir, f'page_{p:05d}.txt')
                os.makedirs(out_dir, exist_ok=True)
                with open(page_path, 'w', encoding='utf-8') as f:
                    f.write(text)

                emit({"type": "page_text", "page": p, "text": text, "path": page_path})
                done += 1
            except Exception as e:
                failed += 1
                emit({"type": "page_error", "page": p, "error": str(e)})
    else:
        pause.check()
        emit({"type": "progress", "page": 1, "total": 1, "status": "processing"})
        try:
            text = sp.run([swift_bin, file_path], capture_output=True, text=True, timeout=60).stdout.strip()
            page_path = os.path.join(out_dir, 'page_00001.txt')
            os.makedirs(out_dir, exist_ok=True)
            with open(page_path, 'w', encoding='utf-8') as f:
                f.write(text)
            emit({"type": "page_text", "page": 1, "text": text, "path": page_path})
            done = 1
        except Exception as e:
            failed = 1
            emit({"type": "page_error", "page": 1, "error": str(e)})

    emit({"type": "done", "pages_done": done, "pages_failed": failed})

# ========== 引擎: Docling（预留接口，装好后启用） ==========

def run_docling(file_path: str, start_page: int, end_page: int, fmt: str, out_dir: str, pause: PauseToken):
    """Docling 引擎：版面分析 + 表格/公式 + OCR（自动判断电子 PDF vs 扫描件）"""
    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        emit({"type": "fatal", "error": "缺少依赖 Docling: pip install docling（需 Python 3.10+）"})
        sys.exit(1)

    emit({"type": "info", "msg": "Docling 加载模型中（首次使用约需 3-5 分钟下载模型，后续秒级加载）..."})

    try:
        converter = DocumentConverter()
    except Exception as e:
        emit({"type": "fatal", "error": f"Docling 初始化失败: {e}"})
        sys.exit(1)

    is_pdf = file_path.lower().endswith('.pdf')
    total = get_pdf_pages(file_path) if is_pdf else 1
    page_range = range(max(1, start_page), min(end_page or total, total) + 1)

    emit({"type": "info", "msg": f"Docling 转换 {os.path.basename(file_path)}，共 {total} 页，处理 {len(list(page_range))} 页"})

    # Docling 一次性转换整个文档（快且版面完整）
    try:
        pause.check()
        emit({"type": "progress", "page": 0, "total": total, "status": "processing", "hint": "Docling 版面分析中..."})
        result = converter.convert(file_path)
    except Exception as e:
        emit({"type": "fatal", "error": f"Docling 转换失败: {e}"})
        sys.exit(1)

    # 从 docling result 中提取每页文本
    try:
        doc = result.document

        # 用 docling 自带的 export 方法，按 page 切分
        # export_to_markdown() 会保留版面结构（标题、列表、表格等）
        page_texts: dict[int, list[str]] = {}

        for item, level in doc.iterate_items():
            pn = 1
            # docling item 的 provenance 里有 page_no
            prov_list = getattr(item, 'prov', []) or []
            if prov_list:
                pn = getattr(prov_list[0], 'page_no', 1) or 1

            # 优先用 item.text（TextItem/ListItem/TableCell 等有），
            # 否则尝试 item.orig，再不行就跳过（Image/Figure 等不贡献文本）
            text = ''
            if hasattr(item, 'text') and item.text:
                text = str(item.text)
            elif hasattr(item, 'orig') and item.orig:
                text = str(item.orig)

            if text.strip():
                if pn not in page_texts:
                    page_texts[pn] = []
                page_texts[pn].append(text)

        # 逐页处理 + 写文件
        done = failed = 0
        for p in page_range:
            pause.check()
            emit({"type": "progress", "page": p, "total": total, "status": "processing"})
            try:
                text_lines = page_texts.get(p, [])
                text = '\n'.join(text_lines)

                page_path = os.path.join(out_dir, f'page_{p:05d}.txt')
                os.makedirs(out_dir, exist_ok=True)
                with open(page_path, 'w', encoding='utf-8') as f:
                    f.write(text)

                emit({"type": "page_text", "page": p, "text": text[:2000], "path": page_path})
                done += 1
            except Exception as e:
                failed += 1
                emit({"type": "page_error", "page": p, "error": str(e)})

        emit({"type": "progress", "page": total, "total": total, "status": "done",
              "summary": f"Docling 完成，成功 {done} 页，失败 {failed} 页"})

        # 保存完整的 docling 导出（markdown/json/html）
        base = os.path.splitext(os.path.basename(file_path))[0]
        os.makedirs(out_dir, exist_ok=True)

        try:
            if fmt in ('markdown', 'docx', 'plain'):
                md_text = doc.export_to_markdown()
                with open(os.path.join(out_dir, f'{base}.md'), 'w', encoding='utf-8') as f:
                    f.write(md_text)
                emit({"type": "info", "msg": f"Docling markdown 已导出: {base}.md"})
            if fmt == 'json':
                import json as _json
                json_data = doc.export_to_dict()
                with open(os.path.join(out_dir, f'{base}.json'), 'w', encoding='utf-8') as f:
                    _json.dump(json_data, f, ensure_ascii=False, indent=2)
                emit({"type": "info", "msg": f"Docling json 已导出: {base}.json"})
        except Exception as e:
            emit({"type": "info", "msg": f"Docling 完整导出跳过（不影响分页结果）: {e}"})

        # 触发后处理（docx/plain 等）
        final = postprocess(fmt, out_dir, file_path)
        if final.get('final_path'):
            emit({"type": "postprocess_done", "final_path": final['final_path'], "final_format": final.get('fmt', fmt)})

    except Exception as e:
        emit({"type": "fatal", "error": f"Docling 结果解析失败: {e}"})
        sys.exit(1)

# ========== 引擎: PaddleOCR（高精度，中英混合 + 方向分类） ==========

def run_paddleocr(file_path: str, start_page: int, end_page: int, fmt: str, out_dir: str, pause: PauseToken):
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        emit({"type": "fatal", "error": "缺少 PaddleOCR 依赖。安装：\n  /opt/homebrew/bin/python3.11 -m pip install paddlepaddle paddleocr\n（首次运行会自动下载模型 ~20MB）"})
        sys.exit(1)

    emit({"type": "info", "msg": "PaddleOCR 初始化（首次运行会自动下载方向分类+检测+识别模型，约 20MB）..."})

    # 新版 PaddleOCR（3.x）不再接受 use_gpu / show_log / cls 等参数
    # 方向分类用 use_textline_orientation=True；旧版用 use_angle_cls=True
    try:
        ocr = PaddleOCR(use_textline_orientation=True, lang='ch')
    except TypeError:
        # 兼容 PaddleOCR 2.x 旧版参数
        try:
            ocr = PaddleOCR(use_angle_cls=True, lang='ch', use_gpu=False)
        except TypeError:
            ocr = PaddleOCR(lang='ch')

    is_pdf = file_path.lower().endswith('.pdf')
    total = get_pdf_pages(file_path) if is_pdf else 1

    page_range = range(max(1, start_page), min(end_page or total, total) + 1)
    done = failed = 0

    # 3.x 新版用 predict()，2.x 旧版用 ocr()
    # 注意：3.x 也有 ocr 属性，但它是 deprecated 装饰器代理，内部实际调 predict
    _use_predict = hasattr(ocr, 'predict')

    def _run_ocr(path_or_bytes):
        if _use_predict:
            return ocr.predict(path_or_bytes)
        return ocr.ocr(path_or_bytes)

    emit({"type": "info", "msg": f"PaddleOCR 启动，共 {total} 页，处理 {len(list(page_range))} 页"})

    def _extract_texts_from_result(result) -> str:
        """PaddleOCR 不同版本返回格式略有差异，这里统一处理。

        常见格式（单页）：
          [[bbox, (text, conf), cls_info]]              # 版本 2.x
          [[[bbox, (text, conf)], ...], [[cls]]]         # 带方向分类
          [[{'rec_texts': [...], 'rec_scores': [...], 'dt_polys': [...]}]]  # 版本 3.x
        """
        if result is None:
            return ''
        texts = []

        # PaddleOCR 3.x: 第一个元素是 dict
        if isinstance(result, dict):
            texts.extend(result.get('rec_texts', []) or [])
        elif isinstance(result, list) and result:
            first = result[0]
            if isinstance(first, dict):
                texts.extend(first.get('rec_texts', []) or [])
            elif isinstance(first, list):
                # 2.x: [[bbox, (text, conf), ...], ...] 或 [[bbox, text, conf], ...]
                for item in result:
                    if not item: continue
                    if isinstance(item, list):
                        # item = [bbox, (text, conf)] 或 [bbox, text, conf] 或 [bbox, (text, conf), cls]
                        # 取中间项
                        mid = item[1] if len(item) > 1 else None
                        if isinstance(mid, (list, tuple)) and mid:
                            texts.append(str(mid[0]))
                        elif isinstance(mid, str):
                            texts.append(mid)
                    elif isinstance(item, dict):
                        t = item.get('rec_text') or item.get('text')
                        if t: texts.append(t)
        return '\n'.join(t for t in texts if t)

    if is_pdf:
        # 预先打开 PDF（PaddleOCR 3.x 不接受 bytes，必须 numpy array 或文件路径）
        import numpy as np
        import fitz as _fitz
        _pdf = _fitz.open(file_path)
        for p in page_range:
            pause.check()
            emit({"type": "progress", "page": p, "total": total, "status": "processing"})
            try:
                page = _pdf[p - 1]
                pix = page.get_pixmap(matrix=_fitz.Matrix(300/72, 300/72), alpha=False)
                img_array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                result = _run_ocr(img_array)
                text = _extract_texts_from_result(result)

                page_path = os.path.join(out_dir, f'page_{p:05d}.txt')
                os.makedirs(out_dir, exist_ok=True)
                with open(page_path, 'w', encoding='utf-8') as f:
                    f.write(text)

                if text.strip():
                    emit({"type": "page_text", "page": p, "text": text, "path": page_path})
                    done += 1
                else:
                    emit({"type": "page_text", "page": p, "text": "(无文字)", "path": page_path})
                    done += 1
            except Exception as e:
                failed += 1
                emit({"type": "page_error", "page": p, "error": str(e)})
        _pdf.close()
    else:
        # 图片
        pause.check()
        emit({"type": "progress", "page": 1, "total": 1, "status": "processing"})
        try:
            result = _run_ocr(file_path)
            text = _extract_texts_from_result(result)

            page_path = os.path.join(out_dir, 'page_00001.txt')
            os.makedirs(out_dir, exist_ok=True)
            with open(page_path, 'w', encoding='utf-8') as f:
                f.write(text)

            emit({"type": "page_text", "page": 1, "text": text, "path": page_path})
            done = 1
        except Exception as e:
            failed = 1
            emit({"type": "page_error", "page": 1, "error": str(e)})

    emit({"type": "done", "pages_done": done, "pages_failed": failed})

# ========== 引擎: MinerU（MinerU Cloud，Agent Pipeline 免 Token + Precision VLM 需 Token） ==========

def run_mineru(file_path: str, start_page: int, end_page: int, fmt: str, out_dir: str, pause: PauseToken):
    """MinerU Cloud API 引擎。

    两种模式自动选择：
    - Agent Pipeline（免 Token，默认）：/api/v1/agent/parse/file → /api/v1/agent/parse/{task_id} 轮询
      输出：仅 Markdown（CDN 链接），≤ 10MB ≤ 20 页，固定 pipeline 轻量模型
    - Precision VLM（需 Token）：/api/v4/file-urls/batch → /api/v4/extract-results/batch/{batch_id} 轮询
      输出：ZIP 含 Markdown + JSON，≤ 200MB ≤ 600 页，可设 model_version=pipeline/vlm/MinerU-HTML

    Token 来自环境变量 MINERU_API_TOKEN（Node 调度器从 settings 读取注入）。
    """
    import urllib.request
    import urllib.error
    import zipfile
    import tempfile
    import shutil

    base_url = os.environ.get('MINERU_API_BASE', 'https://mineru.net').rstrip('/')
    token = os.environ.get('MINERU_API_TOKEN', '').strip()
    model_version = os.environ.get('MINERU_MODEL_VERSION', '').strip()  # vlm / pipeline / MinerU-HTML

    fname = os.path.basename(file_path)
    file_size = os.path.getsize(file_path)

    # 小文件（≤10MB）且页数不超 20 → 优先 Agent pipeline；否则走 Precision
    # 如果用户显式指定了 model_version=vlm → 强制走 Precision
    use_agent = (
        not token  # 没 token 只能走 Agent
        and not model_version  # 没显式指定 model
        and file_size <= 10 * 1024 * 1024
    )
    if model_version:
        use_agent = False

    mode_str = 'Agent pipeline(免token)' if use_agent else 'Precision ' + (model_version or ('vlm' if token else 'pipeline'))
    emit({"type": "info", "msg": f"MinerU 启动: 文件={fname} ({file_size/1024:.1f}KB) 模式={mode_str}"})
    emit({"type": "info", "msg": f"API Base={base_url}"})

    # ===== HTTP 工具函数 =====
    def _post_json(url, payload, headers=None):
        data = json.dumps(payload).encode('utf-8')
        req_headers = {'Content-Type': 'application/json', **(headers or {})}
        req = urllib.request.Request(url, data=data, headers=req_headers, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace') if e.fp else ''
            emit({"type": "fatal", "error": f"MinerU HTTP {e.code} POST {url}: {body[:500]}"})
            sys.exit(1)

    def _get_json(url, headers=None):
        req_headers = headers or {}
        req = urllib.request.Request(url, headers=req_headers, method='GET')
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace') if e.fp else ''
            emit({"type": "fatal", "error": f"MinerU HTTP {e.code} GET {url}: {body[:500]}"})
            sys.exit(1)

    def _put_file(url, file_path, headers=None):
        """OSS PUT 上传。

        Aliyun OSS 签名校验很敏感：MinerU 生成预签名 URL 时固定了 StringToSign 里的
        Content-Type 字段（通常是空行或固定值），请求时**实际发送的 Content-Type 必须与
        签名时一致**，否则 SignatureDoesNotMatch。

        实测：Python urllib 在 PUT data 时行为和 curl -T 不同，容易触发签名不匹配。
        这里用 subprocess 调 curl -T 上传，确保和成功案例行为一致。
        """
        import subprocess
        cmd = ['curl', '-sS', '-o', '/dev/null', '-T', file_path]
        # 附加 headers（注意：不要传 Content-Type，跟签名保持一致）
        for k, v in (headers or {}).items():
            if v is None or str(k).lower() == 'content-type':
                continue
            cmd += ['-H', f'{k}: {v}']
        cmd += [url]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            err_body = result.stderr or ''
            emit({"type": "fatal", "error": f"OSS PUT curl 失败 (exit={result.returncode}): {err_body[:500]}"})
            sys.exit(1)

    def _get_bytes(url, headers=None):
        req_headers = headers or {}
        req = urllib.request.Request(url, headers=req_headers, method='GET')
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace') if e.fp else ''
            emit({"type": "fatal", "error": f"MinerU 下载失败 HTTP {e.code}: {body[:500]}"})
            sys.exit(1)

    def _extract_data(resp):
        for k in ('data', 'Data', 'result'):
            if isinstance(resp.get(k), dict):
                return resp[k]
        return resp

    def _ok(resp):
        code = resp.get('code', resp.get('statusCode', resp.get('httpCode')))
        if code is not None and str(code) not in ('200', '0'):
            return False
        if resp.get('success') is False:
            return False
        return True

    # ====== 辅助：把 markdown 按页切分 ======
    def _split_markdown_by_pages(md_text):
        """MinerU 输出的 Markdown 里可能有 `## 第 N 页` 或 `---\n# Page N` 之类的分页标记。
        如果找不到明确的页分隔，就把整个文档当第 1 页。
        """
        import re
        # 尝试各种分页标记
        patterns = [
            r'^##\s*页\s*\d+',       # ## 页 1
            r'^##\s*Page\s*\d+',    # ## Page 1
            r'^#\s*页\s*\d+',
            r'^#\s*Page\s*\d+',
            r'^\*\*Page\s*\d+\*\*',
            r'^---\s*$',            # horizontal rule 也常作为页分隔
        ]
        lines = md_text.split('\n')
        page_boundaries = [0]
        for i, line in enumerate(lines):
            for p in patterns:
                if re.match(p, line, re.IGNORECASE):
                    page_boundaries.append(i)
                    break

        if len(page_boundaries) < 2:
            # 没有分页标记 → 整个文档 1 页
            return [md_text.strip()]

        pages = []
        for bi in range(len(page_boundaries)):
            start = page_boundaries[bi]
            end = page_boundaries[bi + 1] if bi + 1 < len(page_boundaries) else len(lines)
            page_text = '\n'.join(lines[start:end]).strip()
            if page_text:
                pages.append(page_text)
        return pages if pages else [md_text.strip()]

    # ==================== Agent Pipeline 模式 ====================
    if use_agent:
        if file_size > 10 * 1024 * 1024:
            emit({"type": "fatal", "error": f"Agent Pipeline 文件太大 ({file_size/1024/1024:.1f}MB > 10MB)。请在设置里配置 MinerU Token 后使用 Precision VLM 模式。"})
            sys.exit(1)

        emit({"type": "info", "msg": f"申请 Agent 上传链接..."})
        create_resp = _post_json(f"{base_url}/api/v1/agent/parse/file", {"file_name": fname})
        create_data = _extract_data(create_resp)
        task_id = str(create_data.get('task_id') or '').strip()
        upload_url = str(create_data.get('file_url') or '').strip()
        if not task_id or not upload_url:
            emit({"type": "fatal", "error": f"Agent 创建任务缺少 task_id/file_url: {json.dumps(create_resp, ensure_ascii=False)[:500]}"})
            sys.exit(1)

        emit({"type": "info", "msg": f"task_id={task_id}，上传文件..."})
        _put_file(upload_url, file_path)
        emit({"type": "info", "msg": "上传完成，等待 MinerU Agent pipeline 处理..."})

        # 轮询
        poll_url = f"{base_url}/api/v1/agent/parse/{task_id}"
        deadline = time.time() + 60 * 15
        poll_interval = 4
        state = ''
        result_md_url = ''

        while time.time() < deadline:
            pause.check()
            poll_resp = _get_json(poll_url)
            poll_data = _extract_data(poll_resp)
            state = str(poll_data.get('state') or '').lower()

            # 输出进度（Agent API 可能不给页数进度，用 state 表示）
            state_pct = {
                'waiting-file': 5,
                'pending': 15,
                'running': 50,
                'processing': 50,
                'done': 100,
                'success': 100,
            }.get(state, 5)
            if state_pct < 100:
                emit({"type": "progress", "page": 0, "total": 0, "status": state, "percent": state_pct})

            if state in ('done', 'success', 'completed'):
                # Agent 输出是 Markdown（CDN 链接）
                result_md_url = (
                    poll_data.get('markdown_url')
                    or poll_data.get('md_url')
                    or poll_data.get('result_md_url')
                    or poll_data.get('result_url')
                    or poll_data.get('full_md_url')
                    or poll_data.get('url')
                    or ''
                )
                # 有些版本把 URL 包在 result 子对象里
                if not result_md_url and isinstance(poll_data.get('result'), dict):
                    r = poll_data['result']
                    for k in ('markdown_url', 'md_url', 'url'):
                        if str(r.get(k) or '').strip():
                            result_md_url = str(r[k]).strip(); break
                break

            if state in ('failed', 'error', 'canceled'):
                err = poll_data.get('err_msg') or poll_data.get('error_msg') or poll_data.get('message') or 'MinerU Agent 处理失败'
                emit({"type": "fatal", "error": f"MinerU Agent 失败 (state={state}): {err}"})
                sys.exit(1)

            time.sleep(poll_interval)
            poll_interval = min(poll_interval + 1, 10)

        if not result_md_url:
            emit({"type": "fatal", "error": f"MinerU Agent 轮询超时或未拿到结果（最后 state={state}，data keys={list(poll_data.keys()) if 'poll_data' in dir() else '?'}）"})
            sys.exit(1)

        emit({"type": "info", "msg": f"Agent 完成，下载 Markdown..."})
        md_bytes = _get_bytes(result_md_url)
        md_text = md_bytes.decode('utf-8', errors='replace')

        # 按页切分
        pages = _split_markdown_by_pages(md_text)
        emit({"type": "info", "msg": f"识别到 {len(pages)} 页"})

        done_count = 0
        for idx, page_text in enumerate(pages):
            pause.check()
            page_num = idx + 1
            page_fname = os.path.join(out_dir, f'page_{page_num:05d}.txt')
            with open(page_fname, 'w', encoding='utf-8') as f:
                f.write(page_text)
            done_count += 1
            emit({"type": "progress", "page": page_num, "total": len(pages), "status": "done"})
            emit({"type": "page_text", "page": page_num, "text": page_text[:2000], "path": page_fname})

        # 最终 markdown 也存一份（完整原文）
        base_name = os.path.splitext(fname)[0]
        md_path = os.path.join(out_dir, f'{base_name}.md')
        with open(md_path, 'w', encoding='utf-8') as f:
            f.write(md_text)

        emit({"type": "info", "msg": f"Agent pipeline 完成：{done_count} 页 markdown 已保存"})
        emit({"type": "postprocess_done", "format": fmt, "output_path": out_dir, "pages": done_count})

    # ==================== Precision VLM 模式 ====================
    else:
        if not token:
            emit({"type": "fatal", "error": "MinerU Precision 模式需要 Token。请到 OCR 中心设置 → MinerU 配置 Token（mineru.net 注册获取）。\n或文件 ≤10MB 时可选择 Agent Pipeline 免 Token 模式。"})
            sys.exit(1)

        # 2. 创建任务
        create_url = f"{base_url}/api/v4/file-urls/batch"
        auth_headers = {'Authorization': f'Bearer {token}', 'token': token}
        actual_model = model_version or 'vlm'
        create_payload = {
            'files': [{'name': fname, 'is_ocr': True}],
            'language': 'ch',
            'enable_formula': True,
            'enable_table': True,
            'model_version': actual_model,
        }

        emit({"type": "info", "msg": f"创建 Precision {actual_model} 任务..."})
        create_resp = _post_json(create_url, create_payload, auth_headers)
        create_data = _extract_data(create_resp)

        batch_id = str(create_data.get('batch_id') or create_data.get('id') or '').strip()
        upload_url = ''
        candidates = create_data.get('file_urls') or create_data.get('upload_urls') or []
        if isinstance(candidates, list):
            for item in candidates:
                if isinstance(item, str) and item.strip():
                    upload_url = item.strip(); break
                if isinstance(item, dict):
                    for k in ('upload_url', 'url', 'file_url', 'put_url'):
                        v = str(item.get(k) or '').strip()
                        if v: upload_url = v; break
                if upload_url: break
        if not upload_url:
            upload_url = str(create_data.get('upload_url') or '').strip()

        if not batch_id or not upload_url:
            emit({"type": "fatal", "error": f"Precision 创建任务缺少 batch_id/upload_url: {json.dumps(create_data, ensure_ascii=False)[:500]}"})
            sys.exit(1)

        upload_headers = {}
        raw_hdrs = create_data.get('headers')
        if isinstance(raw_hdrs, dict):
            for k, v in raw_hdrs.items():
                upload_headers[str(k)] = '' if v is None else str(v)
        elif isinstance(raw_hdrs, list):
            for item in raw_hdrs:
                if isinstance(item, dict):
                    for k, v in item.items():
                        upload_headers[str(k)] = '' if v is None else str(v)

        emit({"type": "info", "msg": f"batch_id={batch_id}，上传文件..."})
        _put_file(upload_url, file_path, upload_headers)
        emit({"type": "info", "msg": "上传完成，等待 Precision 处理（可能数分钟）..."})

        # 3. 轮询
        poll_url = f"{base_url}/api/v4/extract-results/batch/{batch_id}"
        deadline = time.time() + 60 * 30
        poll_interval = 5
        state = ''
        result_zip_url = ''

        while time.time() < deadline:
            pause.check()
            poll_resp = _get_json(poll_url, auth_headers)
            poll_data = _extract_data(poll_resp)

            results = []
            if isinstance(poll_data, dict):
                for key in ('extract_result', 'results', 'extract_results'):
                    v = poll_data.get(key)
                    if isinstance(v, list):
                        results = v; break
            elif isinstance(poll_data, list):
                results = poll_data

            target = results[0] if results else {}
            state = str(target.get('state') or target.get('status') or '').lower()

            # Precision API 支持分页进度
            progress = target.get('extract_progress') if isinstance(target, dict) else None
            extracted = 0; total = 0
            if isinstance(progress, dict):
                extracted = int(progress.get('extracted_pages', 0))
                total = int(progress.get('total_pages', 0))
            if extracted and total:
                emit({"type": "progress", "page": extracted, "total": total, "status": state, "percent": int(extracted / total * 90)})
            else:
                state_pct = {'uploading': 10, 'running': 40, 'processing': 40, 'done': 100}.get(state, 5)
                if state_pct < 100:
                    emit({"type": "progress", "page": 0, "total": 0, "status": state, "percent": state_pct})

            if state in ('done', 'success', 'completed'):
                result_zip_url = (
                    target.get('result_zip_url')
                    or target.get('zip_url')
                    or target.get('url')
                    or poll_data.get('result_zip_url')
                    or poll_data.get('zip_url')
                    or ''
                )
                break
            if state in ('failed', 'error', 'canceled'):
                err = target.get('error_msg') or target.get('error') or target.get('message') or 'MinerU Precision 处理失败'
                emit({"type": "fatal", "error": f"Precision 任务失败 (state={state}): {err}"})
                sys.exit(1)

            time.sleep(poll_interval)
            poll_interval = min(poll_interval + 2, 15)

        if not result_zip_url:
            emit({"type": "fatal", "error": f"Precision 轮询超时或未拿到 ZIP（最后 state={state}）"})
            sys.exit(1)

        emit({"type": "info", "msg": f"Precision 完成，下载 ZIP..."})

        # 4. 下载 ZIP 并解析
        zip_bytes = _get_bytes(result_zip_url)
        tmpdir = tempfile.mkdtemp(prefix='mineru_precision_')
        zip_path = os.path.join(tmpdir, 'result.zip')
        with open(zip_path, 'wb') as f:
            f.write(zip_bytes)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmpdir)

        # 优先找 full.md（Markdown 原文），如果存在直接用它分页
        full_md = None
        for root, dirs, files in os.walk(tmpdir):
            for fn in files:
                if fn.lower() == 'full.md':
                    full_md = os.path.join(root, fn); break
            if full_md: break

        if full_md:
            with open(full_md, encoding='utf-8') as f:
                md_text = f.read()
            pages = _split_markdown_by_pages(md_text)
            done_count = 0
            for idx, page_text in enumerate(pages):
                pause.check()
                page_num = idx + 1
                page_fname = os.path.join(out_dir, f'page_{page_num:05d}.txt')
                with open(page_fname, 'w', encoding='utf-8') as f:
                    f.write(page_text)
                done_count += 1
                emit({"type": "progress", "page": page_num, "total": len(pages), "status": "done"})
                emit({"type": "page_text", "page": page_num, "text": page_text[:2000], "path": page_fname})
        else:
            # fallback：找 JSON 按旧逻辑解析
            json_files = []
            for root, dirs, files in os.walk(tmpdir):
                for fn in files:
                    if fn.lower().endswith('.json') and ('layout' in fn.lower() or 'result' in fn.lower() or 'ocr' in fn.lower()):
                        json_files.append(os.path.join(root, fn))
            if not json_files:
                for root, dirs, files in os.walk(tmpdir):
                    for fn in files:
                        if fn.lower().endswith('.json'):
                            json_files.append(os.path.join(root, fn))
                json_files.sort(key=lambda p: os.path.getsize(p), reverse=True)

            if not json_files:
                emit({"type": "fatal", "error": f"ZIP 中未找到 full.md 或 JSON（解压目录 {tmpdir} 有 {[f for r,_,fs in os.walk(tmpdir) for f in fs]}）"})
                sys.exit(1)

            with open(json_files[0], encoding='utf-8') as f:
                doc_json = json.load(f)

            pages_list = None
            if isinstance(doc_json, dict):
                for key in ('pdf_info', 'pages', 'results', 'doc_layout_result'):
                    if isinstance(doc_json.get(key), list):
                        pages_list = doc_json[key]; break
                if pages_list is None and isinstance(doc_json.get('layout_dets'), list):
                    pages_list = [doc_json]
            elif isinstance(doc_json, list):
                pages_list = doc_json

            def _collect(obj):
                lines = []
                if isinstance(obj, str):
                    return [obj]
                if isinstance(obj, dict):
                    content = obj.get('content')
                    category = str(obj.get('type') or obj.get('category_type') or '').lower()
                    if isinstance(content, str) and content.strip():
                        if category not in ('image', 'table', 'figure', 'formula', 'chart', 'code'):
                            lines.append(content.strip())
                    for v in obj.values():
                        lines.extend(_collect(v))
                elif isinstance(obj, list):
                    for item in obj:
                        lines.extend(_collect(item))
                return lines

            done_count = 0
            for idx, page_obj in enumerate(pages_list or []):
                pause.check()
                page_num = idx + 1
                texts = _collect(page_obj)
                text = '\n'.join(t for t in texts if t)
                page_fname = os.path.join(out_dir, f'page_{page_num:05d}.txt')
                with open(page_fname, 'w', encoding='utf-8') as f:
                    f.write(text)
                done_count += 1
                emit({"type": "progress", "page": page_num, "total": len(pages_list or []), "status": "done"})
                emit({"type": "page_text", "page": page_num, "text": text[:2000], "path": page_fname})

        # 清理临时 ZIP
        try:
            os.remove(zip_path)
        except Exception:
            pass

        emit({"type": "info", "msg": f"Precision {actual_model} 完成：{done_count} 页"})
        emit({"type": "postprocess_done", "format": fmt, "output_path": out_dir, "pages": done_count})

# ========== 后处理：根据 format 生成最终输出 ==========

def postprocess(fmt: str, out_dir: str, source_file: str):
    """所有页处理完后，按格式生成最终输出文件"""
    # 收集所有 page_XXXXX.txt 的文本
    import glob as _glob
    page_files = sorted(_glob.glob(os.path.join(out_dir, 'page_*.txt')))
    if not page_files:
        return {}

    pages = []
    for pf in page_files:
        with open(pf, encoding='utf-8') as f:
            pages.append((os.path.basename(pf), f.read()))

    merged = '\n\n'.join(text for _, text in pages)
    base = os.path.splitext(os.path.basename(source_file))[0]
    result = {'plain_text': merged}

    if fmt == 'plain':
        result_path = os.path.join(out_dir, f'{base}.txt')
        with open(result_path, 'w', encoding='utf-8') as f:
            f.write(merged)
        result['output_path'] = result_path

    elif fmt == 'markdown':
        result_path = os.path.join(out_dir, f'{base}.md')
        md_parts = [f'# OCR 识别结果：{os.path.basename(source_file)}\n']
        for fname, text in pages:
            page_num = int(fname.replace('page_', '').replace('.txt', ''))
            md_parts.append(f'\n## 第 {page_num} 页\n\n{text}')
        with open(result_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(md_parts))
        result['output_path'] = result_path

    elif fmt == 'json':
        result_path = os.path.join(out_dir, f'{base}.json')
        import json as _json
        data = {
            'source': os.path.basename(source_file),
            'pages': [
                {'page': int(fname.replace('page_', '').replace('.txt', '')), 'text': text}
                for fname, text in pages
            ],
            'merged_text': merged,
        }
        with open(result_path, 'w', encoding='utf-8') as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
        result['output_path'] = result_path

    elif fmt == 'docx':
        result_path = os.path.join(out_dir, f'{base}.docx')
        try:
            from docx import Document
            doc = Document()
            doc.add_heading(f'OCR 识别结果：{os.path.basename(source_file)}', level=1)
            for fname, text in pages:
                page_num = int(fname.replace('page_', '').replace('.txt', ''))
                doc.add_heading(f'第 {page_num} 页', level=2)
                # 按行分段，保留原始换行
                for line in text.split('\n'):
                    doc.add_paragraph(line)
                doc.add_paragraph()  # 页间空行
            doc.save(result_path)
            result['output_path'] = result_path
        except ImportError:
            emit({"type": "fatal", "error": "docx 格式需要 python-docx: pip install python-docx"})

    emit({"type": "postprocess_done", "format": fmt, "output_path": result.get('output_path'), "pages": len(pages)})
    return result

# ========== Main ==========

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input', help='输入文件路径（PDF 或图片）')
    ap.add_argument('--engine', default='rapidocr', choices=['rapidocr', 'docling', 'paddleocr', 'mineru', 'vision'])
    ap.add_argument('--start-page', type=int, default=1)
    ap.add_argument('--end-page', type=int, default=0, help='0 表示到最后一页')
    ap.add_argument('--format', default='markdown', choices=['markdown', 'json', 'plain', 'docx'])
    ap.add_argument('--output-dir', default='')
    args = ap.parse_args()

    if not os.path.exists(args.input):
        emit({"type": "fatal", "error": f"文件不存在: {args.input}"})
        sys.exit(2)

    # 自动输出目录
    if not args.output_dir:
        args.output_dir = tempfile.mkdtemp(prefix='anli-ocr-')

    pause = PauseToken()

    emit({"type": "info", "msg": f"引擎={args.engine} 文件={args.input} 页={args.start_page}-{args.end_page or 'end'} 格式={args.format}"})

    try:
        engines = {
            'rapidocr': run_rapidocr,
            'vision': run_vision,
            'docling': run_docling,
            'paddleocr': run_paddleocr,
            # 'mineru': run_mineru,  # 暂时下线：MinerU Cloud API 近期波动较大，待稳定后恢复
        }
        if args.engine == 'mineru':
            emit({"type": "fatal", "error": "MinerU 引擎暂不可用（开发中）。请改用 RapidOCR / PaddleOCR / Docling。"})
            sys.exit(1)
        t0 = time.time()
        engines[args.engine](args.input, args.start_page, args.end_page, args.format, args.output_dir, pause)
        # 后处理：合并生成最终输出
        postprocess(args.format, args.output_dir, args.input)
        emit({"type": "done", "elapsed_sec": round(time.time() - t0, 1)})
    except SystemExit:
        raise
    except Exception:
        tb = traceback.format_exc()
        emit({"type": "fatal", "error": tb})
        sys.exit(1)

if __name__ == '__main__':
    main()
