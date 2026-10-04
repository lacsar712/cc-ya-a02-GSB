# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按**功率档合格带闭区间**写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 功率档分带判定

- 合格判定按功率档分带：每档各自维护一条闭区间 `[下限°, 上限°]`（端点含在内），误差落在闭区间内判「合格」，否则判「偏航超差」。
- 档位表入库于 `power_bands`（种子：微风档、大功率档，默认 ±1.5°）。页面点选项、提交校验、worker 判定全部读同一张表，前后端同源。
- 顶栏「功率档合格带台」专页三区并列：
  - **上区 · 各档上下限**：档位表；技师可改档（保存即生效），观察员只读。
  - **中区 · 改档流水**：每次改档的旧/新闭区间、操作人、时间。
  - **下区 · 认领快照说明**：快照机制说明 + 最近已认领单据的快照留痕。
- 新单必须点选功率档，漏选整单退回（`POST /api/logs` 400）。
- 判定吃该档**现行**闭区间：worker 认领瞬间把该档当时的上下限写入单据快照（`band_lower_snap` / `band_upper_snap`）并按快照判定；已被认领的单据之后即使改档也不回溯。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交、可改档 |
| observer | obs123456 | 只读（可看档位表与改档流水，无权改档、无权报送） |

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bands` | 档位表（登录即可） |
| PUT/POST | `/api/bands/<code>` | 改档，体 `{lower_deg?, upper_deg?}`，仅技师，写改档流水 |
| GET | `/api/band-changes` | 改档流水（登录即可） |
| GET | `/api/logs` | 对中记录（含功率档与认领快照） |
| POST | `/api/logs` | 新单，体 `{turbine_code, yaw_err_deg, band_code}`，仅技师；漏选档位 400 整单退回 |

## 启动

```bash
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」，均挂微风档快照 ±1.5°。
2. technician 提交新记录（必点功率档）后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论；漏选功率档整单退回。
3. observer 可查看列表、档位表与改档流水，无提交表单、无改档控件（接口同样 403）。
4. 分带判定：把微风档上限改成 1.0°，报微风档 1.2° 判「偏航超差」；改回 1.5° 后同样 1.2° 判「合格」。此前已认领的单据仍沿用认领当时写入快照的上下限，结论不回溯。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
