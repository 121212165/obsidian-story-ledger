/* Story Ledger —— 生长式创作台账（配角/地点/钩子三账本）
 * 仿《戒梦百条》生长台账格式：markdown 表格，状态 ②待登场 ①已登场 ◐已展开 ✓已回收。
 * 命令：
 *   登记配角 / 登记地点 / 埋钩子 —— 弹窗填表，追加到台账对应小节
 *   钩子对账 —— 列出未回收钩子；陈账（长期未动）高亮提醒
 *   打开台账
 * 台账文件不存在时自动创建（含三节表头与规则注释）。
 */
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, TFile } = require("obsidian");

const VIEW_TYPE = "story-ledger-view";
const STATUS = [
  ["②", "待登场"], ["①", "已登场"], ["◐", "已展开"], ["✓", "已回收"],
];
const SECTION_MARKERS = ["## 一、配角登记簿", "## 二、地点登记簿", "## 三、钩子账"];

const TEMPLATE = [
  "# 生长台账",
  "",
  "> 规则：有名有姓有功能才入账；地点须出过场才入账；钩子未回收不销账。",
  "> 状态：② 待登场 ① 已登场 ◐ 已展开 ✓ 已回收；（陈）= 6章以上未动，决策前必检。",
  "",
  "## 一、配角登记簿",
  "",
  "| 人物 | 身份/功能 | 状态 | 首登场 | 备注（生长方向） |",
  "|---|---|---|---|---|",
  "",
  "## 二、地点登记簿",
  "",
  "| 地点 | 功能 | 状态 | 首登场 |",
  "|---|---|---|---|",
  "",
  "## 三、钩子账",
  "",
  "| # | 钩子 | 埋于 | 计划回收 | 状态 |",
  "|---|---|---|---|---|",
  "",
].join("\n");

module.exports = class StoryLedger extends Plugin {
  async onload() {
    this.settings = Object.assign({}, { ledgerFile: "生长台账.md" }, await this.loadData());

    this.addRibbonIcon("book-text", "生长台账", () => this.openLedger());
    this.addCommand({ id: "open-ledger", name: "打开台账", callback: () => this.openLedger() });
    this.addCommand({ id: "add-character", name: "登记配角", callback: () => new CharacterModal(this).open() });
    this.addCommand({ id: "add-location", name: "登记地点", callback: () => new LocationModal(this).open() });
    this.addCommand({ id: "add-hook", name: "埋钩子", callback: () => new HookModal(this).open() });
    this.addCommand({ id: "reconcile-hooks", name: "钩子对账（未回收清单）", callback: () => this.openView() });
    this.addSettingTab(new LedgerSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new LedgerView(leaf, this));
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
  async saveSettings() { await this.saveData(this.settings); }

  async openLedger() {
    const f = await this.ensureFile();
    this.app.workspace.getLeaf("tab").openFile(f);
  }

  async ensureFile() {
    let f = this.app.vault.getAbstractFileByPath(this.settings.ledgerFile);
    if (!f) {
      f = await this.app.vault.create(this.settings.ledgerFile, TEMPLATE);
      new Notice("台账已创建：" + this.settings.ledgerFile);
    }
    return f;
  }

  /** 在台账第 section 小节（0/1/2）表尾追加一行 */
  async appendRow(sectionIdx, row) {
    const file = await this.ensureFile();
    const cur = await this.app.vault.read(file);
    const lines = cur.split("\n");
    // 找到该小节起点，再找下一个空行结尾（表格尾）
    const start = lines.findIndex((l) => l.startsWith(SECTION_MARKERS[sectionIdx]));
    if (start < 0) { new Notice("台账缺小节：" + SECTION_MARKERS[sectionIdx]); return; }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (SECTION_MARKERS.some((m) => lines[i].startsWith(m))) { end = i; break; }
    }
    // 从小节尾部往上找最后一个非空行
    let insertAt = end;
    while (insertAt > start && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, row);
    await this.app.vault.modify(file, lines.join("\n"));
    new Notice("已入账");
  }

  /** 解析台账三节表格为结构化数据 */
  async parse() {
    const file = await this.ensureFile();
    const cur = await this.app.vault.read(file);
    const lines = cur.split("\n");
    const out = { chars: [], locs: [], hooks: [] };
    let sec = -1;
    for (const l of lines) {
      if (l.startsWith(SECTION_MARKERS[0])) sec = 0;
      else if (l.startsWith(SECTION_MARKERS[1])) sec = 1;
      else if (l.startsWith(SECTION_MARKERS[2])) sec = 2;
      if (!l.startsWith("|") || l.includes("---")) continue;
      const c = l.split("|").slice(1, -1).map((s) => s.trim());
      if (sec === 0 && c.length >= 5 && c[0] !== "人物") out.chars.push(c);
      if (sec === 1 && c.length >= 4 && c[0] !== "地点") out.locs.push(c);
      if (sec === 2 && c.length >= 5 && c[0] !== "#") out.hooks.push(c);
    }
    return out;
  }

  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    leaf.view.render();
  }

  /** 取当前章节号（文件名里的数字，如 "第12章" → 12）用于陈账判断 */
  currentChapter() {
    const v = this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView);
    if (!v || !v.file) return null;
    const m = v.file.basename.match(/(\d+)\s*章?$/);
    return m ? parseInt(m[1]) : null;
  }
};

// ================= 登记弹窗 =================
class LedgerModalBase extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; }
  field(parent, label, ph, opts) {
    const row = parent.createDiv();
    row.style.cssText = "display:flex; gap:8px; align-items:center; margin-bottom:6px;";
    row.createEl("label", { text: label, attr: { style: "width:76px; font-size:12px; font-weight:600;" } });
    let el;
    if (opts && opts.select) {
      el = row.createEl("select");
      for (const [v, t] of opts.select) {
        const o = el.createEl("option", { text: t, value: v });
        if (opts.default && v === opts.default) o.selected = true;
      }
    } else {
      el = row.createEl("input", { type: "text", placeholder: ph || "" });
      el.style.flex = "1";
    }
    return el;
  }
  okCancel(parent, okLabel, onOk) {
    const btns = parent.createDiv();
    btns.style.cssText = "display:flex; gap:8px; justify-content:flex-end; margin-top:8px;";
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    const ok = btns.createEl("button", { text: okLabel, cls: "mod-cta" });
    ok.onclick = async () => { await onOk(); this.close(); };
  }
}

class CharacterModal extends LedgerModalBase {
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "登记配角" });
    const name = this.field(contentEl, "人物", "萧砚辞");
    const role = this.field(contentEl, "身份/功能", "摄政王，三像：朝堂杀神/…（生长方向写备注）");
    const status = this.field(contentEl, "状态", "", { select: STATUS, default: "①" });
    const chapter = this.field(contentEl, "首登场", "第1章（留空自动取当前章节号）");
    const note = this.field(contentEl, "备注", "每章可长：…");
    this.okCancel(contentEl, "入账", async () => {
      if (!name.value.trim()) { new Notice("人物名必填"); return; }
      const ch = chapter.value.trim() || (this.plugin.currentChapter() ? `第${this.plugin.currentChapter()}章` : "—");
      await this.plugin.appendRow(0, `| ${name.value.trim()} | ${role.value.trim()} | ${status.value} | ${ch} | ${note.value.trim()} |`);
    });
  }
}

class LocationModal extends LedgerModalBase {
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "登记地点" });
    const name = this.field(contentEl, "地点", "长宁观");
    const func = this.field(contentEl, "功能", "圣女居所，戒梦百条立账处");
    const status = this.field(contentEl, "状态", "", { select: STATUS, default: "①" });
    const chapter = this.field(contentEl, "首登场", "留空自动取当前章节号");
    this.okCancel(contentEl, "入账", async () => {
      if (!name.value.trim()) { new Notice("地点必填"); return; }
      const ch = chapter.value.trim() || (this.plugin.currentChapter() ? `第${this.plugin.currentChapter()}章` : "—");
      await this.plugin.appendRow(1, `| ${name.value.trim()} | ${func.value.trim()} | ${status.value} | ${ch} |`);
    });
  }
}

class HookModal extends LedgerModalBase {
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "埋钩子" });
    const desc = this.field(contentEl, "钩子", "铜管断口齿痕=先皇钥匙（谁也不知道）");
    const chapter = this.field(contentEl, "埋于", "留空自动取当前章节号");
    const plan = this.field(contentEl, "计划回收", "第16-17章（v2.3 起必填）");
    this.okCancel(contentEl, "入账", async () => {
      if (!desc.value.trim()) { new Notice("钩子描述必填"); return; }
      const data = await this.plugin.parse();
      const num = data.hooks.length + 1;
      const ch = chapter.value.trim() || (this.plugin.currentChapter() ? `第${this.plugin.currentChapter()}章` : "—");
      await this.plugin.appendRow(2, `| H${num} | ${desc.value.trim()} | ${ch} | ${plan.value.trim() || "待定"} | ② |`);
    });
  }
}

// ================= 对账面板 =================
class LedgerView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "钩子对账"; }
  getIcon() { return "book-text"; }

  async onOpen() { await this.render(); }
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h4", { text: "钩子对账（未回收不销账）" });
    const data = await this.plugin.parse();
    const curCh = this.plugin.currentChapter();
    const open = data.hooks.filter((h) => !h[4].includes("✓"));
    if (!open.length) {
      contentEl.createEl("div", { text: "✅ 所有钩子已回收。" });
      return;
    }
    const refresh = contentEl.createEl("button", { text: "刷新" });
    refresh.style.marginBottom = "8px";
    refresh.onclick = () => this.render();
    for (const h of open) {
      const buriedAt = (h[2].match(/(\d+)/) || [])[1];
      const age = curCh && buriedAt ? curCh - parseInt(buriedAt) : null;
      const stale = age != null && age >= 6;
      const item = contentEl.createDiv();
      item.style.cssText = "padding:6px 8px; margin-bottom:4px; border:1px solid var(--background-modifier-border); border-radius:6px; cursor:pointer;" +
        (stale ? " border-left:3px solid var(--text-warning);" : "");
      item.createEl("div", {
        text: `${h[0]} ${stale ? "（陈·" + age + "章未动）" : ""}`,
        attr: { style: "font-weight:600;" + (stale ? " color:var(--text-warning);" : "") },
      });
      item.createEl("div", { text: h[1], attr: { style: "font-size:12px;" } });
      item.createEl("div", {
        text: `埋于${h[2]} ｜ 计划回收：${h[3] || "待定"} ｜ 状态：${h[4]}`,
        attr: { style: "font-size:11px; color:var(--text-muted);" },
      });
      item.onclick = () => this.plugin.openLedger();
    }
  }
  onClose() { this.contentEl.empty(); }
}

class LedgerSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("台账文件").setDesc("库内路径，不存在自动创建（默认在库根目录）").addText((t) =>
      t.setValue(this.plugin.settings.ledgerFile).onChange(async (v) => {
        this.plugin.settings.ledgerFile = v.trim() || "生长台账.md";
        await this.plugin.saveSettings();
      }));
  }
}
