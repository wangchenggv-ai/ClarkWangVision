// OEM品牌配置：门店名称 → 品牌展示
// 新增OEM客户：在 BRANDS 和 STORE_BRAND_MAP 各加一条即可

const BRANDS = {
  "铂视控": {
    name: "铂视控",
    nameEn: "BOSHIKONG",
    color: "#1a3a6b",
    logoUrl: null,        // 上传Logo后填 "/images/boshikong-logo.png"
    footer: null,         // 如需客服电话，填 "服务热线：400-xxx-xxxx"
  },
};

// 门店名称前缀 → 品牌key（支持"铂视控"、"铂视控上海门店"等）
const STORE_BRAND_MAP = {
  "铂视控": "铂视控",
};

export const DEFAULT_BRAND = {
  name: "高视高清",
  nameEn: "GAUSH CLEAR",
  color: "#0066CC",
  logoUrl: null,
  footer: null,
};

export function getBrandByStoreName(storeName) {
  if (!storeName) return DEFAULT_BRAND;
  const exact = STORE_BRAND_MAP[storeName];
  if (exact) return BRANDS[exact];
  for (const [prefix, key] of Object.entries(STORE_BRAND_MAP)) {
    if (storeName.startsWith(prefix)) return BRANDS[key];
  }
  return DEFAULT_BRAND;
}
