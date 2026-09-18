# Open-Meteo Weather：需求分析与验收记录

结论：**本地实现与模拟验收已完成，尚未达到全部需求的完成标准。**
服务保持 `draft`，不得将本文件或测试中的模拟交易当作线上付费证明。
依据本地需求文档 `docs/X402_SERVICE_REQUIREMENTS.md`（REQ-01～05、AC-01～07）开展分析。
记录日期：2026-09-18。

## 本次范围与决策

复用已有 `services/open-meteo-weather/`，采用 TypeScript / Express，端点为
`GET /v1/forecast`，默认价格 `0.001` USD，目标网络为 `eip155:2368`（testnet）。
`src/kite.ts` 和公共 TypeScript / Go 模板未修改；所有定制限定在需要路径改写和查询参数认证的天气服务内。
运行配置、服务清单、目录索引与文档已同步。维护者按当前 Git remote owner 设为 `dajiangjunok`，
提交前须确认其为活动绑定账号。

本次未部署、未执行真实支付、未创建或推送 Commit；因此没有可填写的部署地址、交付 Commit SHA 或真实交易哈希。
清单保留零地址作为 draft 标记，运行时拒绝使用零地址；不得直接以该草稿配置上线。

## 严格差距分析与处理

| 原有差距 | 本次实现 | 剩余条件 |
| --- | --- | --- |
| `/v1/forecast` 被转发为不存在的上游 `/forecast` | 将配置中的上游 `/v1` 基础路径与去前缀的 `/forecast` 正确拼接；测试核对完整查询参数 | 使用商业上游完成真实请求 |
| README 把免费 API 描述为可收费代理 | 核查条款，默认客户 API；商业 Key 仅在服务端注入；拒绝免费端点 | 部署者配置订阅并确认用途与成本 |
| 没有限制只读上游方法与路径 | 精确 GET 路由、其他方法 405、其他路径 404，健康检查免费 | 无代码待办 |
| 没有明确的上游超时及完整响应失败处理 | 超时覆盖响应头及正文；断流、超大正文、错误数据、重定向不结算 | 无代码待办 |
| 错误信息、任意响应头可能暴露凭据 | 不透传异常细节、Cookie、认证头或上游伪造支付回执；反射凭据时拒绝响应 | 生产日志设施同样不得采集密钥 |
| 支付顺序依赖中间件，缺少验收证据 | 显式验证、完整读取上游、结算；用真实 SDK 和本机 HTTP 模拟依赖记录顺序 | 真实结算单独验收 |
| SDK 对部分结算通信错误的包装会模糊结果 | 直接使用 SDK 的 Facilitator 结算客户端；一次请求；通信异常返回结果未知 | 结果未知时核查链上状态 |
| `.env` 复制后不会自动加载 | 开发启动脚本显式加载本机 `.env`；容器使用平台注入 | 填入真实配置 |
| 缺少交付、CI、验收证据 | Dockerfile、CI 测试、线上采集脚本、完整本地日志和源文件指纹 | 完成公开部署和本人付费 |

## 验收矩阵

| 编号 | 当前结果 | 证据与边界 |
| --- | --- | --- |
| AC-01 未付费 402 | 本地通过；线上待执行 | 主网/测试网挑战的网络、资产、EIP-712 域、整数金额和收款方断言；verify/upstream/settle 调用均为零 |
| AC-02 成功顺序与结算 | 本地模拟通过；真实结算待执行 | 日志明确记录 `verify → upstream → upstream:complete → settle`；成功回执与天气一起返回；结算失败不返回天气或成功回执 |
| AC-03 无效支付 | 本地通过 | 无效签名仅调用 verify；畸形支付头不调用 Facilitator；验证异常不调用上游或 settle |
| AC-04 上游失败不扣费 | 本地通过 | 400/401/404/429/500/503、响应头超时、正文超时、连接拒绝、断流、重定向、错误 JSON、超限与凭据反射，均断言没有 settle |
| AC-05 所有部署端点真实 2xx | **未通过：待执行** | 清单示例只在模拟上游执行过；缺少公开 HTTPS 部署和商业上游 Key，没有实际天气响应 |
| AC-06 清单校验 | **通过** | 根目录 `npm run validate`，退出码 0，`✓ 1 service manifest(s) valid` |
| AC-07 本人真实付费 | **未通过：待执行** | 无本人签名付费调用、无链上交易；待确认验收网络并由贡献者配置钱包执行 |

对应需求：REQ-01/02 的本地行为已验证；REQ-04 清单结构校验通过，部署元信息仍待填；
REQ-03、REQ-05 尚未满足。需求文档要求全部通过，因此不能标记整体完成或升级服务状态。

## 实际检查结果

完整输出：[evidence/local-checks.txt](evidence/local-checks.txt)。
执行时间：2026-09-18T15:13:12Z 起；环境：Node.js v25.2.1、macOS arm64。
该日志包含命令、目录、时间、退出码、全部测试名称及模拟调用顺序。
[checked-files.json](evidence/checked-files.json) 记录被测源码、配置和测试文件的 SHA-256，便于复核结果对应的文件版本。

| 检查 | 结果 |
| --- | --- |
| 根目录 `npm run validate` | 退出码 0；1 个服务清单通过 |
| 天气服务 `npm run typecheck` | 退出码 0 |
| 天气服务 `npm test`（含 `npm run build`） | 退出码 0；**33/33 通过** |
| `node --check scripts/acceptance.mjs` | 退出码 0 |
| `node --check scripts/acceptance-lib.mjs` | 退出码 0 |
| TypeScript 公共模板 `npm run typecheck` | 本次另行执行，退出码 0；模板源码未修改 |
| `git diff --check` | 本次另行执行，退出码 0 |
| 线上验收脚本无配置预检 | 预期退出码 1，在 configuration 阶段停止；没有请求上游或支付网络 |

无配置预检输出见 [online-readiness.txt](evidence/online-readiness.txt)，
机器记录见 [online-2026-09-18T15-15-39.060Z.json](evidence/online-2026-09-18T15-15-39.060Z.json)。
其 `outcome` 是 `failed_or_incomplete`、端点记录为空，只证明缺少部署配置时拒绝继续。

初次依赖下载遇到沙箱 DNS 限制，本机 HTTP 测试遇到沙箱端口权限限制；通过工具审批后完成下载和本机测试。
首轮可运行的测试发现结算异常状态误判，修复后所有测试通过，最终输出以上述日志为准。
未运行 Docker 镜像构建（本机没有 Docker），未运行 Go 检查（本机没有 Go，且公共模板未改动）。
已增加 Node.js 22 的 CI 作业，但本次没有远程 CI 运行结果；本地结果不能冒充 CI 或容器验收。

复现方式：

```bash
# 仓库根目录
npm ci
cd services/open-meteo-weather
npm ci
npm run evidence
```

该命令会覆盖本地证据日志和文件指纹，不需要任何密钥，也不会发送真实支付。

## 条款、成本与真实性

核查日期 2026-09-18，依据 Open-Meteo 官方[条款](https://open-meteo.com/en/terms)、
[商业订阅说明](https://open-meteo.com/en/pricing)与[端点文档](https://open-meteo.com/en/docs)。
免费 API 限定非商业用途；收费代理改用商业客户 API。数据使用与再分发依据 CC BY 4.0 并保留署名，
不向买方转交订阅账户或 API Key。商业订阅是否覆盖部署者具体用途及最终订阅成本仍由部署者确认。
尚未发生商业上游请求，不把官方文档示例或模拟天气数据写成上游在线可用性证明。

## 完成线上验收所需条件

### 继续验收前的真实网络只读检查

2026-09-18T15:34:20Z～15:34:25Z 已访问公开基础设施，结果见
[infrastructure-preflight.json](evidence/infrastructure-preflight.json)：

- `GET https://facilitator.pieverse.io/v2/supported` 返回 200，支持 `x402Version: 2`、`exact`、`eip155:2368`。
- 对 `https://rpc-testnet.gokite.ai` 执行 `eth_chainId`、`eth_getCode` 和只读 `eth_call`，确认链 ID 为 2368，
  配置的 pieUSD 地址存在合约，`name()` 为 `pieUSD`、`decimals()` 为 18，与代码配置一致。
- 此检查未调用 `/verify` 或 `/settle`，未签名、未转账；不证明真实付费验收通过，也不改变 AC-05 / AC-07 的待完成状态。
- 当前没有服务 `.env`、公开部署地址、实际收款地址或上游商业凭据；等待贡献者提供非敏感配置并在本机或托管平台配置密钥。

### 后续步骤

1. 配置商业 Open-Meteo 订阅及 Key，或提供允许该用途的自托管天气 API；密钥仅在本机或平台 Secrets 设置。
2. 提供可公开访问的 HTTPS origin 和实际收款钱包地址，同步清单与部署配置；维护者账号须与活动绑定账号一致。
3. 确认活动接受测试网还是要求主网。优先测试网；由贡献者在本机配置自有付款钱包，并准备相应网络代币。
4. 部署后执行 `npm run acceptance`，再由本人执行 `npm run acceptance -- --paid`。
   采集器逐端点执行清单示例，核对 2xx 天气字段、回执、链上成功状态和匹配付款人/收款人/资产/金额的 Transfer 日志。
5. 审阅生成的 `evidence/online-*.json`。只有 `paid_acceptance_passed` 才能作为本工具完成真实付费验收的结果；
   将该记录链接补入本文件，记录实际部署 Commit SHA，更新状态为对应的 `testnet` 或 `live`，同步服务索引并重新运行校验。

若通过 kpass 完成本人调用，保留等价的请求、响应、时间、网络、金额、交易哈希和链上结算证明。
如果活动另行要求 Passport 身份关联，还需补充相应证明。没有完成以上步骤前，服务继续保持 `draft`。
