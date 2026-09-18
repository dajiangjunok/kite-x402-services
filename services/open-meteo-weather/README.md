# Open-Meteo Weather

按请求收费的天气预报服务，使用 TypeScript / Express 和 x402 v2，基于仓库模板实现。
当前为 **draft**，目标网络为 Kite testnet；公开部署、真实天气响应与本人付费证明尚待完成。
完整需求分析和验收状态见 [EVIDENCE.md](EVIDENCE.md)。

| 项目 | 配置 |
| --- | --- |
| 付费端点 | `GET /v1/forecast` |
| 免费端点 | `GET /healthz` |
| 默认上游 | `https://customer-api.open-meteo.com/v1/forecast` |
| 单次价格 | `0.001` USD；testnet 为 `1000000000000000` pieUSD 最小单位 |
| 商业上游认证 | 服务端注入 `apikey`，买方无需获取上游密钥 |
| 支付顺序 | `verify → 读取完整上游响应 → settle → 返回天气及 PAYMENT-RESPONSE` |

## 上游条款与成本

核查日期：2026-09-18。Open-Meteo 的[条款](https://open-meteo.com/en/terms)限定免费 API 为非商业用途；
[商业订阅说明](https://open-meteo.com/en/pricing)提供商业使用许可、客户 API 地址和 API Key。
因此本收费代理默认使用商业客户端点，并拒绝配置 `api.open-meteo.com`。
上游数据遵循 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，允许按许可条件再分发，须保留署名；
本服务在成功响应的 `Link` 头标注来源及许可，响应体保留天气数据。
用户展示数据时也应注明 Open-Meteo 来源。商业数据再分发的依据为上述许可，
不是转让 Open-Meteo 账号或密钥；具体商业订阅与预期代理用途须由部署者确认。

已公布的 Standard 额度为每月 100 万次；较多变量、位置或较长预测范围可能按多次调用计数。
本示例只查询一个位置、一天数据。实际订阅费以购买时的报价为准；尚未配置商业订阅，
不能声称已验证成本或盈利。`$0.001` 为本草稿服务定价，不是 Open-Meteo 的单次价格。
部署者需按实际订阅容量设置访问配额。也可接入具有相应许可的自托管 Open-Meteo 实例，
并自行履行其软件和数据许可要求。

## 配置与本地运行

要求 Node.js 22.9+（支持 `--env-file-if-exists`）和 npm。在本目录执行：

```bash
npm ci
cp .env.example .env
# 在本机编辑 .env：填入 PAY_TO 和 OPEN_METEO_API_KEY
npm run typecheck
npm test
npm start
```

`.env` 自动加载，不需要 `source`。私钥和上游密钥均不应提交到仓库。

| 环境变量 | 含义 |
| --- | --- |
| `PAY_TO` | 收款 EVM 地址，拒绝空值、占位符和零地址 |
| `KITE_NETWORK` | `testnet`（默认）或 `mainnet` |
| `UPSTREAM_URL` | 上游基础 URL，默认 `https://customer-api.open-meteo.com/v1` |
| `OPEN_METEO_API_KEY` | 商业端点必填；通过上游查询参数注入 |
| `PRICE_USD` | 正十进制字符串，最多 6 位小数，默认 `0.001` |
| `UPSTREAM_TIMEOUT_MS` | 从请求开始到完整读取响应的超时，默认 `15000` |
| `UPSTREAM_AUTH_HEADER` / `UPSTREAM_AUTH_VALUE` | 可选自托管上游认证，默认头名 `Authorization` |
| `FACILITATOR_URL` | 默认 `https://facilitator.pieverse.io/v2`，须保留 `/v2` |
| `PORT` | 默认 `8080` |
| `SERVICE_DESCRIPTION` | 支付挑战中的服务说明 |

Wrapper 去除自己的 `/v1` 前缀，再附加到上游基础路径；因此上游配置必须包含它自身所需的 `/v1`。
只代理精确路径 `/v1/forecast`，其他路径返回 404；非 GET 方法（包括 HEAD）返回 405。
API 文档与变量见 [Open-Meteo Forecast API](https://open-meteo.com/en/docs)。

```bash
curl -i http://localhost:8080/healthz
curl -i 'http://localhost:8080/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,wind_speed_10m&hourly=temperature_2m&forecast_days=1'
# 未付费时应返回 402 和 PAYMENT-REQUIRED；不会访问天气上游。
```

## 部署

本目录包含多阶段 [Dockerfile](Dockerfile)。从本目录构建运行：

```bash
docker build -t open-meteo-weather .
docker run --rm --env-file .env -p 8080:8080 open-meteo-weather
```

部署到支持容器的托管平台，配置环境变量、端口 8080、健康检查 `/healthz` 及公开 HTTPS。
不要将 `.env` 放进镜像。若平台直接运行 Node，构建命令为 `npm ci && npm run build`，
启动命令为 `node dist/index.js`，通过平台注入环境变量。
Facilitator 的 `/supported` 初始化成功后才开始监听；初始化失败时进程非零退出，供平台重启。

部署前同步 `service.yaml` 的 `pay_to`、`network`、每个端点的 `price_usd` 和 `base_url`。
`base_url` 只能是公开 HTTPS origin，例如 `https://weather.example.com`，不要结尾 `/` 或路径。
草稿中零地址仅作为未配置标记；运行时和验收脚本都会拒绝它。
维护者依据当前 Git remote 的 `dajiangjunok` 设置，正式提交前确认已绑定该账号。
完成真实付费验收后才将 `status` 改为 `testnet`；主网验收后才改为 `live`，并同步服务索引。

## 线上验收与本人付费证据

正式付费前先确认活动接受 testnet 还是要求 mainnet；本仓库默认先测 testnet。
按照清单配置公开部署地址和收款地址后，在本目录执行：

```bash
npm run acceptance
# 仅免费健康检查和未付费 402，不签名、不转账。
```

[验收脚本](scripts/acceptance.mjs)从 `service.yaml` 读取每个端点的 `example_request`，
核对支付网络、资产、收款方、金额和 EIP-712 域。真实付费时，贡献者本人在本机安全配置
`BUYER_PRIVATE_KEY`（自有专用测试钱包，持有对应网络的 pieUSD）及可选的
`DEPLOYED_COMMIT_SHA`（实际部署版本；只作为操作者提供的元信息，不自动证明部署来源）。
不要把私钥粘贴进聊天、命令参数或 Git。然后执行：

```bash
npm run acceptance -- --paid
# 每个端点只发送一次签名付费请求；默认仅允许测试网。
# 主网只有在确认活动要求、余额和费用后，额外添加 --allow-mainnet。
```

脚本记录时间、请求、402 挑战、2xx 天气数据、支付回执和交易哈希，
再从 Kite RPC 核验成功交易及 **指定代币、付款人、收款人和金额匹配的 Transfer 事件**。
结果写入 `evidence/online-<UTC时间>.json`；不会保存私钥或 PAYMENT-SIGNATURE。
只有 `outcome: paid_acceptance_passed` 才代表该次线上验收通过。
失败时保留已取得的证据并非零退出；结果不明时先按已知哈希核查链上状态，不要盲目重新付款。

已有 Kite Passport session 时也可由本人使用根目录 README 的 kpass 流程调用清单中的完整 URL，
保存脱敏后的请求、2xx 内容、时间和交易哈希，并核查结算结果。
使用自有钱包脚本可以满足本需求文档的本人付费记录；若活动另行要求 Passport 身份关联，须补交 kpass 证据。

## 异常行为与验证边界

- 验证失败：402；不访问上游、不结算。Facilitator 不可用时返回支付处理错误。
- 上游 4xx / 5xx：保留错误状态码，返回通用错误，不透传可能含密钥的上游错误正文。
- 上游连接失败、断流、重定向、非天气 JSON 或超过 2 MiB：502；完整读取超时：504；均不结算。
- 结算明确失败：402，`payment_settlement_failed`；结算通信异常或回执异常：502，`payment_settlement_unknown`。
  后者可能已经发生转账，不能解释为“未扣费”；服务不自动重试结算。
- 仅在结算成功后发送天气数据及成功支付回执。上游认证、买方签名、Cookie 不跨边界透传；响应禁止共享缓存。

`npm test` 使用真实 SDK、本机 HTTP 模拟上游及模拟 Facilitator，断言调用顺序及无副作用；
模拟地址、签名、交易哈希不是链上证据。测试也执行清单中的参数组合，但不能代替线上 AC-05 / AC-07。
根目录 `npm run validate` 校验清单，CI 持续运行类型检查和本服务验收测试。
尚未执行的真实验收、工具限制与完整检查日志统一记录于 [EVIDENCE.md](EVIDENCE.md)。
