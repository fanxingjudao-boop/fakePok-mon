/* ============================================================
 * 記録帳(操作パネル)— DOM。実寸で描くのでスマホでも文字が読め、ボタンは 44px 以上。
 *   ・技の選択(フォーカス/ホバーで戦場のタイムラインに「次の番の位置」を予告)
 *   ・対象の選択(予想ダメージ・弱点・鎮められるかを表示)
 *   ・戦況ボード(行動順・場・敵の予告・HP)
 * ============================================================ */
import type { Action, BattleState, Skill, SkillCategory, Unit } from '../core/types.ts';
import {
  allies, canPacify, enemies, estimateDamage, fieldForecast, intentForecast, isActive,
  pacifyBlockReason, previewTimeline, skillOptions, unit, validTargets, type SkillOption,
} from '../core/battle.ts';
import { ELEMENT_NAME, RP_MAX } from '../core/rules.ts';
import { skill as skillById } from '../data/skills.ts';
import { unitDef } from '../data/units.ts';
import { ART } from '../data/art.ts';
import type { Cmd, InputHub } from '../input.ts';

export interface ChooseHooks {
  /** 技にフォーカスした: その重さで次の番がどこに来るかを戦場に表示(null で解除) */
  preview(weight: number | null): void;
  /** 対象にフォーカスした: 戦場で強調 */
  highlight(uids: string[]): void;
}

type Phase = 'wait' | 'choose' | 'anim';
const CAT_LABEL: Record<SkillCategory, string> = {
  skill: '技', resonance: '共鳴技', command: '行動', art: '環術', item: 'アイテム', enemy: '',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const elBadge = (el: string) => `<span class="wk" style="background:var(--el-${el})">${esc(ELEMENT_NAME[el as keyof typeof ELEMENT_NAME])}</span>`;
const sideColor = (u: Unit) => (u.side === 'ally' ? 'var(--ally)' : u.side === 'enemy' ? 'var(--enemy)' : 'var(--gold)');

/** 顔アイコン。絵は CSS で一度だけ読み込み、HTML にはクラス名だけを書く(再描画のたびに画像データを埋め込まない) */
let portraitCss = false;
function ensurePortraitCss(): void {
  if (portraitCss || typeof document === 'undefined') return;
  portraitCss = true;
  const rules = Object.entries(ART).filter(([, a]) => a.img).map(([k, a]) => `.pt-${k}{background-image:url("${a.img}")}`);
  const el = document.createElement('style');
  el.textContent = rules.join('\n');
  document.head.appendChild(el);
}
const portrait = (u: Unit, size = '') => {
  const art = unitDef(u.defId).art;
  const has = !!ART[art]?.img;
  return `<span class="pt ${u.side}${size ? ` ${size}` : ''}${has ? ` pt-${art}` : ''}${u.side === 'enemy' ? ' flip' : ''}" aria-hidden="true">${has ? '' : esc(u.name.slice(0, 1))}</span>`;
};

export class Dock {
  auto = false;
  onToggleAuto?: (v: boolean) => void;
  onOpenSettings?: () => void;
  onOpenHelp?: () => void;
  onToggleFullscreen?: () => void;
  canFullscreen = false;

  private b: BattleState | null = null;
  private actor: Unit | null = null;
  private phase: Phase = 'wait';
  private note = '';
  private log = '';
  private cat: SkillCategory = 'skill';
  private chosen: Skill | null = null;
  private hooks: ChooseHooks | null = null;
  private resolveFn: ((a: Action) => void) | null = null;
  private unlisten: (() => void) | null = null;
  private memoHtml = '';
  /** 戦況の開閉(null = 画面の大きさに合わせる: 詰め表示では閉じる) */
  private boardOpen: boolean | null = null;
  private compact = false;
  /** 記録帳の外にメモを出す場所(横向きの詰め表示では戦場の下の空きに出して、技の一覧を広く取る) */
  private memoOut: HTMLElement | null = null;
  private readonly root: HTMLElement;
  private readonly input: InputHub;

  constructor(root: HTMLElement, input: InputHub) {
    this.root = root;
    this.input = input;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('pointerover', (e) => this.onHover(e));
    root.addEventListener('focusin', (e) => this.onHover(e));
    root.addEventListener('toggle', (e) => {
      const d = e.target as HTMLElement;
      if (d.tagName === 'DETAILS') this.boardOpen = (d as HTMLDetailsElement).open;
    }, true);
    // 数字キーで技・対象を直接選ぶ(1〜9)
    window.addEventListener('keydown', (e) => {
      if (this.phase !== 'choose' || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const btn = this.root.querySelector<HTMLButtonElement>(`.panel .cmd[data-key="${n}"]`);
      if (btn && !btn.disabled) { e.preventDefault(); btn.focus(); btn.click(); }
    });
    ensurePortraitCss();
  }

  /* ---------- 外部から ---------- */
  render(b: BattleState, phase: Phase, actorUid?: string | null, note = ''): void {
    this.b = b;
    this.phase = phase;
    this.actor = actorUid ? unit(b, actorUid) : null;
    this.note = note;
    this.draw();
  }

  /** 記録帳のメモ欄(ヒントや出来事)。戦場の上に重ねないので視界を遮らない */
  memo(html: string, kind: 'tip' | 'info' | 'warn' = 'info'): void {
    this.memoHtml = `<div class="memo ${kind}">${kind === 'tip' ? '<span class="memo-k">ヒント</span>' : ''}<span class="memo-t">${html}</span><button class="memo-x" type="button" data-act="memo-x" aria-label="メモを閉じる">×</button></div>`;
    this.paintMemo();
  }

  clearMemo(): void { this.memoHtml = ''; this.paintMemo(); }

  private paintMemo(): void {
    const inner = this.root.querySelector('.memo-slot');
    if (inner) inner.innerHTML = this.memoOut ? '' : this.memoHtml;
    if (this.memoOut) this.memoOut.innerHTML = this.memoHtml;
  }

  /** 背の低い画面向けの詰め表示(説明文を1行に、戦況は既定で閉じる) */
  setCompact(v: boolean, memoOut: HTMLElement | null = null): void {
    if (this.compact === v && this.memoOut === memoOut) return;
    if (this.memoOut && this.memoOut !== memoOut) this.memoOut.innerHTML = '';
    if (memoOut && !memoOut.dataset.wired) {
      memoOut.dataset.wired = '1';
      memoOut.addEventListener('click', (e) => this.onClick(e));
    }
    this.compact = v;
    this.memoOut = memoOut;
    if (this.b) this.draw();
    else this.paintMemo();
  }

  setLog(text: string): void {
    this.log = text;
    const el = this.root.querySelector('.log');
    if (el) el.textContent = text;
  }

  /** 味方・巡環士の行動を選ばせる */
  choose(b: BattleState, actor: Unit, hooks: ChooseHooks): Promise<Action> {
    this.b = b;
    this.actor = actor;
    this.phase = 'choose';
    this.hooks = hooks;
    this.chosen = null;
    const cats = this.categories();
    if (!cats.includes(this.cat)) this.cat = cats[0];
    this.draw();
    this.focusFirst();
    this.unlisten?.();
    this.unlisten = this.input.on((cmd, ev) => this.onCmd(cmd, ev));
    return new Promise<Action>((resolve) => { this.resolveFn = resolve; });
  }

  /** 戦場のスプライトがタップされた(対象選択中なら決定) */
  pickFromCanvas(uid: string): void {
    if (this.phase !== 'choose' || !this.chosen || !this.b || !this.actor) return;
    const ok = validTargets(this.b, this.actor, this.chosen).some((t) => t.uid === uid);
    if (ok) this.finish({ skillId: this.chosen.id, target: uid });
  }

  cancel(): void {
    this.unlisten?.(); this.unlisten = null;
    this.resolveFn = null;
    this.hooks = null;
    this.phase = 'wait';
  }

  /* ---------- 描画 ---------- */
  private categories(): SkillCategory[] {
    if (!this.b || !this.actor) return [];
    const opts = skillOptions(this.b, this.actor);
    const order: SkillCategory[] = ['skill', 'resonance', 'command', 'art', 'item'];
    return order.filter((c) => opts.some((o) => o.skill.category === c));
  }

  private draw(): void {
    const b = this.b;
    if (!b) { this.root.innerHTML = ''; return; }
    const a = this.actor;
    const head = `
      <div class="dock-head">
        <div class="actor-chip" style="--side:${a ? sideColor(a) : 'var(--faint)'}">
          ${a ? portrait(a, 'lg') : '<span class="pt lg"></span>'}
          <span class="who-col">
            <span class="who"><span class="nm">${a ? esc(a.name) : '—'}</span><span class="sub">${a ? (a.side === 'enemy' ? 'の行動' : 'の番') : ''}</span></span>
            <span class="rp" role="img" aria-label="共鳴ゲージ ${b.rp}/${RP_MAX}">
              ${Array.from({ length: RP_MAX }, (_, i) => `<span class="pip${i < b.rp ? ' on' : ''}${i === 4 ? ' mark' : ''}"></span>`).join('')}
              <span class="val num">${b.rp}<span class="max">/${RP_MAX}</span></span>
            </span>
          </span>
        </div>
        <button class="iconbtn" type="button" data-act="auto" aria-pressed="${this.auto}" title="味方の行動をAIにまかせる">おまかせ</button>
        ${this.canFullscreen && !this.compact ? '<button class="iconbtn" type="button" data-act="fullscreen" aria-label="全画面" title="全画面">⛶</button>' : ''}
        <button class="iconbtn" type="button" data-act="settings" aria-label="設定" title="設定">${this.compact ? '⚙' : '設定'}</button>
        ${this.compact ? '' : '<button class="iconbtn" type="button" data-act="help" aria-label="遊び方">?</button>'}
      </div>`;
    this.root.innerHTML = `${head}<div class="memo-slot" aria-live="polite">${this.memoOut ? '' : this.memoHtml}</div><div class="panel">${this.panelHtml()}</div><div class="log" aria-live="polite">${esc(this.log)}</div>${this.boardHtml()}`;
    if (this.memoOut) this.memoOut.innerHTML = this.memoHtml;
  }

  private panelHtml(): string {
    const b = this.b as BattleState;
    const a = this.actor;
    if (this.phase !== 'choose' || !a) {
      return `<div class="waiting">${this.note ? esc(this.note) : a ? `<b>${esc(a.name)}</b> が行動中…` : '…'}</div>`;
    }
    if (this.chosen) return this.targetHtml(b, a, this.chosen);
    const cats = this.categories();
    const opts = skillOptions(b, a).filter((o) => o.skill.category === this.cat);
    const tabs = cats.length > 1
      ? `<div class="tabs" role="tablist">${cats.map((c) => `<button class="tab" type="button" role="tab" data-cat="${c}" aria-selected="${c === this.cat}">${CAT_LABEL[c]}</button>`).join('')}</div>`
      : '';
    return `${tabs}<div class="cmds">${opts.map((o, i) => this.skillBtn(o, i + 1)).join('')}</div>`;
  }

  /** この重さの技を使うと、次の自分の番は何番目か */
  private nextTurnAfter(weight: number): number {
    if (!this.b || !this.actor) return 0;
    const tl = previewTimeline(this.b, 12, weight);
    return tl.findIndex((x) => x.uid === this.actor?.uid) + 1;
  }

  private skillBtn(o: SkillOption, key: number): string {
    const s = o.skill;
    const el = s.elements.length > 1 ? 'none' : s.elements[0];
    const elLabel = s.elements.length > 1 ? '共' : ELEMENT_NAME[s.elements[0]];
    const power = s.power ? `<span class="tag num">威力${s.power}${s.hits && s.hits > 1 ? `×${s.hits}` : ''}</span>` : '';
    const cost = s.cost ? `<span class="tag cost num">RP${s.cost}</span>` : '';
    const item = s.item && this.b ? `<span class="tag num">残${this.b.items[s.item]}</span>` : '';
    const desc = o.usable ? esc(s.desc) : `<span style="color:var(--danger)">${esc(o.reason ?? '')}</span> ・ ${esc(s.desc)}`;
    const title = esc(`${s.name}: ${s.desc}${o.usable ? '' : `(${o.reason ?? ''})`}`);
    const nx = this.nextTurnAfter(s.weight);
    const speed = `<span class="tag ${s.weight <= 0.8 ? 'fast' : s.weight >= 1.2 ? 'heavy' : ''}" title="この技を使った後、次に自分の番が来る順番">次の番 ${nx > 0 ? `${nx}番目` : '—'}</span>`;
    const members = s.category === 'resonance' && s.partners && this.b
      ? `<span class="members">${s.partners.map((m) => { const u = this.b?.units.find((x) => x.defId === m); return u ? portrait(u, 'sm') : ''; }).join('')}</span>` : '';
    return `<button class="cmd${s.category === 'resonance' ? ' resonance' : ''}" type="button" data-skill="${s.id}" data-key="${key}" title="${title}" ${o.usable ? '' : 'disabled'}>
        <span class="el" style="background:${s.elements.length > 1 ? 'var(--hekikan)' : `var(--el-${el})`}">${esc(elLabel)}</span>
        <span class="name">${key <= 9 ? `<kbd>${key}</kbd>` : ''}${esc(s.name)}${members}</span>
        <span class="meta">${power}${cost}${item}${speed}</span>
        <span class="desc${o.usable ? '' : ' why'}">${desc}</span>
      </button>`;
  }

  private targetHtml(b: BattleState, a: Unit, s: Skill): string {
    const list = s.target === 'enemy' ? enemies(b).filter(isActive)
      : s.target === 'ally' ? allies(b).filter(isActive)
        : allies(b).filter((u) => u.gone === 'ko');
    const valid = new Set(validTargets(b, a, s).map((t) => t.uid));
    const rows = list.map((t, i) => {
      const ok = valid.has(t.uid);
      const pct = Math.max(0, Math.round((t.hp / t.maxHp) * 100));
      let big = '';
      let sub = '';
      if (t.side === 'enemy') {
        if (s.kind === 'attack') {
          const dmg = estimateDamage(b, a, t, s);
          const weakKnown = s.elements.some((e) => t.revealed.includes(e));
          const kill = dmg >= t.hp;
          big = `<span class="dmg${kill ? ' kill' : ''}">約${dmg}${kill ? ' 倒せる' : ''}</span>`;
          if (weakKnown) big += '<span class="tag warn">弱点!</span>';
        }
        if (s.kind === 'pacify') big = ok ? '<span class="dmg ok">鎮められる</span>' : '';
        const shield = t.shieldMax ? `<span class="shield">${t.broken ? 'BREAK' : '■'.repeat(t.shield) + '□'.repeat(t.shieldMax - t.shield)}</span>` : '';
        sub = s.kind === 'pacify' && !ok ? esc(pacifyBlockReason(b, t) ?? '') : `${shield} 弱点 ${this.weakHtml(t)}`;
      } else {
        sub = `<span class="num">${t.hp}/${t.maxHp}</span> ${t.gone === 'ko' ? '倒れている' : t.status.coveredBy ? 'かばわれている' : ''}`;
      }
      return `<button class="cmd target" type="button" data-target="${t.uid}" data-key="${i + 1}" ${ok ? '' : 'disabled'}>
          ${portrait(t, 'md')}
          <span class="name"><kbd>${i + 1}</kbd>${esc(t.name)}</span>
          <span class="meta">${big}</span>
          <span class="desc"><span class="bar${t.side === 'enemy' ? ' enemy' : ''}"><i style="width:${pct}%"></i></span><span class="sub">${sub}</span></span>
        </button>`;
    }).join('');
    return `<div class="panel-title"><button class="back" type="button" data-act="back">← 戻る</button><span>対象を選ぶ: <b>${esc(s.name)}</b></span></div><div class="cmds">${rows}</div>`;
  }

  private weakHtml(t: Unit): string {
    if (!t.shieldMax) return '—';
    const known = t.weaknesses.filter((w) => t.revealed.includes(w)).map(elBadge).join('');
    const unknown = t.weaknesses.filter((w) => !t.revealed.includes(w)).map(() => '<span class="wk unknown">?</span>').join('');
    return known + unknown;
  }

  private boardHtml(): string {
    const b = this.b as BattleState;
    const tl = previewTimeline(b, 8);
    const now = b.actor ? unit(b, b.actor) : null;
    const chips = [
      now ? `<span class="chip now ${now.side}"><span class="n">今</span>${portrait(now, 'xs')}${esc(now.name)}</span>` : '',
      ...tl.map((x, i) => {
        const u = unit(b, x.uid);
        return `<span class="chip ${u.side}"><span class="n">${i + 1}</span>${portrait(u, 'xs')}${esc(u.side === 'player' ? 'ユウ' : u.name)}${x.recover ? '(立直)' : x.charge ? '(溜め)' : ''}</span>`;
      }),
    ].join('<span class="arrow" aria-hidden="true">›</span>');
    const f = fieldForecast(b);
    const fieldLine = `<div class="fieldline">場 ${elBadge(f.now)} あと${f.inTurns}手で ${elBadge(f.next)} へ ・ 同属性の技 ×1.25</div>`;
    const eRows = enemies(b).map((e) => {
      const gone = !isActive(e);
      const pct = Math.round((e.hp / e.maxHp) * 100);
      let intent = '';
      if (!gone) {
        if (e.broken) intent = '<span class="intent danger">BREAK中(1手休み)</span>';
        else {
          const fc = intentForecast(b, e);
          if (fc) {
            const s = fc.skill;
            if (s.kind === 'charge') intent = `<span class="intent danger">溜め → 次は「${esc(skillById(s.chargeInto ?? '').name)}」</span>`;
            else if (s.target === 'allEnemies') {
              const mx = Math.max(0, ...fc.targets.map((t) => t.dmg));
              intent = `<span class="intent${e.charging ? ' danger' : ''}">全体「${esc(s.name)}」約${mx}</span>`;
            } else if (s.target === 'enemy' && fc.targets[0]) {
              const t = unit(b, fc.targets[0].uid);
              const lethal = fc.targets[0].dmg >= t.hp;
              intent = `<span class="intent${lethal ? ' danger' : ''}">→${esc(t.name)}「${esc(s.name)}」約${fc.targets[0].dmg}${lethal ? ' 危険' : ''}</span>`;
            } else intent = `<span class="intent">「${esc(s.name)}」</span>`;
          }
        }
      }
      const pac = !gone && canPacify(b, e) ? '<span style="color:var(--hekikan)">鎮められる</span>' : '';
      return `<div class="row"><span class="nm${gone ? ' gone' : ''}">${esc(e.name)}</span>
        <div class="bar enemy"><i style="width:${pct}%"></i></div>
        <div class="info">${gone ? (e.gone === 'pacified' ? '鎮めた' : '倒れた') : `${e.shieldMax ? `<span class="shield">${e.broken ? 'BREAK' : '■'.repeat(e.shield) + '□'.repeat(e.shieldMax - e.shield)}</span>` : ''} 弱点 ${this.weakHtml(e)} ${intent} ${pac}`}</div></div>`;
    }).join('');
    const aRows = allies(b).map((u) => {
      const pct = Math.round((u.hp / u.maxHp) * 100);
      const st = [u.status.burn ? '燃焼' : '', u.status.regen ? '再生' : '', u.status.coveredBy ? 'かばわれ' : ''].filter(Boolean).join(' ');
      return `<div class="row"><span class="nm${u.gone ? ' gone' : ''}">${esc(u.name)}</span>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="info num">${u.hp}/${u.maxHp} ${esc(st)}</div></div>`;
    }).join('');
    const open = this.boardOpen ?? !this.compact;
    return `<details class="board"${open ? ' open' : ''}><summary>戦況(行動順・敵の予告・HP)</summary>
      <h3>行動順 <span class="legend"><i class="ally"></i>味方 <i class="enemy"></i>敵 <i class="player"></i>ユウ</span></h3><div class="tl">${chips}</div>${fieldLine}<h3>敵</h3>${eRows}<h3>仲間</h3>${aRows}</details>`;
  }

  /* ---------- 操作 ---------- */
  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || t.disabled) return;
    const act = t.dataset.act;
    if (act === 'auto') { this.auto = !this.auto; t.setAttribute('aria-pressed', String(this.auto)); this.onToggleAuto?.(this.auto); return; }
    if (act === 'settings') { this.onOpenSettings?.(); return; }
    if (act === 'help') { this.onOpenHelp?.(); return; }
    if (act === 'fullscreen') { this.onToggleFullscreen?.(); return; }
    if (act === 'memo-x') { this.clearMemo(); return; }
    if (this.phase !== 'choose' || !this.b || !this.actor) return;
    if (act === 'back') { this.back(); return; }
    if (t.dataset.cat) { this.cat = t.dataset.cat as SkillCategory; this.draw(); this.focusFirst(); return; }
    if (t.dataset.skill) {
      const s = skillById(t.dataset.skill);
      const needs = s.target === 'enemy' || s.target === 'ally' || s.target === 'allyKO';
      if (!needs) { this.finish({ skillId: s.id }); return; }
      const valid = validTargets(this.b, this.actor, s);
      if (valid.length === 1 && s.target === 'allyKO') { this.finish({ skillId: s.id, target: valid[0].uid }); return; }
      this.chosen = s;
      this.hooks?.preview(s.weight);
      this.draw();
      this.focusFirst();
      return;
    }
    if (t.dataset.target && this.chosen) this.finish({ skillId: this.chosen.id, target: t.dataset.target });
  }

  private onHover(e: Event): void {
    if (this.phase !== 'choose' || !this.hooks) return;
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t) return;
    if (t.dataset.skill) {
      const s = skillById(t.dataset.skill);
      this.hooks.preview(s.weight);
      this.markProjected(s.weight);
    } else if (t.dataset.target) this.hooks.highlight([t.dataset.target]);
  }

  /** 戦況ボードの行動順にも「次の番の位置」を示す */
  private markProjected(weight: number): void {
    if (!this.b || !this.actor) return;
    const tl = previewTimeline(this.b, 8, weight);
    const idx = tl.findIndex((x) => x.uid === this.actor?.uid);
    this.root.querySelectorAll('.tl .chip').forEach((c, i) => c.classList.toggle('proj', i === idx + 1));
  }

  private back(): void {
    if (this.chosen) {
      this.chosen = null;
      this.hooks?.highlight([]);
      this.draw();
      this.focusFirst();
    }
  }

  private finish(a: Action): void {
    const r = this.resolveFn;
    this.hooks?.preview(null);
    this.hooks?.highlight([]);
    this.cancel();
    this.chosen = null;
    this.draw();
    r?.(a);
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.root.querySelectorAll<HTMLButtonElement>('.panel .cmd:not([disabled])'));
  }

  private focusFirst(): void {
    const first = this.buttons()[0];
    if (first) first.focus({ preventScroll: true });
  }

  private onCmd(cmd: Cmd, ev?: Event): void {
    if (this.phase !== 'choose') return;
    const list = this.buttons();
    const cur = list.indexOf(document.activeElement as HTMLButtonElement);
    if (cmd === 'up' || cmd === 'down') {
      if (!list.length) return;
      const next = cur < 0 ? 0 : (cur + (cmd === 'down' ? 1 : -1) + list.length) % list.length;
      list[next].focus();
    } else if (cmd === 'left' || cmd === 'right') {
      const cats = this.categories();
      if (this.chosen || cats.length < 2) return;
      const i = cats.indexOf(this.cat);
      this.cat = cats[(i + (cmd === 'right' ? 1 : -1) + cats.length) % cats.length];
      this.draw();
      this.focusFirst();
    } else if (cmd === 'confirm') {
      // フォーカス中のボタンを押す(Space/Enter の既定動作は止めてあるのでここで押す)
      const el = document.activeElement as HTMLElement | null;
      const target = el && this.root.contains(el) && el.tagName === 'BUTTON' ? el : list[0];
      if (ev) ev.preventDefault();
      target?.click();
    } else if (cmd === 'back') {
      this.back();
    }
  }
}
