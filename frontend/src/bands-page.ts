import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import {
  apiFetch,
  ApiError,
  formatBand,
  formatTime,
  type Band,
  type BandChange,
  type LogRow,
  type Session,
} from "./api";

type BandDraft = { lower: string; upper: string };

/**
 * 功率档合格带台专页：上区各档上下限、中区改档流水、下区认领快照说明，三区并列。
 * 观察员只读；技师可改档。档位数据全部来自 /api，与入库值同源。
 */
@customElement("yaw-bands-page")
export class YawBandsPage extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .zones {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
    }
    section.zone {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      border: 1px solid #334155;
    }
    h2 {
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
      color: #7dd3fc;
    }
    .hint {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0 0 0.75rem;
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
    input.deg {
      width: 5.5rem;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
    }
    button {
      cursor: pointer;
      padding: 0.4rem 0.9rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
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
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .note {
      color: #cbd5e1;
      font-size: 0.9rem;
      line-height: 1.6;
      background: #0f172a;
      border: 1px dashed #475569;
      border-radius: 6px;
      padding: 0.75rem 0.9rem;
      margin: 0 0 0.75rem;
    }
  `;

  @property({ attribute: false }) session!: Session;

  @state() private bands: Band[] = [];
  @state() private changes: BandChange[] = [];
  @state() private claimed: LogRow[] = [];
  @state() private drafts: Record<string, BandDraft> = {};
  @state() private error = "";
  @state() private saving = "";

  private _timer?: number;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
    this._timer = window.setInterval(() => void this.refresh(), 2500);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timer) clearInterval(this._timer);
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async refresh() {
    if (!this.session) return;
    try {
      const [bands, changes, logs] = await Promise.all([
        apiFetch<Band[]>(this.session, "/api/bands"),
        apiFetch<BandChange[]>(this.session, "/api/band-changes"),
        apiFetch<LogRow[]>(this.session, "/api/logs"),
      ]);
      this.bands = bands;
      this.changes = changes;
      this.claimed = logs
        .filter((r) => r.status === "done" && r.band_lower_snap !== null)
        .slice(0, 8);
      // 只在尚未编辑该档时用入库值铺底，避免轮询冲掉正在输入的改档草稿。
      const drafts = { ...this.drafts };
      for (const b of bands) {
        if (!drafts[b.code]) {
          drafts[b.code] = { lower: String(b.lower_deg), upper: String(b.upper_deg) };
        }
      }
      this.drafts = drafts;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.dispatchEvent(new CustomEvent("unauthorized", { bubbles: true, composed: true }));
      }
    }
  }

  private async saveBand(band: Band) {
    const draft = this.drafts[band.code];
    if (!draft) return;
    this.error = "";
    this.saving = band.code;
    try {
      await apiFetch<Band>(this.session, `/api/bands/${band.code}`, {
        method: "PUT",
        body: JSON.stringify({
          lower_deg: Number(draft.lower),
          upper_deg: Number(draft.upper),
        }),
      });
      // 清掉该档草稿，让下一轮刷新用入库值重新铺底（前后端同源）。
      const drafts = { ...this.drafts };
      delete drafts[band.code];
      this.drafts = drafts;
      await this.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.dispatchEvent(new CustomEvent("unauthorized", { bubbles: true, composed: true }));
        return;
      }
      this.error = err instanceof Error ? err.message : "改档失败";
    } finally {
      this.saving = "";
    }
  }

  private renderBandsZone() {
    return html`
      <section class="zone" id="zone-band-limits">
        <h2>上区 · 各档上下限</h2>
        <p class="hint">
          判定吃该档现行闭区间（端点含在内）。${this.isWriter
            ? "技师可在此改档，保存即生效并记入改档流水。"
            : "观察员仅可浏览，无权改档。"}
        </p>
        <table>
          <thead>
            <tr>
              <th>功率档</th>
              <th>下限°</th>
              <th>上限°</th>
              <th>最近改档人</th>
              <th>改档时间</th>
              ${this.isWriter ? html`<th>改档</th>` : nothing}
            </tr>
          </thead>
          <tbody>
            ${this.bands.map((b) => {
              const draft = this.drafts[b.code] ?? {
                lower: String(b.lower_deg),
                upper: String(b.upper_deg),
              };
              return html`
                <tr>
                  <td>${b.name}</td>
                  <td>${b.lower_deg}</td>
                  <td>${b.upper_deg}</td>
                  <td>${b.updated_by ?? "—"}</td>
                  <td>${formatTime(b.updated_at)}</td>
                  ${this.isWriter
                    ? html`
                        <td>
                          <input
                            class="deg"
                            type="number"
                            step="0.1"
                            aria-label="${b.name}下限"
                            .value=${draft.lower}
                            @input=${(e: Event) =>
                              (this.drafts = {
                                ...this.drafts,
                                [b.code]: {
                                  ...draft,
                                  lower: (e.target as HTMLInputElement).value,
                                },
                              })}
                          />
                          ~
                          <input
                            class="deg"
                            type="number"
                            step="0.1"
                            aria-label="${b.name}上限"
                            .value=${draft.upper}
                            @input=${(e: Event) =>
                              (this.drafts = {
                                ...this.drafts,
                                [b.code]: {
                                  ...draft,
                                  upper: (e.target as HTMLInputElement).value,
                                },
                              })}
                          />
                          <button
                            ?disabled=${this.saving === b.code}
                            @click=${() => this.saveBand(b)}
                          >
                            保存改档
                          </button>
                        </td>
                      `
                    : nothing}
                </tr>
              `;
            })}
          </tbody>
        </table>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
      </section>
    `;
  }

  private renderChangesZone() {
    return html`
      <section class="zone" id="zone-band-changes">
        <h2>中区 · 改档流水</h2>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>功率档</th>
              <th>旧闭区间</th>
              <th>新闭区间</th>
              <th>操作人</th>
            </tr>
          </thead>
          <tbody>
            ${this.changes.map(
              (c) => html`
                <tr>
                  <td>${formatTime(c.changed_at)}</td>
                  <td>${c.band_name}</td>
                  <td>${formatBand(c.old_lower_deg, c.old_upper_deg)}</td>
                  <td>${formatBand(c.new_lower_deg, c.new_upper_deg)}</td>
                  <td>${c.changed_by}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderSnapshotZone() {
    return html`
      <section class="zone" id="zone-claim-snapshot">
        <h2>下区 · 认领快照说明</h2>
        <p class="note">
          单据被后台认领的瞬间，系统把该档当时的上下限写入单据快照，判定吃快照闭区间；
          之后即使改档，已被认领的单据仍沿用认领当时写入快照的那一档上下限，结论不回溯。
          下表为最近已认领单据的快照留痕。
        </p>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>功率档</th>
              <th>快照闭区间</th>
              <th>误差°</th>
              <th>结论</th>
            </tr>
          </thead>
          <tbody>
            ${this.claimed.map(
              (r) => html`
                <tr>
                  <td>${r.id}</td>
                  <td>${r.turbine_code}</td>
                  <td>${r.band_name ?? "—"}</td>
                  <td>${formatBand(r.band_lower_snap, r.band_upper_snap)}</td>
                  <td>${r.yaw_err_deg}</td>
                  <td>
                    ${r.verdict
                      ? html`<span class="tag ${r.verdict === "合格" ? "ok" : "bad"}"
                          >${r.verdict}</span
                        >`
                      : "—"}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    return html`
      <div class="zones">
        ${this.renderBandsZone()} ${this.renderChangesZone()}
        ${this.renderSnapshotZone()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-bands-page": YawBandsPage;
  }
}
