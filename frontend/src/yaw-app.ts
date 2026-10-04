import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import {
  apiFetch,
  ApiError,
  formatBand,
  type Band,
  type LogRow,
  type Session,
} from "./api";
import "./bands-page";

type View = "logs" | "bands";

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.6rem 1.25rem;
      background: #0b1220;
      border-bottom: 1px solid #334155;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .brand {
      font-size: 1.15rem;
      font-weight: 700;
      color: #38bdf8;
      margin-right: 0.5rem;
    }
    .topbar nav {
      display: flex;
      gap: 0.5rem;
    }
    .topbar nav button {
      background: transparent;
      color: #cbd5e1;
      border: 1px solid transparent;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      font-weight: 600;
    }
    .topbar nav button.active {
      background: #164e63;
      color: #a5f3fc;
      border-color: #0e7490;
    }
    .topbar nav button:hover {
      border-color: #475569;
    }
    .spacer {
      flex: 1;
    }
    .who {
      color: #94a3b8;
      font-size: 0.85rem;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 1.25rem 1.5rem 2rem;
    }
    .sub {
      color: #94a3b8;
      margin: 0 0 1.25rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
      color: #7dd3fc;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
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
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .band-picker {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    .band-option {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.8rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #cbd5e1;
      cursor: pointer;
      font-size: 0.9rem;
      margin-bottom: 0;
    }
    .band-option.chosen {
      border-color: #38bdf8;
      background: #164e63;
      color: #a5f3fc;
    }
    .band-option input {
      width: auto;
      margin: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
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
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
  `;

  @state() private session: Session | null = null;
  @state() private view: View = "logs";
  @state() private logs: LogRow[] = [];
  @state() private bands: Band[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private selectedBand = "";
  @state() private error = "";
  @state() private loading = false;

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

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async refreshAll() {
    if (!this.session) return;
    try {
      const [logs, bands] = await Promise.all([
        apiFetch<LogRow[]>(this.session, "/api/logs"),
        apiFetch<Band[]>(this.session, "/api/bands"),
      ]);
      this.logs = logs;
      this.bands = bands;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.logout();
      }
      /* 其余瞬时错误忽略，下一轮轮询再试 */
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
    this.bands = [];
    this.view = "logs";
    localStorage.removeItem("yaw_session");
  }

  private async submitLog() {
    this.error = "";
    if (!this.selectedBand) {
      this.error = "新单必须点选功率档，漏选整单退回";
      return;
    }
    if (!this.session) return;
    this.loading = true;
    try {
      await apiFetch<LogRow>(this.session, "/api/logs", {
        method: "POST",
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
          band_code: this.selectedBand,
        }),
      });
      this.turbineCode = "";
      this.yawErr = "";
      this.selectedBand = "";
      await this.refreshAll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.logout();
        return;
      }
      this.error = err instanceof Error ? err.message : "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private renderLogin() {
    return html`
      <main>
        <h1 style="color:#38bdf8;margin:0 0 0.25rem;">风机偏航对中台</h1>
        <p class="sub">
          偏航合格判定按功率档分带：新单必须点选功率档，判定吃该档现行闭区间。
        </p>
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
          ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
        </section>
      </main>
    `;
  }

  private renderTopbar() {
    return html`
      <div class="topbar">
        <span class="brand">风机偏航对中台</span>
        <nav>
          <button
            class=${this.view === "logs" ? "active" : ""}
            @click=${() => (this.view = "logs")}
          >
            对中记录
          </button>
          <button
            class=${this.view === "bands" ? "active" : ""}
            @click=${() => (this.view = "bands")}
          >
            功率档合格带台
          </button>
        </nav>
        <span class="spacer"></span>
        <span class="who">
          ${this.session?.username}（${this.isWriter ? "技师·可提交可改档" : "观察员·只读"}）
        </span>
        <button class="secondary" @click=${this.logout}>退出</button>
      </div>
    `;
  }

  private renderSubmitForm() {
    if (!this.isWriter) return nothing;
    return html`
      <section>
        <h2>提交偏航记录</h2>
        <label>机组编号</label>
        <input
          placeholder="例如 W12"
          .value=${this.turbineCode}
          @input=${(e: Event) =>
            (this.turbineCode = (e.target as HTMLInputElement).value)}
        />
        <label>功率档（必点，漏选整单退回）</label>
        <div class="band-picker" role="radiogroup" aria-label="功率档">
          ${this.bands.map(
            (b) => html`
              <label
                class="band-option ${this.selectedBand === b.code ? "chosen" : ""}"
              >
                <input
                  type="radio"
                  name="band"
                  .checked=${this.selectedBand === b.code}
                  @change=${() => (this.selectedBand = b.code)}
                />
                ${b.name} ${formatBand(b.lower_deg, b.upper_deg)}
              </label>
            `,
          )}
        </div>
        <label>偏航误差（度，可正可负）</label>
        <input
          type="number"
          step="0.1"
          .value=${this.yawErr}
          @input=${(e: Event) =>
            (this.yawErr = (e.target as HTMLInputElement).value)}
        />
        <button ?disabled=${this.loading} @click=${this.submitLog}>
          提交（进入待认领队列）
        </button>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
      </section>
    `;
  }

  private renderLogsView() {
    return html`
      ${this.renderSubmitForm()}
      <section>
        <div class="row-actions" style="margin-bottom:0.5rem;">
          <h2 style="margin:0;">对中记录</h2>
          <span class="spacer"></span>
          <button class="secondary" ?disabled=${this.loading} @click=${this.refreshAll}>
            刷新列表
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>功率档</th>
              <th>误差°</th>
              <th>状态</th>
              <th>结论</th>
              <th>判定带（认领快照）</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td>${row.band_name ?? "—"}</td>
                  <td>${row.yaw_err_deg}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td>${formatBand(row.band_lower_snap, row.band_upper_snap)}</td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return this.renderLogin();
    }

    return html`
      ${this.renderTopbar()}
      <main
        @unauthorized=${() => this.logout()}
      >
        ${this.view === "logs"
          ? this.renderLogsView()
          : html`<yaw-bands-page .session=${this.session}></yaw-bands-page>`}
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
