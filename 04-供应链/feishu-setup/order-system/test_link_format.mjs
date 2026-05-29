// 测试关联字段的正确写入格式
const APP_TOKEN = "CtXObqwAHaCXYssBBfkcXmrlnUe";
const APP_ID = "cli_a958c5e372b85cb0";
const APP_SECRET = "PWLWUZ3ZZZj3DnKb2nX0yhBWoQ5hzu0y";
const ORDER_TABLE = "tblmlRxaq0bNYgaf";
const STORE_RECORD_ID = "recvkDM7klXoBK"; // 成都锦牧加门店

async function getToken() {
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  return (await r.json()).tenant_access_token;
}

async function tryFormat(token, label, linkValue, orderNo) {
  const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records/batch_create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      records: [{
        fields: {
          "订单编号": orderNo,
          "产品型号": "时空之眼A",
          "数量": 1,
          "订单状态": "已下单",
          "代理商ID": "AG-002",
          "关联门店": linkValue,
        }
      }]
    }),
  });
  const d = await r.json();
  const ok = d.code === 0;
  console.log(`  ${ok ? "✅" : "❌"} Format ${label}: code=${d.code} msg=${d.msg?.slice(0,40) || ""}`);
  // 如果成功，立刻删除测试记录
  if (ok) {
    const recId = d.data?.records?.[0]?.record_id;
    if (recId) {
      await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records/${recId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  return ok;
}

async function main() {
  const token = await getToken();
  console.log("=== 测试关联门店字段写入格式 ===\n");

  // 格式A: [{record_id: "xxx"}]
  await tryFormat(token, "A [{record_id}]",
    [{ "record_id": STORE_RECORD_ID }], "ORD-TEST-FMT-A");

  // 格式B: ["xxx"] - 字符串数组
  await tryFormat(token, 'B ["recordId"]',
    [STORE_RECORD_ID], "ORD-TEST-FMT-B");

  // 格式C: {record_ids: ["xxx"]}
  await tryFormat(token, "C {record_ids:[]}",
    { "record_ids": [STORE_RECORD_ID] }, "ORD-TEST-FMT-C");

  // 格式D: [{record_ids: ["xxx"]}]
  await tryFormat(token, "D [{record_ids:[]}]",
    [{ "record_ids": [STORE_RECORD_ID] }], "ORD-TEST-FMT-D");

  // 格式E: [{record_ids:["xxx"], table_id:"xxx"}]
  await tryFormat(token, "E [{record_ids, table_id}]",
    [{ "record_ids": [STORE_RECORD_ID], "table_id": "tblcR9JV8IhzNrjI" }], "ORD-TEST-FMT-E");

  // 格式F: {record_id: "xxx"} - 单对象
  await tryFormat(token, "F {record_id}",
    { "record_id": STORE_RECORD_ID }, "ORD-TEST-FMT-F");

  // 格式G: 不写关联门店（基准对照）
  await tryFormat(token, "G 无关联门店（对照）",
    null, "ORD-TEST-FMT-G");
}

main().catch(console.error);
