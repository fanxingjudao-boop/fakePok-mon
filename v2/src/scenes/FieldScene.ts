/* ============================================================
 * フィールド画面(Phaser)
 *   自由移動(8方向・アナログ・ダッシュ)/ カメラ追従 / 見えている野生(シンボル遭遇)
 *   調べる・話す / 能力で障害物を開く / 物語(ink)の命令の実行 / マップの移動
 *   ルールは src/world/logic.ts(描画に依存しない)。ここは表示と入力と演出。
 * ============================================================ */
import Phaser from 'phaser';
import type { AudioEngine, BgmId, SfxId } from '../audio/engine.ts';
import type { InputHub } from '../input.ts';
import type { Settings } from '../settings.ts';
import type { Dialogue } from '../ui/dialogue.ts';
import type { StoryRunner } from '../story/runner.ts';
import type { BattleSetup } from '../core/battle.ts';
import type { BattleState } from '../core/types.ts';
import { MAPS } from '../world/maps.ts';
import { TILE, type MapDef, type MapId, type MapObject } from '../world/types.ts';
import {
  ABILITY_OF, ABILITY_VERB, addFlag, buildSolidGrid, checkCond, exitAt, expReward, gateSolvers, gateTiles, hasFlag,
  interactTarget, judgeOpening, levelFromExp, moveCircle, spawnWild, triggersAt,
  type Dir, type GameState, type PartyId, type WildSpawn,
} from '../world/logic.ts';
import { PARTY, unitDef } from '../data/units.ts';
import { ART } from '../data/art.ts';
import { PEOPLE } from '../data/people.ts';
import { SPEAKERS, type Face, type SpeakerId } from '../story/lines.ts';
import {
  drawBush, drawFieldFx, drawGate, drawProp, drawRock, drawTree, drawVillager, drawVineBridge, planTrees, renderGround, themeAmbience,
} from '../art/field.ts';

export interface BattleOutcome { outcome: 'win' | 'lose'; final: BattleState }

export interface FieldHost {
  settings: Settings;
  audio: AudioEngine;
  input: InputHub;
  dialogue: Dialogue;
  state: GameState;
  story: StoryRunner;
  startBattle(encounterId: string, setup: BattleSetup): Promise<BattleOutcome>;
  openMenu(): void;
  toast(text: string, kind?: 'tip' | 'info' | 'warn'): void;
  tip(id: string, html: string): void;
  /** 表示中の目的・地名を更新 */
  hud(mapName: string, objective: string): void;
  save(silent?: boolean): void;
  chapterEnd(): Promise<void>;
  /** 章が終わった後もフィールドを歩き続けられるか */
  paused(): boolean;
}

const W = 1280;
const H = 720;
const WALK = 4.4; // タイル/秒
const DASH = 7.2;
const R = 0.3;

interface Standee {
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  x: number; y: number; // タイル座標(足元)
  h: number;
  bob: number;
}

interface WildView extends Standee {
  spawn: WildSpawn;
  facing: Dir;
  state: 'wander' | 'notice' | 'chase' | 'return' | 'gone';
  timer: number;
  target: { x: number; y: number };
  home: { x: number; y: number };
  mark: Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text;
}

const PARTY_ART: Record<PartyId, string> = { hinoko: 'fox', shizuku: 'otter', konoha: 'owl' };

export class FieldScene extends Phaser.Scene {
  static host: FieldHost;
  private get host(): FieldHost { return FieldScene.host; }

  private map!: MapDef;
  private layer!: Phaser.GameObjects.Container;
  private grid: boolean[][] = [];
  private player!: Standee;
  private followers: Standee[] = [];
  private trail: { x: number; y: number }[] = [];
  private facing: Dir = { x: 0, y: 1 };
  private objects = new Map<string, { o: MapObject; sprite: Phaser.GameObjects.Image | null; shadow: Phaser.GameObjects.Ellipse | null }>();
  private hidden = new Set<string>();
  private shown = new Set<string>();
  private wild: WildView[] = [];
  private busy = false;
  private safeUntil = 0;
  private stepTimer = 0;
  private lastTile = '';
  /** 押しっぱなしのキー(Phaser のキー入力は、他の処理が既定動作を止めたイベントを無視するので自前で持つ) */
  private held = new Set<string>();
  private stick: { id: number; ox: number; oy: number; x: number; y: number; t: number } | null = null;
  private stickGfx!: Phaser.GameObjects.Graphics;
  private prompt!: Phaser.GameObjects.Image;
  private ambient: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private unlisten: (() => void) | null = null;
  private pending: { map: MapId; point: string } | null = null;
  private seed = 1;
  /** 主人公が後ろに回ると透ける木・大きな建物 */
  private fadeables: Phaser.GameObjects.Image[] = [];

  constructor() { super('field'); }

  /* ---------------- 読み込み ---------------- */
  preload(): void {
    for (const [k, url] of Object.entries(PEOPLE)) if (!this.textures.exists(`person_${k}`)) this.load.image(`person_${k}`, url);
    for (const [k, a] of Object.entries(ART)) if (a.img && !this.textures.exists(`user_${k}`)) this.load.image(`user_${k}`, a.img);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0b171b');
    this.makeFx();
    this.stickGfx = this.add.graphics().setScrollFactor(0).setDepth(9000);
    const down = (e: KeyboardEvent) => { this.held.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); };
    const up = (e: KeyboardEvent) => { this.held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); };
    const clear = () => this.held.clear();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', clear);
    });
    this.events.on(Phaser.Scenes.Events.SLEEP, clear);
    this.events.on(Phaser.Scenes.Events.PAUSE, clear);
    this.setupTouch();
    this.unlisten = this.host.input.on((cmd, ev) => {
      if (this.busy || this.host.paused()) return;
      if (cmd === 'confirm') { ev?.preventDefault(); void this.interact(); }
      else if (cmd === 'back') this.host.openMenu();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.unlisten?.(); this.unlisten = null; });
    this.events.on(Phaser.Scenes.Events.WAKE, () => this.onWake());
    this.scale.on('resize', () => this.applyZoom());
    const s = this.host.state;
    this.loadMap(s.map, null, { x: s.x, y: s.y });
    this.applyZoom();
  }

  /** 画面が小さい(スマホ)ときは少し寄って、人物やモンスターを見やすくする */
  private applyZoom(): void {
    const ds = this.scale.displayScale.x; // 論理px / 表示px
    const zoom = Phaser.Math.Clamp(ds * 0.78, 1, 1.45);
    this.cameras.main.setZoom(zoom);
  }

  /* ---------------- テクスチャ ---------------- */
  private tex(key: string, make: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    return key;
  }

  /** 大きな切り抜きを、表示の高さの2倍に縮めておく(縮小時のギザギザ防止) */
  private standeeTex(src: string, height: number): string {
    const key = `st_${src}_${height}`;
    if (this.textures.exists(key)) return key;
    const img = this.textures.get(src).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const h = height * 2;
    const w = Math.max(1, Math.round((img.width / img.height) * h));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    this.textures.addCanvas(key, c);
    return key;
  }

  private makeFx(): void {
    for (const k of ['shadow', 'exclaim', 'sparkle', 'leaf', 'pollen', 'firefly', 'interact', 'ash'] as const) this.tex(`fx_${k}`, () => drawFieldFx(k));
  }

  /* ---------------- マップの構築 ---------------- */
  private get get() { return (name: string) => this.host.story.get(name) ?? (hasFlag(this.host.state, name) ? true : undefined); }

  private loadMap(id: MapId, point: string | null, at?: { x: number; y: number }): void {
    this.layer?.destroy(true);
    this.objects.clear();
    this.wild = [];
    this.hidden.clear();
    this.shown.clear();
    this.followers = [];
    this.ambient?.destroy();
    this.ambient = null;
    const m = MAPS[id];
    this.map = m;
    const s = this.host.state;
    s.map = id;
    const [px, py] = at ? [at.x, at.y] : m.points[point ?? 'start'] ?? Object.values(m.points)[0];
    s.x = px; s.y = py;
    this.layer = this.add.container(0, 0);
    this.seed = (Date.now() & 0xffff) + 1;

    // 地面(一枚絵)
    const ground = this.tex(`ground_${id}`, () => renderGround(m, 7));
    this.layer.add(this.add.image(0, 0, ground).setOrigin(0, 0).setDepth(0));
    const wpx = m.rows[0].length * TILE, hpx = m.rows.length * TILE;
    this.cameras.main.setBounds(0, 0, wpx, hpx);

    // 木(森の奥ほど暗く、少し間引く)・茂み・岩。足元の高さで奥行きを並べる
    this.fadeables = [];
    for (const t of planTrees(m)) {
      const img = this.placeArt(`tree_${m.theme}_${t.variant}`, () => drawTree(m.theme, t.variant), t.x / TILE, t.y / TILE);
      img.setScale(t.scale);
      if (t.shade < 1) { const g = Math.round(255 * t.shade); img.setTint((g << 16) | (g << 8) | g); }
      if (t.shade === 1) this.fadeables.push(img);
    }
    m.rows.forEach((row, ty) => {
      for (let tx = 0; tx < row.length; tx++) {
        const c = row[tx];
        const v = (tx * 7 + ty * 13) % 3;
        if (c === 'b') this.placeArt(`bush_${m.theme}_${v}`, () => drawBush(m.theme, v), tx + 0.5, ty + 0.9);
        else if (c === 'R') this.placeArt(`rock_${m.theme}_${v}`, () => drawRock(m.theme, v), tx + 0.5, ty + 0.9);
      }
    });

    // 物体
    for (const o of m.objects) this.makeObject(o);
    this.rebuildGrid();

    // 主人公と仲間
    this.player = this.makeStandee(this.standeeTex('person_yuu', 92), px, py, 92);
    this.trail = [];
    PARTY.forEach((pid, i) => {
      const art = ART[PARTY_ART[pid]];
      const key = art.img ? this.standeeTex(`user_${PARTY_ART[pid]}`, 50) : this.tex(`art_${pid}`, () => document.createElement('canvas'));
      const f = this.makeStandee(key, px, py + 0.3 * (i + 1), 50);
      this.followers.push(f);
    });
    for (let i = 0; i < 60; i++) this.trail.push({ x: px, y: py });

    // 野生
    for (const sp of spawnWild(m, this.seed, this.get, this.grid)) this.makeWild(sp);

    // 雰囲気(人物・モンスターにも地域の色みを少し乗せる)
    const amb = themeAmbience(m.theme);
    if (amb.particle) {
      this.ambient = this.add.particles(0, 0, `fx_${amb.particle}`, {
        x: { min: 0, max: wpx }, y: { min: 0, max: hpx }, lifespan: 7000, speedX: { min: -12, max: 12 }, speedY: { min: amb.particle === 'leaf' ? 8 : -6, max: amb.particle === 'leaf' ? 22 : 6 },
        alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) }, scale: { min: 0.6, max: 1.1 }, frequency: 180, rotate: { min: 0, max: 360 },
      }).setDepth(8000);
      this.ambient.setAlpha(0.9);
      this.layer.add(this.ambient);
    }
    this.prompt = this.add.image(0, 0, 'fx_interact').setDepth(8500).setVisible(false);
    this.layer.add(this.prompt);

    this.cameras.main.startFollow(this.player.sprite, true, 0.14, 0.14, 0, 20);
    this.cameras.main.centerOn(px * TILE, py * TILE);
    this.host.audio.playBgm(m.bgm as BgmId);
    this.host.audio.setIntensity(1);
    this.refreshHud();
    this.lastTile = `${Math.floor(px)},${Math.floor(py)}`;
    this.safeUntil = this.time.now + 1200;

    // 入ったときの物語
    if (m.enter && checkCond(m.enter.when, this.get) && !hasFlag(s, `enter:${m.enter.knot}`)) {
      const knot = m.enter.knot;
      this.time.delayedCall(350, () => { void this.runKnot(knot, () => addFlag(s, `enter:${knot}`)); });
    }
  }

  private placeArt(key: string, make: () => { canvas: HTMLCanvasElement; footX: number; footY: number }, x: number, y: number): Phaser.GameObjects.Image {
    let foot = this.registry.get(`foot_${key}`) as [number, number] | undefined;
    if (!this.textures.exists(key)) {
      const a = make();
      this.textures.addCanvas(key, a.canvas);
      foot = [a.footX / a.canvas.width, a.footY / a.canvas.height];
      this.registry.set(`foot_${key}`, foot);
    }
    const img = this.add.image(x * TILE, y * TILE, key).setOrigin(foot?.[0] ?? 0.5, foot?.[1] ?? 1).setDepth(y * TILE);
    this.layer.add(img);
    return img;
  }

  private makeStandee(key: string, x: number, y: number, h: number): Standee {
    const shadow = this.add.ellipse(x * TILE, y * TILE, h * 0.62, h * 0.16, 0x000000, 0.3);
    const sprite = this.add.image(x * TILE, y * TILE, key).setOrigin(0.5, 0.97);
    sprite.setScale(h / sprite.height);
    sprite.setTint(themeAmbience(this.map.theme).tint);
    this.layer.add([shadow, sprite]);
    const st: Standee = { sprite, shadow, x, y, h, bob: 0 };
    this.placeStandee(st);
    return st;
  }

  private placeStandee(st: Standee, lift = 0): void {
    const px = st.x * TILE, py = st.y * TILE;
    st.sprite.setPosition(px, py - lift).setDepth(py);
    st.shadow.setPosition(px, py - 2).setDepth(py - 1);
  }

  private makeObject(o: MapObject): void {
    const theme = this.map.theme;
    let sprite: Phaser.GameObjects.Image | null = null;
    let shadow: Phaser.GameObjects.Ellipse | null = null;
    if (o.gate) {
      const g = o.gate;
      if (hasFlag(this.host.state, g.flag)) {
        if (g.kind === 'vine') sprite = this.placeArt(`vinebridge_${g.w}x${g.h}`, () => drawVineBridge(g.w, g.h), o.x, o.y);
      } else sprite = this.placeArt(`gate_${g.kind}_${g.w}x${g.h}_${theme}`, () => drawGate(g.kind, g.w, g.h, theme), o.x, o.y);
      if (sprite && g.kind === 'pollen') sprite.setDepth(o.y * TILE + TILE * 2);
      if (sprite && g.kind === 'vine' && hasFlag(this.host.state, g.flag)) sprite.setDepth(2);
    } else if (o.kind === 'npc' || o.kind === 'guardian') {
      const art = o.art ?? '';
      let key: string;
      let h = 92;
      if (art.startsWith('villager')) {
        const v = drawVillagerCached(this, art);
        key = v;
        h = art === 'villager_c' ? 66 : 84;
      } else if (o.kind === 'guardian') {
        h = 300;
        key = this.textures.exists(`user_${art}`) ? this.standeeTex(`user_${art}`, h) : this.tex('guardian_fallback', () => document.createElement('canvas'));
      } else key = this.standeeTex(`person_${art}`, h);
      const st = this.makeStandee(key, o.x, o.y, h);
      st.sprite.setFlipX(o.face === 'right');
      if (o.kind === 'guardian') {
        st.shadow.setVisible(false);
        st.sprite.setAlpha(0.95);
        this.tweens.add({ targets: st.sprite, scaleY: st.sprite.scaleY * 1.012, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      sprite = st.sprite;
      shadow = st.shadow;
    } else if (o.prop) {
      const opened = o.item ? hasFlag(this.host.state, o.item.flag) : false;
      const prop = o.prop;
      const variant = opened ? 1 : o.variant ?? 0;
      sprite = this.placeArt(`prop_${prop}_${theme}_${variant}`, () => drawProp(prop, theme, variant), o.x, o.y);
      if (prop === 'great_tree' || prop === 'lab' || prop === 'house' || prop === 'tent') { sprite.setDepth(o.y * TILE - 4); this.fadeables.push(sprite); }
      if (prop === 'altar') sprite.setDepth((o.y - 1.5) * TILE);
      if (prop === 'shrine_gate') sprite.setDepth(o.y * TILE + 4);
    }
    this.objects.set(o.id, { o, sprite, shadow });
    this.applyVisibility(o.id);
  }

  private visible(o: MapObject): boolean {
    if (this.hidden.has(o.id)) return false;
    if (this.shown.has(o.id)) return true;
    return checkCond(o.when, this.get);
  }

  private applyVisibility(id: string): void {
    const e = this.objects.get(id);
    if (!e) return;
    const v = this.visible(e.o);
    e.sprite?.setVisible(v);
    e.shadow?.setVisible(v && e.o.kind !== 'guardian');
  }

  private rebuildGrid(): void {
    const hide = new Set<string>();
    for (const { o } of this.objects.values()) if (!this.visible(o)) hide.add(o.id);
    this.grid = buildSolidGrid(this.map, this.get, this.host.state.flags, hide);
  }

  private hiddenSet(): Set<string> {
    const hide = new Set<string>();
    for (const { o } of this.objects.values()) if (!this.visible(o)) hide.add(o.id);
    return hide;
  }

  private refreshHud(): void {
    const obj = String(this.host.story.get('objective') ?? '');
    this.host.hud(this.map.name, obj);
  }

  /* ---------------- 野生 ---------------- */
  private makeWild(sp: WildSpawn): void {
    const def = unitDef(sp.species);
    const art = ART[def.art];
    const h = Math.round(58 * (art.imgScale ?? art.scale));
    const key = art.img ? this.standeeTex(`user_${def.art}`, h) : this.tex(`wild_${def.art}`, () => document.createElement('canvas'));
    const st = this.makeStandee(key, sp.x, sp.y, h);
    const label = this.add.text(sp.x * TILE, sp.y * TILE - h - 6, `Lv${sp.level}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#e6f2ef', stroke: '#08110f', strokeThickness: 4, resolution: 2,
    }).setOrigin(0.5, 1);
    this.layer.add(label);
    const z = this.map.spawns[sp.zone];
    const w: WildView = {
      ...st, spawn: sp, facing: { x: -1, y: 0 }, state: 'wander', timer: 0,
      target: { x: sp.x, y: sp.y }, home: { x: z.x + z.w / 2, y: z.y + z.h / 2 }, mark: null, label,
    };
    this.wild.push(w);
  }

  private updateWild(dt: number): void {
    const p = this.player;
    for (const w of this.wild) {
      if (w.state === 'gone') continue;
      const dx = p.x - w.x, dy = p.y - w.y;
      const dist = Math.hypot(dx, dy);
      const z = this.map.spawns[w.spawn.zone];
      let speed = 0;
      w.timer -= dt;
      if (w.state === 'wander') {
        const looks = dist > 0 ? (w.facing.x * dx + w.facing.y * dy) / dist : 1;
        if (!this.busy && this.time.now > this.safeUntil && (dist < 1.8 || (dist < 4.6 && looks > 0.35))) {
          w.state = 'notice'; w.timer = 0.5;
          w.mark = this.add.image(w.x * TILE, w.y * TILE - w.h - 24, 'fx_exclaim').setDepth(8600);
          this.layer.add(w.mark);
          this.tweens.add({ targets: w.mark, y: w.mark.y - 10, duration: 160, yoyo: true });
          this.sfx('notice');
          if (dx) w.facing = { x: Math.sign(dx), y: 0 };
        } else {
          if (w.timer <= 0 || Math.hypot(w.target.x - w.x, w.target.y - w.y) < 0.2) {
            w.timer = 1.5 + Math.random() * 2.5;
            w.target = Math.random() < 0.35 ? { x: w.x, y: w.y } : { x: z.x + Math.random() * z.w, y: z.y + Math.random() * z.h };
          }
          speed = 1.3;
        }
      } else if (w.state === 'notice') {
        if (w.timer <= 0) { w.state = 'chase'; w.timer = 5; w.mark?.destroy(); w.mark = null; }
      } else if (w.state === 'chase') {
        w.target = { x: p.x, y: p.y };
        speed = 3.6;
        if (w.timer <= 0 || dist > 9) { w.state = 'return'; w.timer = 3; }
      } else if (w.state === 'return') {
        w.target = { x: w.home.x, y: w.home.y };
        speed = 2;
        if (w.timer <= 0 || Math.hypot(w.home.x - w.x, w.home.y - w.y) < 1) { w.state = 'wander'; w.timer = 1; }
      }
      if (speed > 0) {
        const tx = w.target.x - w.x, ty = w.target.y - w.y;
        const tl = Math.hypot(tx, ty);
        if (tl > 0.05) {
          const step = Math.min(tl, speed * dt);
          const r = moveCircle(this.grid, w.x, w.y, (tx / tl) * step, (ty / tl) * step, 0.28);
          w.x = r.x; w.y = r.y;
          w.facing = { x: tx / tl, y: ty / tl };
          w.bob += dt * speed * 3;
          if (r.hit && w.state === 'wander') w.timer = 0;
        }
      }
      this.placeStandee(w, Math.abs(Math.sin(w.bob)) * 4);
      if (Math.abs(w.facing.x) > 0.2) w.sprite.setFlipX(w.facing.x > 0);
      w.label.setPosition(w.x * TILE, w.y * TILE - w.h - 4).setDepth(w.y * TILE + 1);
      w.mark?.setPosition(w.x * TILE, w.y * TILE - w.h - 28);
      // 接触
      if (!this.busy && dist < 0.72 && this.time.now > this.safeUntil) {
        void this.encounter(w);
        return;
      }
    }
  }

  private async encounter(w: WildView): Promise<void> {
    this.busy = true;
    const opening = judgeOpening({ x: this.player.x, y: this.player.y, facing: this.facing }, { x: w.x, y: w.y, facing: w.facing, alerted: w.state === 'chase' || w.state === 'notice' });
    this.sfx('encounter');
    this.cameras.main.shake(180, 0.006);
    await this.wait(260);
    const encId = this.map.theme === 'marsh' ? 'field_marsh' : this.map.theme === 'road' ? 'field_road' : 'field_forest';
    const s = this.host.state;
    if (opening === 'first') this.host.toast('背後を取った! 先手を取れる', 'info');
    else if (opening === 'ambush') this.host.toast('背後を取られた! 敵が先に動く', 'warn');
    for (const sp of w.spawn.group) this.record(sp, 'seen');
    const res = await this.host.startBattle(encId, {
      enemies: w.spawn.group, enemyLevel: w.spawn.level, partyLevel: s.party.level, partyHp: { ...s.party.hp },
      items: { potion: s.items.potion, revive: s.items.revive }, opening,
    });
    w.state = 'gone';
    w.sprite.destroy(); w.shadow.destroy(); w.label.destroy(); w.mark?.destroy();
    await this.afterBattle(res);
  }

  private record(species: string, how: 'seen' | 'pacified' | 'defeated'): void {
    const r = this.host.state.records[species] ?? { seen: 0, pacified: 0, defeated: 0 };
    r[how]++;
    this.host.state.records[species] = r;
  }

  /** 戦闘の結果をフィールドへ持ち帰る(HP・道具・経験値・記録帳) */
  private async afterBattle(res: BattleOutcome, story = false): Promise<void> {
    const s = this.host.state;
    const b = res.final;
    this.safeUntil = this.time.now + 2200;
    s.items.potion = b.items.potion;
    s.items.revive = b.items.revive;
    if (res.outcome === 'lose') {
      for (const id of PARTY) s.party.hp[id] = 1;
      if (story) { this.busy = false; return; }
      // 全員が倒れた: 最後に記録した場所(なければハナゾノの泉)で目を覚ます
      const back = s.flags.find((f) => f.startsWith('respawn:'))?.split(':') ?? ['respawn', 'hanazono', 'spring'];
      this.loadMap(back[1] as MapId, back[2]);
      await this.runKnot('defeat');
      this.busy = false;
      return;
    }
    for (const u of b.units) {
      if (u.side === 'ally') {
        const pid = u.defId as PartyId;
        s.party.hp[pid] = u.gone === 'ko' ? 0.1 : Math.max(0.05, u.hp / u.maxHp);
      }
    }
    const results = b.units.filter((u) => u.side === 'enemy' && u.gone).map((u) => ({
      level: u.level, how: u.gone === 'pacified' ? 'pacified' as const : 'defeated' as const, guardian: !!unitDef(u.defId).guardian,
    }));
    for (const u of b.units) if (u.side === 'enemy' && u.gone && !unitDef(u.defId).controller) this.record(u.defId, u.gone === 'pacified' ? 'pacified' : 'defeated');
    const gain = expReward(results);
    const before = s.party.level;
    s.party.exp += gain;
    s.party.level = levelFromExp(s.party.exp);
    const pac = results.filter((r) => r.how === 'pacified').length;
    this.host.toast(`経験値 +${gain}${pac ? `(鎮めた ${pac}体)` : ''}`, 'info');
    if (s.party.level > before) {
      this.sfx('heal');
      this.host.toast(`仲間のレベルが ${s.party.level} に上がった! 体力も少し戻った`, 'tip');
      for (const id of PARTY) s.party.hp[id] = Math.min(1, s.party.hp[id] + 0.25);
    }
    this.busy = story;
  }

  private onWake(): void {
    this.held.clear();
    this.host.audio.playBgm(this.map.bgm as BgmId);
    this.host.audio.setIntensity(1);
    this.cameras.main.fadeIn(260);
    this.refreshHud();
  }

  /* ---------------- 入力と移動 ---------------- */
  private setupTouch(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.busy || this.host.paused() || p.button !== 0) return;
      this.stick = { id: p.id, ox: p.x, oy: p.y, x: p.x, y: p.y, t: this.time.now };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.stick && p.id === this.stick.id) { this.stick.x = p.x; this.stick.y = p.y; }
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (!this.stick || p.id !== this.stick.id) return;
      const moved = Math.hypot(this.stick.x - this.stick.ox, this.stick.y - this.stick.oy);
      const quick = this.time.now - this.stick.t < 260;
      this.stick = null;
      this.stickGfx.clear();
      // 軽くタップしたら「調べる」
      if (moved < 14 && quick && !this.busy) void this.interact();
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
  }

  private readMove(): { x: number; y: number; dash: boolean } {
    let x = 0, y = 0, dash = false;
    const k = this.held;
    if (k.has('ArrowLeft') || k.has('a')) x -= 1;
    if (k.has('ArrowRight') || k.has('d')) x += 1;
    if (k.has('ArrowUp') || k.has('w')) y -= 1;
    if (k.has('ArrowDown') || k.has('s')) y += 1;
    dash = k.has('Shift');
    // ゲームパッド(左スティック・十字キー、B でダッシュ)
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    const gp = pads.find((p) => p && p.connected);
    if (gp) {
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.25) { x += ax; y += ay; }
      if (gp.buttons[14]?.pressed) x -= 1;
      if (gp.buttons[15]?.pressed) x += 1;
      if (gp.buttons[12]?.pressed) y -= 1;
      if (gp.buttons[13]?.pressed) y += 1;
      if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) dash = true;
    }
    // 画面のスティック(大きく倒すとダッシュ)
    if (this.stick) {
      const cam = this.cameras.main;
      const dx = (this.stick.x - this.stick.ox) / cam.zoom, dy = (this.stick.y - this.stick.oy) / cam.zoom;
      const d = Math.hypot(dx, dy);
      this.stickGfx.clear();
      const ox = this.stick.ox, oy = this.stick.oy;
      this.stickGfx.fillStyle(0x0b171b, 0.35).fillCircle(ox, oy, 70).lineStyle(3, 0x3ee0c8, 0.6).strokeCircle(ox, oy, 70);
      const kx = ox + (d > 70 ? (this.stick.x - ox) * (70 / Math.max(1, Math.hypot(this.stick.x - ox, this.stick.y - oy))) : this.stick.x - ox);
      const ky = oy + (d > 70 ? (this.stick.y - oy) * (70 / Math.max(1, Math.hypot(this.stick.x - ox, this.stick.y - oy))) : this.stick.y - oy);
      this.stickGfx.fillStyle(0x3ee0c8, 0.55).fillCircle(kx, ky, 28);
      if (d > 12) { x += dx / Math.max(d, 50); y += dy / Math.max(d, 50); if (d > 90) dash = true; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y, dash };
  }

  update(time: number, deltaMs: number): void {
    if (!this.map || !this.player) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    if (!this.busy && !this.host.paused()) this.host.state.playtime += dt;
    const mv = this.busy || this.host.paused() ? { x: 0, y: 0, dash: false } : this.readMove();
    const moving = Math.hypot(mv.x, mv.y) > 0.1;
    const p = this.player;
    if (moving) {
      const sp = (mv.dash ? DASH : WALK) * dt;
      const r = moveCircle(this.grid, p.x, p.y, mv.x * sp, mv.y * sp, R);
      p.x = r.x; p.y = r.y;
      const l = Math.hypot(mv.x, mv.y);
      this.facing = { x: mv.x / l, y: mv.y / l };
      p.bob += dt * (mv.dash ? 16 : 11);
      if (Math.abs(this.facing.x) > 0.2) p.sprite.setFlipX(this.facing.x > 0);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = mv.dash ? 0.22 : 0.32;
        const c = this.map.rows[Math.floor(p.y)]?.[Math.floor(p.x)];
        this.sfx(c === '=' ? 'step_wood' : 'step');
      }
      this.trail.unshift({ x: p.x, y: p.y });
      if (this.trail.length > 90) this.trail.pop();
    } else {
      p.bob = 0;
    }
    this.placeStandee(p, moving ? Math.abs(Math.sin(p.bob)) * 5 : 0);
    p.sprite.setScale(p.h / p.sprite.height * (moving ? 1 : 1 + Math.sin(time / 500) * 0.006), p.h / p.sprite.height * (moving ? 1 - Math.abs(Math.sin(p.bob)) * 0.025 : 1));
    // 仲間は少し遅れてついてくる
    this.followers.forEach((f, i) => {
      const t = this.trail[Math.min(this.trail.length - 1, (i + 1) * 14)];
      const dx = t.x - f.x, dy = t.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.02) {
        f.x += dx * Math.min(1, dt * 10); f.y += dy * Math.min(1, dt * 10);
        f.bob += dt * 12 * Math.min(1, d * 4);
        if (Math.abs(dx) > 0.01) f.sprite.setFlipX(dx > 0);
      }
      const hp = this.host.state.party.hp[PARTY[i]];
      f.sprite.setAlpha(hp <= 0 ? 0.45 : 1);
      this.placeStandee(f, d > 0.05 ? Math.abs(Math.sin(f.bob)) * 4 : 0);
    });

    this.updateFade();
    if (!this.busy && !this.host.paused()) {
      this.checkTile();
      this.updatePrompt();
    }
    this.updateWild(dt);
  }

  /** 主人公に重なって手前にある木・建物を半透明にする(後ろを歩いても見失わない) */
  private updateFade(): void {
    const px = this.player.sprite.x, py = this.player.sprite.y;
    const top = py - this.player.h;
    for (const img of this.fadeables) {
      const b = img.getBounds();
      const over = img.depth > py && px > b.left + 8 && px < b.right - 8 && top < b.bottom - 10 && py > b.top + 10;
      const a = over ? 0.45 : 1;
      if (Math.abs(img.alpha - a) > 0.01) img.setAlpha(img.alpha + (a - img.alpha) * 0.2);
    }
  }

  private checkTile(): void {
    const s = this.host.state;
    const p = this.player;
    s.x = p.x; s.y = p.y; s.facing = this.facing;
    const key = `${Math.floor(p.x)},${Math.floor(p.y)}`;
    const ex = exitAt(this.map, p.x, p.y);
    if (ex) {
      if (!checkCond(ex.when, this.get)) {
        if (key !== this.lastTile && ex.blocked) this.host.toast(ex.blocked, 'warn');
      } else { void this.changeMap(ex.to, ex.point); return; }
    }
    if (key === this.lastTile) return;
    this.lastTile = key;
    const trg = triggersAt(this.map, p.x, p.y, this.get, s.flags)[0];
    if (trg) void this.runKnot(trg.knot, trg.once ? () => addFlag(s, trg.id) : undefined);
  }

  private updatePrompt(): void {
    const t = interactTarget(this.map, this.player.x, this.player.y, this.facing, this.get, this.hiddenSet());
    if (!t) { this.prompt.setVisible(false); return; }
    const e = this.objects.get(t.id);
    const top = e?.sprite ? e.sprite.y - e.sprite.displayHeight * e.sprite.originY : t.y * TILE - TILE;
    const x = t.gate ? t.x * TILE : t.x * TILE;
    this.prompt.setVisible(true).setPosition(x, Math.max(top - 14, 20) + Math.sin(this.time.now / 180) * 3);
  }

  private async changeMap(to: MapId, point: string): Promise<void> {
    this.busy = true;
    this.sfx('door');
    this.cameras.main.fadeOut(220, 11, 23, 27);
    await this.wait(240);
    this.loadMap(to, point);
    this.host.save(true);
    this.cameras.main.fadeIn(260, 11, 23, 27);
    await this.wait(120);
    this.busy = false;
  }

  /* ---------------- 調べる ---------------- */
  /** 画面の「調べる」ボタン */
  pressAction(): void {
    if (!this.busy && !this.host.paused()) void this.interact();
  }

  private async interact(): Promise<void> {
    if (this.busy) return;
    const t = interactTarget(this.map, this.player.x, this.player.y, this.facing, this.get, this.hiddenSet());
    if (!t) return;
    const s = this.host.state;
    this.sfx('confirm');
    // 人は振り向く
    const e = this.objects.get(t.id);
    if (e?.sprite && t.kind === 'npc') e.sprite.setFlipX(this.player.x > t.x);
    if (t.gate) { await this.solveGate(t); return; }
    if (t.item) {
      if (hasFlag(s, t.item.flag)) { await this.narrate('空っぽだ。'); return; }
      addFlag(s, t.item.flag);
      s.items[t.item.id as keyof typeof s.items] += t.item.n;
      e?.sprite?.setTexture(this.placeArtKey(`prop_chest_${this.map.theme}_1`, () => drawProp('chest', this.map.theme, 1)));
      this.sfx('item_get');
      await this.narrate(`${ITEM_NAME[t.item.id] ?? t.item.id} を ${t.item.n}つ 手に入れた。`);
      return;
    }
    if (t.kind === 'record') {
      for (const id of PARTY) s.party.hp[id] = 1;
      s.flags = s.flags.filter((f) => !f.startsWith('respawn:'));
      addFlag(s, `respawn:${this.map.id}:${this.nearestPoint()}`);
      this.host.save(true);
      this.sfx('save');
      this.sparkle(t.x, t.y - 1);
      await this.narrate('記録石に手をかざすと、環測器が碧く光った。旅を記録した。仲間の傷も癒えた。');
      return;
    }
    if (t.kind === 'spring') {
      for (const id of PARTY) s.party.hp[id] = 1;
      this.sfx('heal');
      this.sparkle(t.x, t.y - 0.5);
      await this.narrate('澄んだ泉の水を分け合った。仲間の傷がすっかり癒えた。');
      return;
    }
    if (t.talk) await this.runKnot(t.talk);
  }

  private placeArtKey(key: string, make: () => { canvas: HTMLCanvasElement; footX: number; footY: number }): string {
    if (!this.textures.exists(key)) {
      const a = make();
      this.textures.addCanvas(key, a.canvas);
      this.registry.set(`foot_${key}`, [a.footX / a.canvas.width, a.footY / a.canvas.height]);
    }
    return key;
  }

  private nearestPoint(): string {
    let best = Object.keys(this.map.points)[0];
    let bd = Infinity;
    for (const [k, [x, y]] of Object.entries(this.map.points)) {
      const d = Math.hypot(x - this.player.x, y - this.player.y);
      if (d < bd && !exitAt(this.map, x, y)) { bd = d; best = k; }
    }
    return best;
  }

  private async solveGate(o: MapObject): Promise<void> {
    const g = o.gate;
    if (!g) return;
    const s = this.host.state;
    if (hasFlag(s, g.flag)) return;
    const what = GATE_NAME[g.kind];
    if (!checkCond(g.when, this.get)) { await this.narrate(g.locked ?? `${what}は、今はどうにもできない。`); return; }
    const solvers = gateSolvers(o, s);
    if (!solvers.length) {
      await this.narrate(`${what}がある。${g.need.map((a) => ABILITY_NAME[a]).join('か')}の力があれば、なんとかできそうだ。`);
      return;
    }
    this.busy = true;
    const d = this.host.dialogue;
    await d.say('', '', 'normal', `${what}が道をふさいでいる。`);
    const opts = [...solvers.map((id) => `${unitDef(id).name}に${ABILITY_VERB[ABILITY_OF[id]]}てもらう`), 'やめておく'];
    const i = await d.choose(opts);
    if (i >= solvers.length) { d.close(); this.busy = false; return; }
    const who = solvers[i];
    d.close();
    await this.gateFx(o, ABILITY_OF[who]);
    addFlag(s, g.flag);
    const e = this.objects.get(o.id);
    e?.sprite?.destroy();
    if (e) e.sprite = null;
    if (g.kind === 'vine') {
      const br = this.placeArt(`vinebridge_${g.w}x${g.h}`, () => drawVineBridge(g.w, g.h), o.x, o.y).setDepth(2);
      if (e) e.sprite = br;
      br.setAlpha(0);
      this.tweens.add({ targets: br, alpha: 1, duration: 500 });
    }
    this.rebuildGrid();
    this.host.save(true);
    await this.narrate(`${unitDef(who).name}のおかげで、道が開けた。`);
    this.busy = false;
  }

  private async gateFx(o: MapObject, a: 'fire' | 'water' | 'wood'): Promise<void> {
    const color = a === 'fire' ? 0xff7a3d : a === 'water' ? 0x35c3dc : 0x6cc24a;
    this.sfx(a === 'fire' ? 'burn' : a === 'water' ? 'water' : 'grow');
    const tiles = gateTiles(o);
    const cx = (tiles.reduce((s, [x]) => s + x, 0) / tiles.length + 0.5) * TILE;
    const cy = (tiles.reduce((s, [, y]) => s + y, 0) / tiles.length + 0.5) * TILE;
    const em = this.add.particles(cx, cy, 'fx_sparkle', {
      speed: { min: 60, max: 220 }, lifespan: 700, scale: { start: 1.4, end: 0 }, tint: color, quantity: 3, frequency: 30,
      blendMode: Phaser.BlendModes.ADD, emitZone: { type: 'random', source: new Phaser.Geom.Rectangle(-TILE, -TILE, TILE * 2, TILE * 2), quantity: 1 } as never,
    }).setDepth(9000);
    this.layer.add(em);
    const e = this.objects.get(o.id);
    if (e?.sprite) this.tweens.add({ targets: e.sprite, alpha: 0, duration: 900 });
    this.cameras.main.shake(260, 0.004);
    await this.wait(950);
    em.stop();
    this.time.delayedCall(800, () => em.destroy());
  }

  private sparkle(x: number, y: number): void {
    const em = this.add.particles(x * TILE, y * TILE, 'fx_sparkle', {
      speed: { min: 20, max: 90 }, lifespan: 900, scale: { start: 1, end: 0 }, tint: 0x3ee0c8, quantity: 14, emitting: false, blendMode: Phaser.BlendModes.ADD,
    }).setDepth(9000);
    this.layer.add(em);
    em.explode(18);
    this.time.delayedCall(1200, () => em.destroy());
  }

  /* ---------------- 物語 ---------------- */
  private async narrate(text: string): Promise<void> {
    const was = this.busy;
    this.busy = true;
    await this.host.dialogue.say('', '', 'normal', text);
    this.host.dialogue.close();
    this.busy = was;
  }

  /** knot を最後まで流す。命令はここで実行する */
  async runKnot(knot: string, onStart?: () => void): Promise<void> {
    const h = this.host;
    if (!h.story.has(knot)) { console.warn('[story] knot がない:', knot); return; }
    if (this.busy && !onStart && knot !== 'defeat') return;
    this.busy = true;
    onStart?.();
    const s = h.state;
    const rec = Object.values(s.records);
    h.story.set('pacified_count', rec.reduce((n, r) => n + r.pacified, 0));
    h.story.set('defeated_count', rec.reduce((n, r) => n + r.defeated, 0));
    h.story.set('burned_log', hasFlag(s, 'log_road'));
    h.story.set('marsh_cleared', hasFlag(s, 'pollen_marsh'));
    h.story.set('took_journal', hasFlag(s, 'read_journal'));
    if (knot === 'grove_journal') addFlag(s, 'read_journal');
    h.story.start(knot);
    const d = h.dialogue;
    for (;;) {
      const step = h.story.next();
      if (step.kind === 'end') break;
      if (step.kind === 'choices') { h.story.choose(await d.choose(step.options)); continue; }
      const ln = step.line;
      if (ln.kind === 'say') await d.say(ln.speaker, SPEAKERS[ln.speaker], ln.face, ln.text);
      else if (ln.kind === 'narration') await d.say('', '', 'normal', ln.text);
      else await this.command(ln.name, ln.args);
    }
    d.close();
    // 物語の結果を反映(表示の条件・目的・通行)
    for (const id of this.objects.keys()) this.applyVisibility(id);
    this.rebuildGrid();
    this.refreshHud();
    s.story = h.story.save();
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.loadMap(p.map, p.point);
    }
    this.safeUntil = this.time.now + 1200;
    this.busy = false;
    h.save(true);
  }

  private async command(name: string, args: string[]): Promise<void> {
    const h = this.host;
    const s = h.state;
    const d = h.dialogue;
    switch (name) {
      case 'battle': {
        d.close();
        const res = await h.startBattle(args[0], {
          partyLevel: s.party.level, partyHp: { ...s.party.hp }, items: { potion: s.items.potion, revive: s.items.revive },
          enemyLevel: args[0] === 'guardian' ? 6 : 4,
        });
        const pacified = res.final.units.some((u) => u.side === 'enemy' && u.gone === 'pacified' && unitDef(u.defId).guardian);
        h.story.set('battle_result', res.outcome === 'lose' ? 'lose' : pacified ? 'pacified' : 'win');
        await this.afterBattle(res, true);
        this.busy = true;
        break;
      }
      case 'give': {
        const id = args[0] as keyof typeof s.items;
        if (id in s.items) s.items[id] += Number(args[1]);
        this.sfx('item_get');
        h.toast(`${ITEM_NAME[args[0]] ?? args[0]} を ${args[1]}つ 手に入れた`, 'info');
        break;
      }
      case 'heal': for (const id of PARTY) s.party.hp[id] = 1; this.sfx('heal'); break;
      case 'fade':
        d.close();
        this.cameras.main.fadeOut(300, 11, 23, 27);
        await this.wait(420);
        this.cameras.main.fadeIn(360, 11, 23, 27);
        await this.wait(200);
        break;
      case 'wait': await this.wait(Number(args[0])); break;
      case 'shake': this.cameras.main.shake(320, 0.008); break;
      case 'sfx': this.sfx(args[0] as SfxId); break;
      case 'bgm':
        // none(無音)は次の bgm 命令までの短い間なので、今の曲のまま静かにする
        if (args[0] === 'none') h.audio.setIntensity(0);
        else h.audio.playBgm(args[0] as BgmId);
        break;
      case 'hide': this.hidden.add(args[0]); this.shown.delete(args[0]); this.applyVisibility(args[0]); this.rebuildGrid(); break;
      case 'show': this.shown.add(args[0]); this.hidden.delete(args[0]); this.applyVisibility(args[0]); this.rebuildGrid(); break;
      case 'walk': await this.walkObject(args[0], args[1]); break;
      case 'camera': await this.panCamera(args[0]); break;
      case 'warp': this.pending = { map: args[0] as MapId, point: args[1] }; break;
      case 'note': {
        const text = args.join(' ').replace(/_/g, ' ');
        if (!s.notes.includes(text)) s.notes.push(text);
        break;
      }
      case 'chapter_end': d.close(); await h.chapterEnd(); break;
      default: break;
    }
  }

  private async walkObject(id: string, point: string): Promise<void> {
    const e = this.objects.get(id);
    const to = this.map.points[point];
    if (!e?.sprite || !to) return;
    const sx = e.sprite.x, sy = e.sprite.y;
    const tx = to[0] * TILE, ty = to[1] * TILE;
    const dist = Math.hypot(tx - sx, ty - sy) / TILE;
    e.sprite.setFlipX(tx > sx);
    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: [e.sprite, e.shadow].filter(Boolean), x: tx, duration: (dist / 3.2) * 1000, ease: 'Linear',
      });
      this.tweens.add({
        targets: e.sprite, y: ty, duration: (dist / 3.2) * 1000, ease: 'Linear',
        onUpdate: () => { e.sprite?.setDepth(e.sprite.y); e.shadow?.setPosition(e.sprite?.x ?? 0, (e.sprite?.y ?? 0) - 2); },
        onComplete: () => resolve(),
      });
    });
  }

  private async panCamera(id: string): Promise<void> {
    const cam = this.cameras.main;
    if (id === 'player') {
      cam.pan(this.player.sprite.x, this.player.sprite.y - 20, 500, 'Sine.easeInOut');
      await this.wait(520);
      cam.startFollow(this.player.sprite, true, 0.14, 0.14, 0, 20);
      return;
    }
    const e = this.objects.get(id);
    if (!e?.sprite) return;
    cam.stopFollow();
    cam.pan(e.sprite.x, e.sprite.y - e.sprite.displayHeight * 0.4, 600, 'Sine.easeInOut');
    await this.wait(640);
  }

  /* ---------------- 小物 ---------------- */
  private sfx(id: SfxId): void { this.host.audio.sfx(id); }
  private wait(ms: number): Promise<void> { return new Promise((r) => this.time.delayedCall(ms, () => r())); }

  /** 自動テスト用: 指定地点へ移る */
  debugWarp(map: MapId, point: string): void { this.loadMap(map, point); }
  debugState(): { map: string; x: number; y: number; busy: boolean; wild: number } {
    return { map: this.map.id, x: this.player.x, y: this.player.y, busy: this.busy, wild: this.wild.filter((w) => w.state !== 'gone').length };
  }
  /** 自動テスト用: いちばん近い野生と戦う */
  debugEncounter(): void {
    const w = this.wild.find((x) => x.state !== 'gone');
    if (w) void this.encounter(w);
  }
}

const ITEM_NAME: Record<string, string> = { potion: '薬草膏', revive: '目覚めの実', herb: '森の香草' };
const GATE_NAME: Record<string, string> = { log: '大きな倒木', thorns: 'いばらの茂み', pollen: '濃い花粉の壁', vine: '水の切れ目' };
const ABILITY_NAME: Record<string, string> = { fire: '火', water: '潮', wood: '森' };

function drawVillagerCached(scene: Phaser.Scene, id: string): string {
  const key = `villager_${id}`;
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawVillager(id as 'villager_a').canvas);
  return key;
}

export type { Face, SpeakerId };
void W; void H;
