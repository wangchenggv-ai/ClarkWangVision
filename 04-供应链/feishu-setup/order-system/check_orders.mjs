// 直接查Bitable找有关联门店的订单
const APP_TOKEN = "CtXObqwAHaCXYssBBfkcXmrlnUe";
const APP_ID = "cli_a958c5e372b85cb0";
const APP_SECRET = "PWLWUZ3ZZZj3DnKb2nX0yhBWoQ5hzu0y";
const ORDER_TABLE = "tblmlRxaq0bNYgaf";

async function getToken() {
  const r = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  return (await r.json()).tenant_access_token;
}

function rawVal(v) {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(x => typeof x === "object" ? x.text || "" : x).join("");
  return String(v);
}

async function main() {
  const t = await getToken();
  const d = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${ORDER_TABLE}/records?page_size=20`, {
    headers: { Authorization: `Bearer ${t}` }
  }).then(r => r.json());

  console.log("所有订单（含关联门店字段）：");
  for (const r of d.data?.items || []) {
    const f = r.fields;
    const orderNo = rawVal(f["订单编号"]);
    const status = rawVal(f["订单状态"]);
    const tc = rawVal(f["终端客户"]) || rawVal(f["终端门店"]);
    const linked = f["关联门店"];
    const linkedText = linked?.[0]?.text;
    const addrMain = rawVal(f["收货地址（主数据）"]);
    if (orderNo) {
      console.log(`  ${orderNo} | ${status} | 终端客户="${tc}" | 关联="${linkedText || "无"}" | 地址(主)="${addrMain?.slice(0,20) || "无"}"`);
    }
  }
}
main().catch(console.error);
