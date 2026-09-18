# 项目开发提示词

## 适用范围与依据

- 本文件适用于整个 `kite-x402-services` 仓库，供 AI 编程助手开展开发、检查和整理交付材料时使用。
- 活动要求整理自用户提供的《KiteAI 开发者活动（Bounty）参与与提交指南》（`PARTICIPANT_GUIDE.md`）；技术约束依据本仓库的 `README.md`、`CONTRIBUTING.md`、manifest schema 和 CI 配置。
- 开始任务前先阅读相关目录的说明与现有实现，延续项目约定。活动指南中的提交、绑定、部署等流程是背景要求，不代表用户已要求执行这些操作；按当前任务的授权范围开展工作。

## 研发方向与范围

- 根据用户当前目标选择方向，不需要同时实现所有活动方向。本仓库直接相关的方向为：
  - `x402-service`：将 HTTP API 包装为可发现、可调用的 x402 付费服务。
  - `x402-wrapper`：补充可运行、可测试的其他语言 Wrapper 模板，与现有模板保持环境变量和 `/v1/*` 路由规范一致。
  - `x402-evaluation`：评估候选端点的真实性、计费行为与稳定性，提供可复查的评估报告和巡检机制。
- `passport-skills-eval`、`passport-defi-authorization` 和 `seller-agent` 属于指南中的其他方向；仅在用户明确提出相关需求时扩展到这些方向。

## x402 开发约束

- 未付费访问受保护接口必须返回 `402 Payment Required` 和有效的 `PAYMENT-REQUIRED` 头。
- 严格保持 `verify → upstream → settle` 顺序，仅在上游返回状态码小于 400 时结算；验证失败或上游调用失败不得扣费。
- `/v1/*` 为付费代理路由，转发时移除 `/v1` 前缀；`/healthz` 免费。只读上游应限制允许的 HTTP 方法。
- 新语言模板保持现有环境变量契约，包括 `PAY_TO`、`KITE_NETWORK`、`UPSTREAM_URL`、`PRICE_USD` 和可选的上游认证配置；详细配置以模板的 `.env.example` 为准。
- 修改公共模板行为时同步维护现有 TypeScript 和 Go 模板的一致性，并为新增模板提供运行与验证说明。
- 优先通过配置接入服务，只有上游需要请求改写等行为时才修改代理代码；普通服务接入保持 `kite.ts` / `kite.go` 的网络与价格处理逻辑不变。
- Facilitator 地址保留 `/v2`；EIP-712 的 name/version 必须与结算代币匹配。USD 价格使用最多 6 位小数的十进制字符串，支付挑战中的金额使用整数代币单位。
- 不提交 `.env`、私钥或上游 API 密钥，不在日志或买方响应中暴露认证信息；上游凭据由代理注入。

## 服务交付与验证

- 新服务放在 `services/<name>/`，目录名使用小写字母、数字和连字符，并与 manifest 的 `name` 一致。
- 提供 Wrapper 源码、`service.yaml`、`README.md` 和适用的 `.env.example`；新增服务时更新 `services/README.md`。
- Manifest 遵循 `schema/service.schema.json`，不随意增加未知字段；说明上游用途、部署方法、调用示例及允许代理或转售的条款依据。
- 部署后的 `base_url` 必须是公开可访问的 HTTPS origin，不含路径；每个端点提供经实际验证返回 2xx 的 `example_request`。
- 服务状态遵循 `draft → testnet → live`：只有对应网络已部署且完成真实付费调用，才升级状态；不得把本地或模拟测试表述为线上验收成功。
- 根据改动运行相关检查：manifest 使用根目录的 `npm run validate`；TypeScript 在对应项目执行 `npm run typecheck`；Go 模板执行 `go build ./...` 与 `go vet ./...`。以 `.github/workflows/ci.yml` 为检查依据。
- 支付流程改动应验证未付费 402、验证失败不调用上游、上游失败不结算，以及成功后的结算行为。需要端到端验收时优先使用 testnet，并记录真实的调用输出或交易哈希。
- 交付说明写明功能变化、验证命令及结果、尚未完成的验收与原因；不编造测试结果、Commit SHA、部署地址或交易哈希。

## Bounty 提交与持续迭代

- 采用“单仓库持续演进”模式：首次登记后，后续周次在同一仓库中继续迭代，不为每周打卡新建或更换仓库。
- 参与活动前需连接接收奖励的 EVM 钱包并完成 GitHub 账号绑定；提交仓库的 Owner 必须与绑定账号一致，活动仓库必须持续保持 Public。
- 首周提交材料包含贡献方向、GitHub 仓库 URL、初始 Commit SHA、功能说明与验收材料。
- 第 2 周起将新增工作推送至已登记仓库的默认分支，提交当周新增的最新 Commit SHA 和对应 Changelog；看板会锁定历史仓库，无需重复填写地址。
- 每周交付应包含实质性的代码推进、逻辑修改或功能迭代；不得通过空提交、只改标点或空格等方式刷取活动记录。测试、维护和文档完善应说明实际价值，不将纯格式调整包装为功能交付。
- 提交前检查 Git 作者信息能否关联至绑定的 GitHub 账号；`user.name` / `user.email` 建议与该账号保持一致。
- 收到 `CHANGES_REQUESTED` 时，根据审核意见补充修改，推送后使用新的 Commit SHA 重新提交。
- 按所提供指南，首次技术审核通过后的 `EC PR审核中 / EC处理中` 表示 Electric Capital 收录流程正在外部排队，不影响当周打卡积分。
- Commit 遵循 Conventional Commits；贡献服务的 PR 保持一项服务一个 PR，并按 `.github/PULL_REQUEST_TEMPLATE.md` 整理说明和验收证据。
