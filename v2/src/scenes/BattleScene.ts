/* ============================================================
 * 戦闘シーン(Phaser 4)— 描画と演出、タイミング入力、ターン進行
 * ルールはすべて core/battle.ts。ここは「見せ方」だけを受け持つ。
 * ============================================================ */
import Phaser from 'phaser';
import type { AudioEngine, SfxId } from '../audio/engine.ts';
import type { Action, BattleEvent, BattleState, Guard, Skill, Timing, Unit } from '../core/types.ts';
import {
  activeAllies, activeEnemies, createBattle, fieldForecast, intentForecast, isActive, isTimedSkill,
  performAction, performEnemy, previewTimeline, startTurn, unit,
} from '../core/battle.ts';
import { chooseAllyAction } from '../core/ai.ts';
import { ELEMENT_NAME, RP_MAX } from '../core/rules.ts';
import { skill } from '../data/skills.ts';
import { ENCOUNTERS } from '../data/encounters.ts';
import { unitDef } from '../data/units.ts';
import { ART, ELEMENT_COLOR, HEKIKAN } from '../data/art.ts';
import { drawBackdrop, drawCreature, drawPlayerEmblem } from '../art/placeholder.ts';
import type { Dock } from '../ui/dock.ts';
import type { InputHub } from '../input.ts';
import type { Settings } from '../settings.ts';

export interface BattleResult { encounterId: string; outcome: 'win' | 'lose'; stats: BattleState['stats'] }
export interface BattleHost {
  settings: Settings;
  audio: AudioEngine;
  dock: Dock;
  input: InputHub;
  toast(text: string, kind?: 'tip' | 'info' | 'warn'): void;
  /** 初回だけ出すヒント */
  tip(id: string, html: string): void;
  onEnd(r: BattleResult): void;
}

const W = 1280;
const H = 720;
const FONT = "'Hiragino Maru Gothic ProN','Zen Maru Gothic','BIZ UDPGothic','Yu Gothic','Meiryo',system-ui,sans-serif";
const col = (c: string) => parseInt(c.replace('#', ''), 16);
const C = {
  ally: 0x7cc4ff, enemy: 0xff6b78, player: 0xffc76a, hekikan: col(HEKIKAN), danger: 0xff5d6c,
  ink: 0x0b171b, panel: 0x102429, line: 0x28505a, text: 0xe6f2ef, gold: 0xffc76a, ok: 0x7be38a,
};
const ALLY_POS = [{ x: 955, y: 362 }, { x: 1112, y: 482 }, { x: 950, y: 612 }];
const ENEMY_POS: Record<number, { x: number; y: number }[]> = {
  1: [{ x: 330, y: 612 }],
  2: [{ x: 300, y: 420 }, { x: 300, y: 612 }],
  3: [{ x: 320, y: 358 }, { x: 165, y: 482 }, { x: 330, y: 615 }],
};
const PLAYER_POS = { x: 1210, y: 676 };
const BASE_SIZE = 172;

interface UView {
  uid: string;
  sprite: Phaser.GameObjects.Image;
  x: number; y: number; scale: number;
  hud: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  pips: Phaser.GameObjects.Container;
  status: Phaser.GameObjects.Text;
  intent: Phaser.GameObjects.Container | null;
  aura: Phaser.GameObjects.Graphics;
  sel: Phaser.GameObjects.Graphics;
  idle: Phaser.Tweens.Tween | null;
  shownHp: number;
}


export class BattleScene extends Phaser.Scene {
  static host: BattleHost;
  /** タイミング入力のリングが出ている間 true(自動テスト用) */
  static timingActive = false;
  private b!: BattleState;
  private encounterId = 'wild';
  private seed = 1;
  private views = new Map<string, UView>();
  private tlLayer!: Phaser.GameObjects.Container;
  private hudTop!: Phaser.GameObjects.Container;
  private lines!: Phaser.GameObjects.Graphics;
  private fieldWash!: Phaser.GameObjects.Rectangle;
  private logText!: Phaser.GameObjects.Text;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private shards!: Phaser.GameObjects.Particles.ParticleEmitter;
  private ambient: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private alive = true;
  private previewWeight: number | null = null;
  private highlighted: string[] = [];
  private curSkill: Skill | null = null;

  constructor() { super('battle'); }

  init(data: { encounterId: string; seed: number }): void {
    this.encounterId = data.encounterId;
    this.seed = data.seed;
    this.alive = true;
    this.views = new Map();
    this.previewWeight = null;
    this.highlighted = [];
    this.ambient = null;
  }

  private get host(): BattleHost { return BattleScene.host; }
  private get speed(): number { return this.host.settings.speed; }

  /* ---------------- 読み込み ---------------- */
  preload(): void {
    // ユーザー素材(下ごしらえ済みの透過WebP)があれば使う。無ければ手続き生成の仮絵
    for (const [key, a] of Object.entries(ART)) {
      const k = `user_${key}`;
      if (a.img && !this.textures.exists(k)) this.load.image(k, a.img);
    }
  }

  private ensureTextures(): void {
    const enc = ENCOUNTERS[this.encounterId];
    const bgKey = `bg_${enc.backdrop}`;
    if (!this.textures.exists(bgKey)) this.textures.addCanvas(bgKey, drawBackdrop(enc.backdrop, W, H));
    for (const [key, a] of Object.entries(ART)) {
      const k = `art_${key}`;
      if (this.textures.exists(k)) continue;
      if (a.spec) this.textures.addCanvas(k, drawCreature(a.spec, 384));
      else if (key === 'emblem') this.textures.addCanvas(k, drawPlayerEmblem(160));
    }
    if (!this.textures.exists('dot')) {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      const grd = g.createRadialGradient(8, 8, 0, 8, 8, 8);
      grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 16, 16);
      this.textures.addCanvas('dot', c);
    }
    if (!this.textures.exists('shard')) {
      const c = document.createElement('canvas'); c.width = 14; c.height = 14;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(7, 0); g.lineTo(14, 10); g.lineTo(2, 14); g.closePath(); g.fill();
      this.textures.addCanvas('shard', c);
    }
  }

  private artKey(defId: string): string {
    const art = unitDef(defId).art;
    return this.textures.exists(`user_${art}`) ? `user_${art}` : `art_${art}`;
  }

  private isUserArt(defId: string): boolean {
    return this.textures.exists(`user_${unitDef(defId).art}`);
  }

  /* ---------------- 構築 ---------------- */
  create(): void {
    this.ensureTextures();
    this.b = createBattle(this.encounterId, this.seed);
    const enc = ENCOUNTERS[this.encounterId];

    this.add.image(W / 2, H / 2, `bg_${enc.backdrop}`).setDisplaySize(W, H);
    this.fieldWash = this.add.rectangle(W / 2, H / 2, W, H, col(ELEMENT_COLOR[this.b.field]), 0.08).setBlendMode(Phaser.BlendModes.ADD);
    this.setAmbient();
    this.lines = this.add.graphics().setDepth(5);

    this.sparks = this.add.particles(0, 0, 'dot', {
      speed: { min: 140, max: 460 }, lifespan: { min: 280, max: 620 }, scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 }, gravityY: 380, emitting: false, blendMode: Phaser.BlendModes.ADD,
    }).setDepth(40);
    this.shards = this.add.particles(0, 0, 'shard', {
      speed: { min: 200, max: 620 }, lifespan: { min: 500, max: 1000 }, scale: { start: 1.6, end: 0.2 },
      rotate: { min: 0, max: 360 }, gravityY: 700, emitting: false, tint: C.gold,
    }).setDepth(41);

    // 巡環士ユウ(狙われない。行動順に並ぶ)
    const p = this.b.units.find((u) => u.side === 'player') as Unit;
    const emb = this.add.image(PLAYER_POS.x, PLAYER_POS.y, this.artKey(p.defId)).setOrigin(0.5, 1);
    // ユーザー素材(全身の立ち絵)は大きめに、仮の紋章は小さめに
    emb.setScale((this.isUserArt(p.defId) ? 124 : 84) / Math.max(emb.width, emb.height)).setDepth(8);
    const pname = this.add.text(PLAYER_POS.x, PLAYER_POS.y + 4, '巡環士ユウ', this.style(20, '#ffc76a')).setOrigin(0.5, 0).setDepth(8);
    this.views.set(p.uid, {
      uid: p.uid, sprite: emb, x: PLAYER_POS.x, y: PLAYER_POS.y, scale: emb.scale,
      hud: this.add.container(0, 0, [pname]), hpBar: this.add.graphics(), hpText: pname, pips: this.add.container(0, 0),
      status: pname, intent: null, aura: this.add.graphics(), sel: this.add.graphics(), idle: null, shownHp: 1,
    });

    // 味方・敵
    this.b.units.filter((u) => u.side === 'ally').forEach((u, i) => this.makeUnitView(u, ALLY_POS[i], false));
    const es = this.b.units.filter((u) => u.side === 'enemy');
    es.forEach((u, i) => this.makeUnitView(u, (ENEMY_POS[es.length] ?? ENEMY_POS[3])[i], true));

    // 上部の情報(行動順・場・共鳴ゲージ)と下部の実況
    this.tlLayer = this.add.container(0, 0).setDepth(50);
    this.hudTop = this.add.container(0, 0).setDepth(50);
    this.logText = this.add.text(W / 2, H - 22, '', this.style(24, '#e6f2ef')).setOrigin(0.5, 1).setDepth(50);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.alive = false; this.host.dock.cancel(); });
    this.refreshAll();
    void this.run();
  }

  private style(size: number, color = '#e6f2ef', stroke = 6): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: FONT, fontSize: `${size}px`, color, stroke: '#08110f', strokeThickness: stroke, fontStyle: 'bold', resolution: 2 };
  }

  private makeUnitView(u: Unit, pos: { x: number; y: number }, flip: boolean): void {
    const art = ART[unitDef(u.defId).art];
    const sprite = this.add.image(pos.x, pos.y, this.artKey(u.defId)).setOrigin(0.5, 0.96).setFlipX(flip);
    const box = BASE_SIZE * (this.isUserArt(u.defId) ? art.imgScale ?? art.scale : art.scale);
    const scale = box / Math.max(sprite.width, sprite.height);
    sprite.setScale(scale).setDepth(10 + pos.y / 100);
    sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    sprite.on('pointerdown', () => this.host.dock.pickFromCanvas(u.uid));

    const shadow = this.add.ellipse(pos.x, pos.y - 4, box * 0.62, box * 0.12, 0x000000, 0.35).setDepth(9 + pos.y / 100);
    void shadow;
    const aura = this.add.graphics().setDepth(9.5 + pos.y / 100);
    const sel = this.add.graphics().setDepth(9.4 + pos.y / 100);

    const hud = this.add.container(pos.x, pos.y + 8).setDepth(30 + pos.y / 100);
    const name = this.add.text(-86, 0, u.name, this.style(21, u.side === 'ally' ? '#cfe9ff' : '#ffd6da', 5)).setOrigin(0, 0);
    const hpBar = this.add.graphics();
    const hpText = this.add.text(86, 2, '', this.style(18, '#e6f2ef', 4)).setOrigin(1, 0);
    const pips = this.add.container(-86, 50);
    const status = this.add.text(-86, u.side === 'enemy' ? 76 : 50, '', this.style(17, '#ffc76a', 4)).setOrigin(0, 0);
    hud.add([hpBar, name, hpText, pips, status]);

    const idle = this.tweens.add({
      targets: sprite, scaleY: scale * 1.025, scaleX: scale * 0.99, duration: 1300 + (pos.y % 7) * 90,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.views.set(u.uid, {
      uid: u.uid, sprite, x: pos.x, y: pos.y, scale, hud, hpBar, hpText, pips, status,
      intent: null, aura, sel, idle, shownHp: u.hp,
    });
  }

  /* ---------------- 表示の更新 ---------------- */
  private refreshAll(): void {
    if (!this.alive) return;
    for (const u of this.b.units) if (u.side !== 'player') this.refreshUnit(u);
    this.refreshIntents();
    this.refreshTimeline();
    this.refreshTop();
  }

  private refreshUnit(u: Unit): void {
    const v = this.views.get(u.uid);
    if (!v) return;
    const gone = !isActive(u);
    v.hud.setAlpha(gone ? 0.35 : 1);
    // HPバー
    const w = 172;
    const pct = Math.max(0, u.hp / u.maxHp);
    v.hpBar.clear();
    v.hpBar.fillStyle(0x000000, 0.55).fillRoundedRect(-88, 28, w + 4, 16, 8);
    const hpCol = u.side === 'enemy' ? C.enemy : pct > 0.5 ? C.ok : pct > 0.25 ? C.gold : C.danger;
    if (pct > 0) v.hpBar.fillStyle(hpCol, 1).fillRoundedRect(-86, 30, Math.max(10, w * pct), 12, 6);
    v.hpText.setText(u.side === 'ally' ? `${u.hp}/${u.maxHp}` : `${Math.round(pct * 100)}%`);
    // 盾と弱点(敵のみ)
    v.pips.removeAll(true);
    if (u.side === 'enemy' && u.shieldMax > 0 && !gone) {
      const g = this.add.graphics();
      for (let i = 0; i < u.shieldMax; i++) {
        const on = !u.broken && i < u.shield;
        g.fillStyle(on ? C.gold : 0x2a3a3e, 1).fillRoundedRect(i * 19, 0, 15, 17, 4);
        g.lineStyle(2, 0x08110f, 1).strokeRoundedRect(i * 19, 0, 15, 17, 4);
      }
      v.pips.add(g);
      let x = u.shieldMax * 19 + 10;
      for (const wk of u.weaknesses) {
        const known = u.revealed.includes(wk);
        const c = this.add.graphics();
        c.fillStyle(known ? col(ELEMENT_COLOR[wk]) : 0x24343a, 1).fillCircle(x + 11, 9, 12);
        c.lineStyle(2, 0x08110f, 1).strokeCircle(x + 11, 9, 12);
        const t = this.add.text(x + 11, 9, known ? ELEMENT_NAME[wk] : '?', this.style(15, known ? '#0b171b' : '#8fb0aa', 0)).setOrigin(0.5);
        v.pips.add([c, t]);
        x += 28;
      }
      if (u.broken) v.pips.add(this.add.text(0, -2, 'BREAK', this.style(19, '#ffc76a', 5)).setOrigin(0, 0));
    }
    const st = [
      u.status.burn ? '燃焼' : '', u.status.regen ? '再生' : '', u.status.mist ? '霧' : '',
      u.status.atkUp ? `攻↑${u.status.atkUp}` : '', u.status.coveredBy ? 'かばわれ' : '',
    ].filter(Boolean).join(' ');
    v.status.setText(st);
    // 溜め・ブレイクのオーラ
    v.aura.clear();
    if (!gone && u.charging) {
      v.aura.lineStyle(6, C.danger, 0.8).strokeEllipse(v.x, v.y - v.sprite.displayHeight * 0.45, v.sprite.displayWidth * 0.9, v.sprite.displayHeight * 0.95);
    }
    if (!gone && u.broken) {
      v.aura.lineStyle(4, C.gold, 0.9).strokeEllipse(v.x, v.y - v.sprite.displayHeight * 1.02, 90, 26);
    }
    v.sprite.setAngle(u.broken && !gone ? (v.sprite.flipX ? 8 : -8) : 0);
    if (gone && u.side === 'ally') v.sprite.setAlpha(0.35);
    if (!gone && u.side === 'ally' && v.sprite.alpha < 1) v.sprite.setAlpha(1);
  }

  private refreshIntents(): void {
    this.lines.clear();
    const foes = this.b.units.filter((u) => u.side === 'enemy');
    // 予告の列: すべての敵の右端より右(=戦場の中央寄り)。敵→予告→対象 と左から右へ読める
    const colX = Math.max(462, ...foes.map((e) => {
      const v = this.views.get(e.uid);
      return v ? v.x + v.sprite.displayWidth * 0.45 + 26 : 0;
    }));
    for (const e of foes) {
      const v = this.views.get(e.uid);
      if (!v) continue;
      v.intent?.destroy();
      v.intent = null;
      if (!isActive(e)) continue;
      const midY = v.y - v.sprite.displayHeight * (unitDef(e.defId).guardian ? 0.7 : 0.58);
      const connect = (color: number, alpha: number) => {
        this.lines.lineStyle(3, color, alpha).lineBetween(v.x + v.sprite.displayWidth * 0.36, midY, colX, midY);
      };
      if (e.broken) {
        v.intent = this.bubble(colX, midY, 'BREAK中', '1手休み ・ 被ダメ1.5倍', C.gold, false);
        connect(C.gold, 0.6);
        continue;
      }
      const fc = intentForecast(this.b, e);
      if (!fc) continue;
      const s = fc.skill;
      let l1 = s.name;
      let l2 = '';
      let danger = false;
      if (s.kind === 'charge') { l1 = `溜め: ${s.name}`; l2 = `次は「${skill(s.chargeInto ?? '').name}」`; danger = true; }
      else if (s.target === 'allEnemies') {
        const mx = Math.max(0, ...fc.targets.map((t) => t.dmg));
        l1 = `全体 ${s.name}`; l2 = `各 約${mx}`;
        danger = !!e.charging || fc.targets.some((t) => t.dmg >= unit(this.b, t.uid).hp);
      } else if (s.target === 'enemy' && fc.targets[0]) {
        const t = unit(this.b, fc.targets[0].uid);
        l1 = `→${t.name} ${s.name}`; l2 = `約${fc.targets[0].dmg}`;
        danger = fc.targets[0].dmg >= t.hp;
        if (danger) l2 += ' 倒される危険';
      } else if (s.kind === 'buff') l2 = '仲間を強化';
      else if (s.kind === 'heal') l2 = '回復';
      else if (s.kind === 'field') l2 = '場を変える';
      const elc = col(ELEMENT_COLOR[s.elements[0]] ?? '#c9d2cf');
      const color = danger ? C.danger : elc;
      connect(color, 0.55);
      v.intent = this.bubble(colX, midY, l1, l2, color, danger);
      const bw = (v.intent.getData('w') as number) ?? 200;
      // 予告の対象へ線を引く(予告の右端 → 対象)
      for (const t of fc.targets) {
        const tv = this.views.get(t.uid);
        if (!tv || s.target === 'self') continue;
        const from = new Phaser.Math.Vector2(colX + bw, midY);
        const to = new Phaser.Math.Vector2(tv.x - tv.sprite.displayWidth * 0.3, tv.y - tv.sprite.displayHeight * 0.5);
        const mid = new Phaser.Math.Vector2((from.x + to.x) / 2, Math.min(from.y, to.y) - 60);
        const curve = new Phaser.Curves.QuadraticBezier(from, mid, to);
        this.lines.lineStyle(danger ? 4 : 3, danger ? C.danger : 0xffffff, danger ? 0.8 : 0.3);
        this.lines.strokePoints(curve.getPoints(28));
        this.lines.fillStyle(danger ? C.danger : 0xffffff, danger ? 0.95 : 0.45).fillCircle(to.x, to.y, 6);
      }
    }
  }

  /** 予告の吹き出し。(x, y) は左端・縦中央。幅は getData('w') */
  private bubble(x: number, y: number, l1: string, l2: string, color: number, danger: boolean): Phaser.GameObjects.Container {
    const t1 = this.add.text(14, l2 ? -25 : -12, l1, this.style(21, '#ffffff', 0)).setOrigin(0, 0);
    const t2 = this.add.text(14, 1, l2, this.style(18, danger ? '#ffb3ba' : '#cfe3de', 0)).setOrigin(0, 0);
    const w = Math.max(t1.width, t2.width) + 28;
    const h = l2 ? 56 : 32;
    const g = this.add.graphics();
    g.fillStyle(0x0b171b, 0.9).fillRoundedRect(0, -h / 2, w, h, 10);
    g.lineStyle(3, color, 1).strokeRoundedRect(0, -h / 2, w, h, 10);
    g.fillStyle(color, 1).fillRect(0, -h / 2 + 8, 5, h - 16);
    const c = this.add.container(x, y, [g, t1, t2]).setDepth(45);
    c.setData('w', w);
    if (danger) this.tweens.add({ targets: c, alpha: 0.72, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    return c;
  }

  private refreshTimeline(): void {
    this.tlLayer.removeAll(true);
    const b = this.b;
    const label = this.add.text(28, 12, '行動順', this.style(18, '#8fb0aa', 4));
    this.tlLayer.add(label);
    const now = b.actor ? unit(b, b.actor) : null;
    let x = 64;
    if (now) { this.tlIcon(now, x, 70, 34, true, false); x += 56; }
    const tl = previewTimeline(b, 9, this.previewWeight ?? undefined);
    const projIdx = this.previewWeight !== null && now ? tl.findIndex((e) => e.uid === now.uid) : -1;
    tl.forEach((e, i) => {
      const u = unit(b, e.uid);
      this.tlIcon(u, x + 26, 70, 25, false, i === projIdx, e.recover ? '休' : e.charge ? '溜' : '');
      x += 58;
    });
  }

  private tlIcon(u: Unit, x: number, y: number, r: number, now: boolean, proj: boolean, badge = ''): void {
    const ring = u.side === 'ally' ? C.ally : u.side === 'enemy' ? C.enemy : C.player;
    const g = this.add.graphics();
    if (proj) g.fillStyle(C.hekikan, 0.35).fillCircle(x, y, r + 10);
    g.fillStyle(0x0b171b, 0.92).fillCircle(x, y, r);
    g.lineStyle(now ? 5 : 3, proj ? C.hekikan : ring, 1).strokeCircle(x, y, r);
    const img = this.add.image(x, y + 2, this.artKey(u.defId)).setFlipX(u.side === 'enemy');
    img.setScale((r * 1.7) / Math.max(img.width, img.height));
    this.tlLayer.add([g, img]);
    if (now) this.tlLayer.add(this.add.text(x, y + r + 4, '今', this.style(16, '#e6f2ef', 4)).setOrigin(0.5, 0));
    if (proj) this.tlLayer.add(this.add.text(x, y - r - 6, '次の番', this.style(15, '#3ee0c8', 4)).setOrigin(0.5, 1));
    if (badge) {
      const bg = this.add.graphics().fillStyle(badge === '溜' ? C.danger : C.gold, 1).fillCircle(x + r * 0.75, y + r * 0.7, 11);
      this.tlLayer.add([bg, this.add.text(x + r * 0.75, y + r * 0.7, badge, this.style(13, '#0b171b', 0)).setOrigin(0.5)]);
    }
  }

  private refreshTop(): void {
    this.hudTop.removeAll(true);
    const f = fieldForecast(this.b);
    const x = W - 250;
    const g = this.add.graphics();
    g.fillStyle(0x0b171b, 0.78).fillRoundedRect(x - 16, 14, 250, 118, 14);
    g.fillStyle(col(ELEMENT_COLOR[f.now]), 1).fillCircle(x + 26, 50, 26);
    g.lineStyle(3, 0x08110f, 1).strokeCircle(x + 26, 50, 26);
    this.hudTop.add(g);
    this.hudTop.add(this.add.text(x + 26, 50, ELEMENT_NAME[f.now], this.style(28, '#0b171b', 0)).setOrigin(0.5));
    this.hudTop.add(this.add.text(x + 62, 26, `場: ${ELEMENT_NAME[f.now]}`, this.style(22)));
    this.hudTop.add(this.add.text(x + 62, 54, `あと${f.inTurns}手 → ${ELEMENT_NAME[f.next]}`, this.style(17, '#8fb0aa', 4)));
    // 共鳴ゲージ
    const gg = this.add.graphics();
    for (let i = 0; i < RP_MAX; i++) {
      const on = i < this.b.rp;
      gg.fillStyle(on ? C.hekikan : 0x24343a, 1).fillRoundedRect(x + i * 21, 96, 16, 22, 4);
      if (i === 4) gg.lineStyle(2, 0x8fb0aa, 0.8).lineBetween(x + i * 21 + 18.5, 92, x + i * 21 + 18.5, 122);
    }
    this.hudTop.add(gg);
    this.hudTop.add(this.add.text(x - 4, 94, '', this.style(1)));
    this.hudTop.add(this.add.text(x + 212, 107, `${this.b.rp}`, this.style(18, '#3ee0c8', 4)).setOrigin(0, 0.5));
    this.hudTop.add(this.add.text(x, 76, '共鳴ゲージ', this.style(15, '#8fb0aa', 4)));
  }

  /* ---------------- 戦闘の進行 ---------------- */
  private async run(): Promise<void> {
    const h = this.host;
    const enc = ENCOUNTERS[this.encounterId];
    h.audio.playBgm(enc.bgm);
    h.audio.setIntensity(enc.bgm === 'guardian' ? 1 : 0);
    h.dock.render(this.b, 'wait', null, enc.intro.join(' '));
    this.banner(enc.name, enc.objective);
    await this.wait(1300);
    h.tip('intent', '<b>予告</b>: 敵の頭上に「次の行動・対象・予想ダメージ」が出ます。赤い線は危険な攻撃。');
    while (this.alive && !this.b.outcome) {
      const t = startTurn(this.b);
      await this.play(t.events);
      if (!this.alive) return;
      if (t.skip || this.b.outcome) { this.refreshAll(); continue; }
      this.refreshAll();
      if (t.actor.side === 'enemy') await this.enemyTurn(t.actor);
      else await this.allyTurn(t.actor);
      this.updateIntensity();
    }
    if (this.alive) await this.finish();
  }

  private async enemyTurn(e: Unit): Promise<void> {
    const h = this.host;
    h.dock.render(this.b, 'anim', e.uid);
    const it = this.b.intents[e.uid];
    const s = skill(it.skillId);
    const v = this.views.get(e.uid) as UView;
    this.tweens.add({ targets: v.sprite, scale: v.scale * 1.08, duration: 140 / this.speed, yoyo: true });
    await this.wait(260);
    let guard: Guard = 'none';
    if (s.kind === 'attack') {
      const ids = s.target === 'allEnemies' ? activeAllies(this.b).map((a) => a.uid) : [it.targets[0]].filter((id) => !!id && isActive(unit(this.b, id)));
      const covered = ids.map((id) => unit(this.b, id).status.coveredBy ?? id).filter((id) => isActive(unit(this.b, id)));
      if (covered.length) guard = (await this.timingInput('guard', Array.from(new Set(covered)))) as Guard;
    }
    if (!this.alive) return;
    await this.play(performEnemy(this.b, guard));
  }

  private async allyTurn(a: Unit): Promise<void> {
    const h = this.host;
    let action: Action;
    if (h.dock.auto) {
      h.dock.render(this.b, 'anim', a.uid, 'おまかせ中… (記録帳の「おまかせ」で解除)');
      await this.wait(380);
      action = chooseAllyAction(this.b);
    } else {
      h.dock.render(this.b, 'choose', a.uid);
      if (a.side === 'player') h.tip('player', '<b>巡環士ユウの番</b>: 「記録する」で弱点を明かす・ブレイク中の相手を「鎮める」・「はげます」でゲージ+2。');
      else h.tip('skill', '<b>技を選ぶ</b>: 技にカーソルを合わせると、上の行動順に「次の番」の位置が光ります。重い技ほど遅れます。');
      action = await h.dock.choose(this.b, a, {
        preview: (w) => { this.previewWeight = w; this.refreshTimeline(); },
        highlight: (ids) => { this.highlighted = ids; this.drawHighlights(); },
      });
    }
    if (!this.alive) return;
    this.previewWeight = null;
    this.highlighted = [];
    this.drawHighlights();
    h.dock.render(this.b, 'anim', a.uid);
    const s = skill(action.skillId);
    let timing: Timing = 'good';
    if (isTimedSkill(s)) {
      const ids = s.target === 'allEnemies' ? activeEnemies(this.b).map((u) => u.uid) : [action.target as string];
      timing = (await this.timingInput('attack', ids)) as Timing;
    }
    if (!this.alive) return;
    await this.play(performAction(this.b, action, timing));
  }

  private drawHighlights(): void {
    for (const v of this.views.values()) {
      v.sel.clear();
      if (this.highlighted.includes(v.uid)) {
        v.sel.fillStyle(C.hekikan, 0.25).fillEllipse(v.x, v.y - 4, v.sprite.displayWidth * 0.9, 40);
        v.sel.lineStyle(4, C.hekikan, 1).strokeEllipse(v.x, v.y - 4, v.sprite.displayWidth * 0.9, 40);
      }
    }
  }

  private updateIntensity(): void {
    const enc = ENCOUNTERS[this.encounterId];
    const al = activeAllies(this.b);
    const hurt = al.some((a) => a.hp < a.maxHp * 0.4) || al.length < 3;
    const phase2 = this.b.units.some((u) => u.phase === 2 && isActive(u));
    const lvl: 0 | 1 | 2 = phase2 || (hurt && enc.bgm !== 'wild') ? 2 : hurt || enc.bgm === 'guardian' ? 1 : 0;
    this.host.audio.setIntensity(lvl);
  }

  private async finish(): Promise<void> {
    const h = this.host;
    const win = this.b.outcome === 'win';
    h.dock.render(this.b, 'wait', null, win ? '勝利！' : '全員が倒れた…');
    await this.wait(500);
    h.audio.jingle(win ? 'victory' : 'defeat');
    const guardianWin = win && this.encounterId === 'guardian';
    this.banner(guardianWin ? '試練 達成' : win ? '勝利' : '敗北', guardianWin ? '守護獣が 心を開いた' : win ? '' : 'もう一度 挑もう', win ? C.hekikan : C.danger);
    this.cameras.main.flash(300, 255, 255, 255);
    await this.wait(2200);
    if (this.alive) h.onEnd({ encounterId: this.encounterId, outcome: win ? 'win' : 'lose', stats: { ...this.b.stats } });
  }

  /* ---------------- タイミング入力 ---------------- */
  private timingInput(kind: 'attack' | 'guard', uids: string[]): Promise<Timing | Guard> {
    const h = this.host;
    if (h.settings.timing === 'auto' || h.dock.auto) {
      return Promise.resolve(kind === 'attack' ? 'good' : Math.random() < 0.7 ? 'good' : 'none');
    }
    h.tip(`timing_${kind}`, kind === 'attack'
      ? '<b>攻撃のタイミング</b>: 縮むリングが内側の円に重なる瞬間に Z / Space / タップ。Perfect で威力1.3倍+ゲージ。'
      : '<b>防御のタイミング</b>: 赤いリングが重なる瞬間に Z / Space / タップ。Good で半減、Perfect でパリィ(無効)。');
    return new Promise((resolve) => {
      const dur = 820 / Math.sqrt(this.speed);
      const start = performance.now();
      const hitAt = start + dur;
      const color = kind === 'attack' ? C.hekikan : 0xff8a5c;
      const pts = uids.map((id) => this.views.get(id)).filter((v): v is UView => !!v)
        .map((v) => ({ x: v.x, y: v.y - v.sprite.displayHeight * 0.5 }));
      const g = this.add.graphics().setDepth(60);
      const hint = this.add.text(W / 2, 170, kind === 'attack' ? '合わせて押す! Z / Space / タップ' : '防御! Z / Space / タップ', this.style(26, kind === 'attack' ? '#3ee0c8' : '#ffb08a')).setOrigin(0.5).setDepth(60);
      let done = false;
      const judge = (t: number): Timing => {
        const d = Math.abs(t - hitAt);
        return d <= 75 ? 'perfect' : d <= 165 ? 'good' : 'miss';
      };
      const cleanup = () => {
        unsub();
        this.events.off(Phaser.Scenes.Events.UPDATE, draw);
        document.removeEventListener('pointerdown', onPtr, true);
        g.destroy(); hint.destroy();
      };
      const finish = (r: Timing) => {
        if (done) return;
        done = true;
        BattleScene.timingActive = false;
        cleanup();
        const out: Timing | Guard = kind === 'attack' ? r : r === 'perfect' ? 'perfect' : r === 'good' ? 'good' : 'none';
        this.judgeText(pts[0]?.x ?? W / 2, (pts[0]?.y ?? H / 2) - 90, kind, r);
        resolve(out);
      };
      const onPtr = (ev: PointerEvent) => {
        const el = ev.target as HTMLElement | null;
        if (el && el.closest && el.closest('.iconbtn, .screen')) return;
        finish(judge(performance.now()));
      };
      document.addEventListener('pointerdown', onPtr, true);
      const unsub = h.input.on((cmd) => { if (cmd === 'confirm' || cmd === 'timing') finish(judge(performance.now())); });
      const draw = () => {
        if (!this.alive) { finish('miss'); return; }
        const now = performance.now();
        const p = (now - start) / dur;
        g.clear();
        const rt = 44;
        const r = rt + (150 - rt) * (1 - p);
        for (const pt of pts) {
          g.lineStyle(4, 0xffffff, 0.9).strokeCircle(pt.x, pt.y, rt);
          g.fillStyle(color, 0.12).fillCircle(pt.x, pt.y, rt);
          if (r > 8) g.lineStyle(6, color, Math.min(1, 0.4 + p)).strokeCircle(pt.x, pt.y, r);
        }
        if (now > hitAt + 210) finish('miss');
      };
      this.events.on(Phaser.Scenes.Events.UPDATE, draw);
      BattleScene.timingActive = true;
    });
  }

  private judgeText(x: number, y: number, kind: 'attack' | 'guard', r: Timing): void {
    const map = kind === 'attack'
      ? { perfect: ['PERFECT!', '#3ee0c8', 'perfect'], good: ['GOOD', '#cfe3de', 'good'], miss: ['MISS', '#8fb0aa', 'miss'] }
      : { perfect: ['PARRY!', '#ffc76a', 'parry'], good: ['GUARD', '#7cc4ff', 'guard'], miss: ['', '#fff', 'miss'] };
    const [text, color, sfx] = map[r];
    if (kind === 'attack' || r !== 'miss') this.host.audio.sfx(sfx as SfxId);
    if (!text) return;
    const t = this.add.text(x, y, text, this.style(r === 'perfect' ? 46 : 34, color, 7)).setOrigin(0.5).setDepth(70).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, delay: 520 / this.speed, duration: 380 / this.speed, onComplete: () => t.destroy() });
    if (r === 'perfect') this.cameras.main.flash(90, 180, 255, 240);
  }

  /* ---------------- 演出 ---------------- */
  private async play(evs: BattleEvent[]): Promise<void> {
    for (const e of evs) {
      if (!this.alive) return;
      await this.playOne(e);
    }
    this.refreshAll();
    this.host.dock.render(this.b, 'anim', this.b.actor);
  }

  private async playOne(e: BattleEvent): Promise<void> {
    const h = this.host;
    const b = this.b;
    switch (e.t) {
      case 'turn': {
        const u = unit(b, e.uid);
        const v = this.views.get(e.uid);
        h.audio.sfx('turn');
        this.log(`${u.name}の番`);
        if (v) this.tweens.add({ targets: v.sprite, alpha: { from: 0.6, to: v.sprite.alpha || 1 }, duration: 200 / this.speed });
        this.refreshTimeline();
        return;
      }
      case 'use': {
        const u = unit(b, e.uid);
        const s = skill(e.skillId);
        this.curSkill = s;
        this.log(`${u.name}の ${s.name}！`);
        this.floatText(this.views.get(e.uid), s.name, '#ffffff', 26, -1.05);
        const v = this.views.get(e.uid);
        if (s.kind === 'attack' && v && e.targets[0]) {
          const tv = this.views.get(e.targets[0]);
          if (tv) {
            const dx = (tv.x - v.x) * (s.target === 'allEnemies' ? 0.12 : 0.28);
            this.tweens.add({ targets: v.sprite, x: v.x + dx, duration: 150 / this.speed, yoyo: true, ease: 'Quad.easeOut' });
          }
          await this.wait(150);
        } else {
          if (v) this.sparkAt(v.x, v.y - v.sprite.displayHeight * 0.5, col(ELEMENT_COLOR[s.elements[0]] ?? '#ffffff'), 14);
          if (s.category === 'resonance') { h.audio.sfx('resonance'); this.cameras.main.flash(220, 62, 224, 200); }
          else h.audio.sfx(s.kind === 'heal' ? 'heal' : s.kind === 'buff' ? 'buff' : s.kind === 'observe' ? 'reveal' : 'confirm');
          await this.wait(300);
        }
        if (s.category === 'resonance' && s.kind === 'attack') { h.audio.sfx('resonance'); this.cameras.main.flash(220, 62, 224, 200); }
        return;
      }
      case 'hit': {
        const v = this.views.get(e.dst);
        if (!v) return;
        const cx = v.x;
        const cy = v.y - v.sprite.displayHeight * 0.5;
        const pan = (cx - W / 2) / (W / 2);
        const parry = e.guard === 'perfect';
        if (parry) h.audio.sfx('parry', { pan });
        else if (e.guard === 'good') h.audio.sfx('guard', { pan });
        else h.audio.sfx(e.weak ? 'weak' : e.resist ? 'resist' : 'hit', { pan, pitch: 1 + e.hit * 0.06 });
        if (!parry) {
          const big = e.weak || e.timing === 'perfect';
          await this.hitStop(big ? 95 : 55);
          this.flash(v.sprite);
          this.shake(v.sprite, v.x, big ? 14 : 8);
          if (big) this.cameras.main.shake(130, 0.006);
          const ec = col(ELEMENT_COLOR[this.curSkill?.elements[0] ?? 'none'] ?? '#ffffff');
          this.sparkAt(cx, cy, ec, big ? 26 : 14);
        }
        const dealtByAlly = unit(b, e.src).side !== 'enemy';
        const color = parry ? '#ffc76a' : !dealtByAlly ? '#ff9aa4' : e.weak ? '#ffb35c' : '#ffffff';
        const text = parry ? '0' : String(e.amount);
        this.popNumber(cx + (e.hit - (e.hits - 1) / 2) * 34, cy - 30, text, color, e.weak ? 58 : 46);
        if (e.weak) this.floatText(v, 'WEAK', '#ffb35c', 24, -0.2);
        else if (e.resist) this.floatText(v, '耐性', '#8fb0aa', 20, -0.2);
        if (e.covered) this.floatText(v, 'かばった！', '#7cc4ff', 22, -0.85);
        this.refreshUnit(unit(b, e.dst));
        await this.wait(e.hits > 1 ? 120 : 200);
        return;
      }
      case 'shield': {
        this.refreshUnit(unit(b, e.uid));
        return;
      }
      case 'reveal': {
        const u = unit(b, e.uid);
        h.audio.sfx('reveal');
        this.floatText(this.views.get(e.uid), `弱点 ${e.elements.map((x) => ELEMENT_NAME[x]).join('・')}`, '#3ee0c8', 22, -0.95);
        this.refreshUnit(u);
        await this.wait(220);
        return;
      }
      case 'break': {
        const v = this.views.get(e.uid);
        if (!v) return;
        h.audio.sfx('break', { pan: (v.x - W / 2) / (W / 2) });
        await this.hitStop(140);
        this.cameras.main.shake(300, 0.013);
        this.cameras.main.flash(140, 255, 236, 180);
        this.shards.explode(28, v.x, v.y - v.sprite.displayHeight * 0.55);
        this.tweens.timeScale = 0.35;
        const t = this.add.text(v.x, v.y - v.sprite.displayHeight * 0.6, 'BREAK!!', this.style(76, '#ffc76a', 10)).setOrigin(0.5).setDepth(80).setScale(2.2).setAngle(-6);
        this.tweens.add({ targets: t, scale: 1, duration: 110, ease: 'Back.easeOut' });
        setTimeout(() => { if (this.alive) this.tweens.timeScale = 1; }, 420);
        this.time.delayedCall(1100 / this.speed, () => this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, duration: 300, onComplete: () => t.destroy() }));
        this.refreshUnit(unit(b, e.uid));
        const u = unit(b, e.uid);
        const pac = unitDef(u.defId).pacifiable;
        h.tip('break', `<b>BREAK!</b> 立て直すまで行動不能・被ダメ1.5倍。${pac ? '野生なら次のユウの番で「鎮める」こともできます。' : ''}`);
        await this.wait(700);
        return;
      }
      case 'recover': {
        this.floatText(this.views.get(e.uid), '立て直した', '#cfe3de', 22, -1);
        this.refreshUnit(unit(b, e.uid));
        await this.wait(380);
        return;
      }
      case 'cancel': {
        this.floatText(this.views.get(e.uid), '予告 取り消し', '#ffc76a', 22, -1.25);
        await this.wait(200);
        return;
      }
      case 'ko': {
        const u = unit(b, e.uid);
        const v = this.views.get(e.uid);
        h.audio.sfx('ko');
        this.log(`${u.name}は 倒れた`);
        if (v) {
          v.idle?.stop();
          this.sparkAt(v.x, v.y - v.sprite.displayHeight * 0.4, 0xaaaaaa, 18);
          if (u.side === 'enemy') {
            this.tweens.add({ targets: v.sprite, alpha: 0, y: v.y + 24, duration: 600 / this.speed });
          } else {
            this.tweens.add({ targets: v.sprite, alpha: 0.35, angle: -12, duration: 400 / this.speed });
          }
        }
        this.refreshUnit(u);
        await this.wait(420);
        return;
      }
      case 'heal':
      case 'revive': {
        const v = this.views.get(e.uid);
        h.audio.sfx('heal');
        if (v) {
          if (e.t === 'revive') { v.sprite.setAlpha(1).setAngle(0); v.idle?.restart(); }
          this.sparkAt(v.x, v.y - v.sprite.displayHeight * 0.5, C.ok, 14);
          this.popNumber(v.x, v.y - v.sprite.displayHeight * 0.55, `+${e.amount}`, '#8ff0a0', 40);
        }
        this.refreshUnit(unit(b, e.uid));
        await this.wait(260);
        return;
      }
      case 'tick': {
        const v = this.views.get(e.uid);
        if (v) this.popNumber(v.x, v.y - v.sprite.displayHeight * 0.5, e.kind === 'burn' ? `-${e.amount}` : `+${e.amount}`, e.kind === 'burn' ? '#ffb35c' : '#8ff0a0', 34);
        if (e.kind === 'burn') h.audio.sfx('debuff');
        this.refreshUnit(unit(b, e.uid));
        await this.wait(260);
        return;
      }
      case 'status': {
        this.floatText(this.views.get(e.uid), e.text, '#ffc76a', 21, -1.1);
        this.refreshUnit(unit(b, e.uid));
        await this.wait(120);
        return;
      }
      case 'delay': {
        this.floatText(this.views.get(e.uid), '手番 遅延', '#b98cff', 21, -0.3);
        this.refreshTimeline();
        await this.wait(150);
        return;
      }
      case 'cover': {
        h.audio.sfx('guard');
        this.floatText(this.views.get(e.target), 'かばわれている', '#7cc4ff', 21, -1.05);
        await this.wait(250);
        return;
      }
      case 'field': {
        h.audio.sfx('field');
        const c = col(ELEMENT_COLOR[e.to]);
        this.fieldWash.setFillStyle(c, 0.08);
        const wash = this.add.rectangle(W / 2, H / 2, W, H, c, 0.32).setDepth(35).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: wash, alpha: 0, duration: 700 / this.speed, onComplete: () => wash.destroy() });
        this.setAmbient();
        this.banner(`場: ${ELEMENT_NAME[e.from]} → ${ELEMENT_NAME[e.to]}`, `${ELEMENT_NAME[e.to]}の技が 1.25倍`, c, 900);
        this.refreshTop();
        await this.wait(450);
        return;
      }
      case 'rp': {
        this.refreshTop();
        if (e.delta > 0 && b.rp >= 5) h.tip('resonance', '<b>共鳴ゲージが5</b>: 2体の組み合わせで「共鳴技」が使えます(技メニューの「共鳴技」タブ)。');
        return;
      }
      case 'pacify': {
        const u = unit(b, e.uid);
        const v = this.views.get(e.uid);
        h.audio.sfx('pacify');
        this.log(`${u.name}の 心が 鎮まった`);
        if (v) {
          v.idle?.stop();
          const ring = this.add.graphics().setDepth(38);
          const cy = v.y - v.sprite.displayHeight * 0.5;
          this.tweens.addCounter({
            from: 0, to: 1, duration: 900 / this.speed,
            onUpdate: (tw) => {
              const p = tw.getValue() ?? 0;
              ring.clear().lineStyle(6 * (1 - p) + 1, C.hekikan, 1 - p).strokeCircle(v.x, cy, 40 + p * 160);
            },
            onComplete: () => ring.destroy(),
          });
          this.sparks.explode(30, v.x, cy);
          this.tweens.add({ targets: v.sprite, alpha: 0, y: v.y - 40, duration: 1000 / this.speed, ease: 'Sine.easeIn' });
          this.popNumber(v.x, cy - 60, '鎮めた', '#3ee0c8', 44);
        }
        h.toast(`${u.name}は 落ち着きを取り戻し、森へ帰っていった。`);
        this.refreshUnit(u);
        await this.wait(900);
        return;
      }
      case 'charge': {
        h.audio.sfx('charge');
        const u = unit(b, e.uid);
        this.banner(`${u.name}が 力を溜めている！`, `次の手番で「${skill(e.skillId).name}」 ブレイクで阻止 / 防御で耐える`, C.danger, 1400);
        h.tip('charge', '<b>大技の予告</b>: 溜めている間にブレイクすれば阻止できます。間に合わなければ防御タイミングで耐えましょう。');
        this.refreshUnit(u);
        await this.wait(700);
        return;
      }
      case 'phase': {
        this.cameras.main.shake(500, 0.01);
        this.cameras.main.flash(300, 120, 255, 140);
        this.banner(e.text, '行動パターンが変わった', C.ok, 1500);
        this.host.audio.setIntensity(2);
        await this.wait(900);
        return;
      }
      case 'msg': {
        h.toast(e.text);
        this.log(e.text);
        await this.wait(300);
        return;
      }
      case 'outcome':
        return;
    }
  }

  /* ---------------- 小さな演出部品 ---------------- */
  private wait(ms: number): Promise<void> {
    return new Promise((r) => { this.time.delayedCall(ms / this.speed, () => r()); });
  }

  /** ヒットストップ: 一瞬すべてのトゥイーンを止めて「当たった感」を出す */
  private hitStop(ms: number): Promise<void> {
    this.tweens.pauseAll();
    return new Promise((r) => setTimeout(() => { if (this.alive) this.tweens.resumeAll(); r(); }, ms));
  }

  private flash(s: Phaser.GameObjects.Image): void {
    // Phaser 4: setTintFill は廃止。FILL モードで白く塗る
    s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(80, () => { s.clearTint(); s.setTintMode(Phaser.TintModes.MULTIPLY); });
  }

  private shake(s: Phaser.GameObjects.Image, baseX: number, amp: number): void {
    this.tweens.add({
      targets: s, x: { from: baseX + amp, to: baseX }, duration: 220 / this.speed, ease: 'Elastic.easeOut',
      onComplete: () => { s.x = baseX; },
    });
  }

  private sparkAt(x: number, y: number, color: number, n: number): void {
    this.sparks.setParticleTint(color);
    this.sparks.explode(n, x, y);
  }

  private popNumber(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add.text(x, y, text, this.style(size, color, 8)).setOrigin(0.5).setDepth(75).setScale(1.5);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 56, alpha: 0, delay: 420 / this.speed, duration: 500 / this.speed, onComplete: () => t.destroy() });
  }

  private floatText(v: UView | undefined, text: string, color: string, size: number, rel: number): void {
    if (!v) return;
    const y = v.y + v.sprite.displayHeight * rel;
    const t = this.add.text(v.x, y, text, this.style(size, color, 5)).setOrigin(0.5).setDepth(72);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, delay: 520 / this.speed, duration: 420 / this.speed, onComplete: () => t.destroy() });
  }

  private banner(title: string, sub: string, color = C.hekikan, hold = 1200): void {
    const g = this.add.graphics().setDepth(90);
    g.fillStyle(0x0b171b, 0.82).fillRect(0, H / 2 - 70, W, 140);
    g.fillStyle(color, 1).fillRect(0, H / 2 - 70, W, 4).fillRect(0, H / 2 + 66, W, 4);
    const t1 = this.add.text(W / 2, H / 2 - 20, title, this.style(52, '#ffffff', 8)).setOrigin(0.5).setDepth(91);
    const t2 = this.add.text(W / 2, H / 2 + 34, sub, this.style(24, '#cfe3de', 5)).setOrigin(0.5).setDepth(91);
    const parts = [g, t1, t2];
    for (const p of parts) p.setAlpha(0);
    this.tweens.add({ targets: parts, alpha: 1, duration: 180 });
    this.time.delayedCall(hold / this.speed, () => this.tweens.add({ targets: parts, alpha: 0, duration: 260, onComplete: () => parts.forEach((p) => p.destroy()) }));
  }

  private setAmbient(): void {
    this.ambient?.destroy();
    const c = col(ELEMENT_COLOR[this.b.field]);
    this.ambient = this.add.particles(0, 0, 'dot', {
      x: { min: 0, max: W }, y: { min: 180, max: H }, lifespan: 4200, speedY: { min: -18, max: -46 }, speedX: { min: -8, max: 8 },
      scale: { start: 0.55, end: 0 }, alpha: { start: 0.55, end: 0 }, frequency: 140, tint: c, blendMode: Phaser.BlendModes.ADD,
    }).setDepth(4);
  }

  private log(text: string): void {
    this.logText?.setText(text);
    this.host.dock.setLog(text);
  }
}
