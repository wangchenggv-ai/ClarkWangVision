#!/bin/bash
# ════════════════════════════════════════════════════════════
#  高视高清 · 批量订单处理（双击运行）
#  助理用法：把订单 Excel 放进 inbox/ → 双击本文件 → 按提示回车
# ════════════════════════════════════════════════════════════

cd "$(dirname "$0")" || exit 1
INBOX="${1:-./inbox/}"
PY=".venv/bin/python"; [ -x "$PY" ] || PY="python3"

clear
echo "════════════════════════════════════════════"
echo "        高视高清 · 批量订单处理"
echo "════════════════════════════════════════════"
echo ""

count=$(ls "$INBOX"/*.xlsx 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" = "0" ]; then
  echo "⚠️  没找到订单文件。"
  echo ""
  echo "   请先把订单 Excel（命名如 AG-011_20260525.xlsx）"
  echo "   放进这个文件夹后，再双击本启动器："
  echo "   $(pwd)/inbox/"
  echo ""
  read -r -p "按回车键关闭… "
  exit 0
fi

echo "📋 找到 $count 个订单文件，开始处理…"
echo ""
"$PY" main.py "$INBOX"
status=$?

echo ""
if [ "$status" -ne 0 ]; then
  echo "⚠️  已中止或出错（详见上方）。订单未写入飞书，可修正后重试。"
else
  echo "════════════════════════════════════════════"
  echo "  ✅ 处理完成。配货单已生成在 output/ 文件夹。"
  echo ""
  echo "  下一步：仓库按配货单 labels.xlsx 拣货核对，"
  echo "          核对无误后，双击「2-扣库存」完成扣减。"
  echo "════════════════════════════════════════════"
fi
echo ""
read -r -p "按回车键关闭… "
