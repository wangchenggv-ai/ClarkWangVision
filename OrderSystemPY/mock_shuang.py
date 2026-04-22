"""
溯源系统 Mock 服务器(本地测试用)

作用:
    完全模拟 api.gaushclear.com 的行为,让 daily_batch.py 在
    不触达生产环境的情况下跑通完整流程。

启动:
    pip install flask
    python mock_shuang.py

模拟的接口:
    POST /api/securityOrderAdd   → 返回 {code: 1000},订单存内存和文件
    POST /api/securityOrderList  → 返回已写入的订单列表
    GET  /uploads/{id}/{id}.zip  → 返回占位 ZIP
    POST /reset                  → 清空所有 mock 数据
    GET  /status                 → 健康检查

数据持久化:
    mock_shuang_data.jsonl(和 mock_shuang.py 同目录)
    重启服务后自动恢复,便于多轮测试。

作者: Clark + Claude
日期: 2026-04-19
"""
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

from flask import Flask, request, jsonify

app = Flask(__name__)

SCRIPT_DIR = Path(__file__).parent
DATA_FILE = SCRIPT_DIR / "mock_shuang_data.jsonl"
START_ID = 7117

orders = []
if DATA_FILE.exists():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                orders.append(json.loads(line))
    print(f"[MOCK] 从 {DATA_FILE.name} 恢复 {len(orders)} 条历史数据")


def _persist(order):
    with open(DATA_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(order, ensure_ascii=False) + "\n")


@app.route("/api/securityOrderAdd", methods=["POST"])
def add_order():
    form = request.form.to_dict()
    order_id = START_ID + len(orders)

    order = {
        "id": order_id,
        "goods_name": form.get("goods_name", ""),
        "barcode_num": int(form.get("barcode_num", 2)),
        "right_qiujing": form.get("right_qiujing", ""),
        "right_zhujing": form.get("right_zhujing", ""),
        "righy_zhouwei": form.get("righy_zhouwei", ""),
        "left_qiujing": form.get("left_qiujing", ""),
        "left_zhujing": form.get("left_zhujing", ""),
        "left_zhouwei": form.get("left_zhouwei", ""),
        "remark": form.get("remark", ""),
        "dealer": form.get("dealer", ""),
        "create_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "barcode_url": f"http://localhost:3001/uploads/{order_id}/{order_id}.zip",
    }
    orders.append(order)
    _persist(order)

    print(f"[MOCK] 新增 #{order_id}: {order['dealer']} / {order['remark']} / {order['goods_name']}")
    return jsonify({
        "code": 1000,
        "message": "成功(MOCK)",
        "data": None,
    })


@app.route("/api/securityOrderList", methods=["POST"])
def list_orders_endpoint():
    page = int(request.form.get("page", 1))
    page_size = int(request.form.get("pageSize", 20))

    sorted_orders = sorted(orders, key=lambda x: x["id"], reverse=True)
    start = (page - 1) * page_size
    end = start + page_size

    return jsonify({
        "code": 1000,
        "message": "成功(MOCK)",
        "data": sorted_orders[start:end],
        "count": len(orders),
    })


@app.route("/uploads/<int:order_id>/<filename>", methods=["GET"])
def fake_zip(order_id, filename):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            f"mock_qr_{order_id}.txt",
            f"MOCK QR CODE for order {order_id}\n"
            f"生成时间: {datetime.now().isoformat()}\n"
            f"注意: 这是 Mock 数据,不是真实 QR 码"
        )
    buf.seek(0)
    return buf.read(), 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": f'attachment; filename="{filename}"',
    }


@app.route("/reset", methods=["POST"])
def reset():
    global orders
    count = len(orders)
    orders = []
    if DATA_FILE.exists():
        DATA_FILE.unlink()
    return jsonify({
        "message": f"mock data cleared ({count} orders removed)",
    })


@app.route("/status", methods=["GET"])
def status():
    return jsonify({
        "status": "ok",
        "env": "MOCK",
        "orders_count": len(orders),
        "next_id": START_ID + len(orders),
    })


if __name__ == "__main__":
    print("="*60)
    print(f"  Mock 溯源服务启动: http://localhost:3001")
    print(f"  数据文件: {DATA_FILE}")
    print(f"  当前订单数: {len(orders)}")
    print(f"  下一个 ID: {START_ID + len(orders)}")
    print("="*60)
    print("  接口:")
    print("    POST /api/securityOrderAdd   新增订单")
    print("    POST /api/securityOrderList  查询列表")
    print("    GET  /uploads/{id}/{id}.zip  下载 ZIP")
    print("    POST /reset                  清空数据")
    print("    GET  /status                 健康检查")
    print("="*60)
    print()
    app.run(host="127.0.0.1", port=3001, debug=False)
