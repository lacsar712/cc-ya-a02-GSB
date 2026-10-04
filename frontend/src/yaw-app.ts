import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
  gear_key: string | null;
  gear_label: string | null;
  snap_lower_deg: number | null;
  snap_upper_deg: number | null;
  claimed_at: string | null;
};

type Gear = {
  gear_key: string;
  label: string;
  lower_deg: number;
  upper_deg: number;
  updated_by: string | null;
  updated_at: string;
};

type GearChange = {
  id: number;
  gear_key: string;
  gear_label: string | null;
  old_lower_deg: number | null;
  old_upper_deg: number | null;
  new_lower_deg: number;
  new_upper_deg: number;
  changed_by: string;
  changed_at: string;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type GearDraft = { lower: string; upper: string };

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 0 1.5rem 1.5rem;
      max-width: 1100px;
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 1rem 0;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid #334155;
    }
    h1 {
      margin: 0;
      font-size: 1.35rem;
      color: #38bdf8;
    }
    .topbar .spacer {
      flex: 1;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    .sub {
      color: #94a3b8;
      margin: 0.4rem 0 1.25rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    .band h3 {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      color: #7dd3fc;
    }
    .bands {
      display: flex;
      gap: 1rem;
      align-items: stretch;
    }
    .bands .band {
      flex: 1 1 0;
      min-width: 0;
      margin-bottom: 0;
    }
    @media (max-width: 900px) {
      .bands {
        flex-direction: column;
      }
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input,
    select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
      font-family: inherit;
    }
    .band input {
      margin-bottom: 0;
      width: 100%;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button.nav-active {
      background: #0369a1;
      outline: 2px solid #38bdf8;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
      vertical-align: top;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
      white-space: nowrap;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .msg {
      color: #86efac;
      margin-top: 0.5rem;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.82rem;
      line-height: 1.6;
    }
    .mono {
      font-family: ui-monospace, Consolas, monospace;
      white-space: nowrap;
    }
    .gear-row {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .gear-name {
      font-weight: 600;
    }
    .gear-meta {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 0.25rem;
    }
    .band input.bound {
      width: 5.5rem;
      text-align: right;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: "logs" | "gears" = "logs";
  @state() private logs: LogRow[] = [];
  @state() private gears: Gear[] = [];
  @state() private changes: GearChange[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private gearKey = "";
  @state() private error = "";
  @state() private gearError = "";
  @state() private gearMsg = "";
  @state() private loading = false;
  @state() private editingGear: string | null = null;
  @state() private drafts: Record<string, GearDraft> = {};

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshAll();
        this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async refreshAll() {
    await Promise.all([
      this.refreshLogs(),
      this.refreshGears(),
      this.refreshChanges(),
    ]);
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshGears() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/gears", { headers: this.authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as Gear[];
      this.gears = data;
      // 正在编辑的那一行不被轮询覆盖；其余行同步服务端现值（前后端同源）。
      const drafts = { ...this.drafts };
      for (const g of data) {
        if (this.editingGear !== g.gear_key) {
          drafts[g.gear_key] = {
            lower: String(g.lower_deg),
            upper: String(g.upper_deg),
          };
        }
      }
      this.drafts = drafts;
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshChanges() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/gear-changes", {
        headers: this.authHeaders(),
      });
      if (!res.ok) return;
      this.changes = (await res.json()) as GearChange[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.refreshAll();
      this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.gears = [];
    this.changes = [];
    this.view = "logs";
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    // 前端先拦：功率档必须点选；后端会再次强校验，漏选整单退回。
    if (!this.gearKey) {
      this.error = "新单必须点选功率档，漏选功率档整单退回";
      return;
    }
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
          gear_key: this.gearKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      this.gearKey = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private startEditGear(gear: Gear) {
    this.editingGear = gear.gear_key;
    this.gearError = "";
    this.gearMsg = "";
    this.drafts = {
      ...this.drafts,
      [gear.gear_key]: {
        lower: String(gear.lower_deg),
        upper: String(gear.upper_deg),
      },
    };
  }

  private cancelEditGear() {
    this.editingGear = null;
    void this.refreshGears();
  }

  private async saveGear(gear: Gear) {
    this.gearError = "";
    this.gearMsg = "";
    const draft = this.drafts[gear.gear_key];
    const lower = Number(draft?.lower);
    const upper = Number(draft?.upper);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      this.gearError = "上下限必须是数字";
      return;
    }
    if (lower > upper) {
      this.gearError = "下限不能大于上限";
      return;
    }
    try {
      const res = await fetch(`/api/gears/${gear.gear_key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ lower_deg: lower, upper_deg: upper }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.gearError = data.detail || "改档失败";
        return;
      }
      this.editingGear = null;
      this.gearMsg = `${gear.label} 闭区间已改为 [${lower}°, ${upper}°]，仅对改档后认领的单据生效`;
      await this.refreshAll();
    } catch {
      this.gearError = "改档时网络异常";
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private fmtTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString("zh-CN", { hour12: false });
  }

  private renderLogin() {
    return html`
      <h1 style="margin-top:1.5rem;">风机偏航对中台</h1>
      <p class="sub">现场技师提交偏航误差，后台 worker 认领后按功率档闭区间给出合格或偏航超差结论。</p>
      <section>
        <label>用户名</label>
        <input
          .value=${this.loginUser}
          @input=${(e: Event) =>
            (this.loginUser = (e.target as HTMLInputElement).value)}
        />
        <label>密码</label>
        <input
          type="password"
          .value=${this.loginPass}
          @input=${(e: Event) =>
            (this.loginPass = (e.target as HTMLInputElement).value)}
        />
        <button ?disabled=${this.loading} @click=${this.login}>登录</button>
        ${this.error ? html`<p class="err">${this.error}</p>` : null}
      </section>
    `;
  }

  private renderTopBar() {
    return html`
      <div class="topbar">
        <h1>风机偏航对中台</h1>
        <button
          class="secondary ${this.view === "logs" ? "nav-active" : ""}"
          @click=${() => (this.view = "logs")}
        >
          偏航记录
        </button>
        <button
          class="secondary ${this.view === "gears" ? "nav-active" : ""}"
          @click=${() => (this.view = "gears")}
        >
          功率档合格带
        </button>
        <span class="spacer"></span>
        <span class="who">
          ${this.session!.username}（${this.isWriter ? "现场技师·可报送/改档" : "观察员·只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>
    `;
  }

  private renderLogsView() {
    return html`
      <p class="sub">
        偏航合格判定按功率档分带：新单必须点选功率档，worker 认领时冻结该档现行闭区间快照并据此判定。
      </p>

      ${this.isWriter
        ? html`
            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录（新单）</h2>
              <label>机组编号</label>
              <input
                placeholder="例如 W12"
                .value=${this.turbineCode}
                @input=${(e: Event) =>
                  (this.turbineCode = (e.target as HTMLInputElement).value)}
              />
              <label>偏航误差（度，可正可负）</label>
              <input
                type="number"
                step="0.1"
                .value=${this.yawErr}
                @input=${(e: Event) =>
                  (this.yawErr = (e.target as HTMLInputElement).value)}
              />
              <label>功率档（必选，漏选整单退回）</label>
              <select
                .value=${this.gearKey}
                @change=${(e: Event) =>
                  (this.gearKey = (e.target as HTMLSelectElement).value)}
              >
                <option value="">请选择功率档…</option>
                ${this.gears.map(
                  (g) => html`
                    <option value=${g.gear_key}>
                      ${g.label}（合格闭区间 ${g.lower_deg}° ~ ${g.upper_deg}°）
                    </option>
                  `
                )}
              </select>
              <button ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
              ${this.error ? html`<p class="err">${this.error}</p>` : null}
            </section>
          `
        : html`
            <section>
              <p class="hint" style="margin:0;">
                观察员仅可浏览偏航记录、档位表与改档流水，无权改档也无权报送。
              </p>
            </section>
          `}

      <section>
        <div
          style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;"
        >
          <h2 style="margin:0;font-size:1.1rem;">对中记录</h2>
          <button
            class="secondary"
            ?disabled=${this.loading}
            @click=${this.refreshLogs}
          >
            刷新列表
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>误差°</th>
              <th>功率档</th>
              <th>状态</th>
              <th>结论</th>
              <th>认领快照闭区间</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td class="mono">${row.yaw_err_deg}</td>
                  <td>${row.gear_label ?? "—"}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待认领" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td class="mono">
                    ${row.snap_lower_deg != null && row.snap_upper_deg != null
                      ? html`[${row.snap_lower_deg}°, ${row.snap_upper_deg}°]<br/>
                        <span style="color:#94a3b8;font-size:0.75rem;">
                          ${this.fmtTime(row.claimed_at)}
                        </span>`
                      : html`<span style="color:#fde68a;">认领时写入</span>`}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderGearBounds() {
    return html`
      <section class="band">
        <h3>上区 · 各档上下限（现行闭区间）</h3>
        ${this.gears.map((g) => {
          const draft = this.drafts[g.gear_key] ?? {
            lower: String(g.lower_deg),
            upper: String(g.upper_deg),
          };
          const editing = this.editingGear === g.gear_key;
          return html`
            <div class="gear-row">
              <div>
                <div class="gear-name">${g.label}</div>
                <div class="gear-meta">
                  ${this.fmtTime(g.updated_at)} · ${g.updated_by ?? "—"}
                </div>
              </div>
              ${editing
                ? html`
                    <input
                      class="bound"
                      type="number"
                      step="0.1"
                      inputmode="decimal"
                      aria-label="${g.label}下限"
                      .value=${draft.lower}
                      @input=${(e: Event) =>
                        (this.drafts = {
                          ...this.drafts,
                          [g.gear_key]: {
                            ...draft,
                            lower: (e.target as HTMLInputElement).value,
                          },
                        })}
                    />
                    <input
                      class="bound"
                      type="number"
                      step="0.1"
                      inputmode="decimal"
                      aria-label="${g.label}上限"
                      .value=${draft.upper}
                      @input=${(e: Event) =>
                        (this.drafts = {
                          ...this.drafts,
                          [g.gear_key]: {
                            ...draft,
                            upper: (e.target as HTMLInputElement).value,
                          },
                        })}
                    />
                    <span style="display:flex;gap:0.35rem;">
                      <button @click=${() => this.saveGear(g)}>保存</button>
                      <button class="secondary" @click=${this.cancelEditGear}>
                        取消
                      </button>
                    </span>
                  `
                : html`
                    <span class="mono" style="text-align:right;">
                      [${g.lower_deg}°, ${g.upper_deg}°]
                    </span>
                    <span></span>
                    <span>
                      ${this.isWriter
                        ? html`<button
                            class="secondary"
                            ?disabled=${this.editingGear !== null}
                            @click=${() => this.startEditGear(g)}
                          >
                            改档
                          </button>`
                        : html`<span class="hint">只读</span>`}
                    </span>
                  `}
            </div>
          `;
        })}
        ${this.gears.length === 0
          ? html`<p class="hint">档位表加载中…</p>`
          : null}
        ${this.isWriter
          ? html`<p class="hint" style="margin-bottom:0;">
              闭区间含端点：下限 ≤ 误差 ≤ 上限判合格。保存即写入档位表并追加一条改档流水。
            </p>`
          : html`<p class="hint" style="margin-bottom:0;">观察员无权改档。</p>`}
      </section>
    `;
  }

  private renderGearChanges() {
    return html`
      <section class="band">
        <h3>中区 · 改档流水</h3>
        <div style="max-height:22rem;overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>档位</th>
                <th>旧闭区间</th>
                <th>新闭区间</th>
                <th>改档人</th>
              </tr>
            </thead>
            <tbody>
              ${this.changes.map(
                (c) => html`
                  <tr>
                    <td style="white-space:nowrap;">${this.fmtTime(c.changed_at)}</td>
                    <td>${c.gear_label ?? c.gear_key}</td>
                    <td class="mono">
                      ${c.old_lower_deg != null && c.old_upper_deg != null
                        ? `[${c.old_lower_deg}°, ${c.old_upper_deg}°]`
                        : "—"}
                    </td>
                    <td class="mono">[${c.new_lower_deg}°, ${c.new_upper_deg}°]</td>
                    <td>${c.changed_by}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
          ${this.changes.length === 0
            ? html`<p class="hint">暂无改档记录。</p>`
            : null}
        </div>
      </section>
    `;
  }

  private renderSnapshotNote() {
    return html`
      <section class="band">
        <h3>下区 · 认领快照说明</h3>
        <p class="hint">
          1. 偏航合格判定按功率档分带，每档是一个含端点的闭区间。<br />
          2. 新单必须点选功率档；漏选功率档整单退回，不进入待认领队列。<br />
          3. 判定吃该档<strong>现行</strong>闭区间：worker 用行锁认领 pending 单据的同一事务内，
          读取该档当下上下限并写入单据快照。<br />
          4. 已认领的单据继续沿用认领当时写入快照的那一档上下限；之后再改档，
          不会改变这些单据的结论，只影响改档后新认领的单据。<br />
          5. 档位表入库值是唯一数据源：本页上下限与新单下拉点选项同源，
          均取自后端 <span class="mono">GET /api/gears</span>，前端无任何硬编码档位。<br />
          6. 观察员仅可浏览档位表与改档流水，无权改档也无权报送。
        </p>
      </section>
    `;
  }

  private renderGearsView() {
    return html`
      <p class="sub">
        功率档合格带台专页：上区各档上下限，中区改档流水，下区认领快照说明，三区并列。
      </p>
      <div class="bands">
        ${this.renderGearBounds()}
        ${this.renderGearChanges()}
        ${this.renderSnapshotNote()}
      </div>
      ${this.gearError ? html`<p class="err">${this.gearError}</p>` : null}
      ${this.gearMsg ? html`<p class="msg">${this.gearMsg}</p>` : null}
    `;
  }

  render() {
    if (!this.session) {
      return this.renderLogin();
    }
    return html`
      ${this.renderTopBar()}
      ${this.view === "logs" ? this.renderLogsView() : this.renderGearsView()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
