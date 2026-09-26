// ============================================================
// ポケットレジェンド 碧環の旅 — 第1章「碧樹圏」
//
// 行の書式は src/story/lines.ts を参照。
//   @話者:表情 本文 / 地の文 / >> 命令
// ゲームは各入口の knot を ChoosePathString で呼ぶ。
// 物語の進み具合は VAR で持つ(再訪・再挑戦・台詞の変化もすべて VAR で判定)。
// ============================================================

// ---- ゲームが書きこむ(既定値) ----
VAR battle_result = ""
VAR pacified_count = 0
VAR defeated_count = 0
VAR burned_log = false
VAR marsh_cleared = false
VAR took_journal = false

// ---- ゲームが読む(物語が書く) ----
VAR objective = ""
VAR met_ren = false
VAR device_stopped = false
VAR ashstar_choice = ""
VAR ren_stance = ""
VAR shrine_done = false
VAR chapter_done = false

// ---- 物語の内部で使う ----
VAR ashstar_tries = 0
VAR guardian_tries = 0
VAR journal_read = false
VAR kaede_heard_ren = false
VAR kaede_heard_camp = false
VAR kaede_heard_journal = false
VAR aoi_asked = false
VAR suzu_gift = false
VAR hachi_gift = false
VAR worker_gift = false

-> END


// ============================================================
// 序章 — 研究庵の朝
// ============================================================
=== prologue ===
>> bgm none
>> fade
朝の光が、研究庵の床に細長い帯を落としている。
>> bgm village
@hinoko:smile コン！
毛布の上に、小さな火狐の子が飛び乗ってきた。ヒノコだ。
足もとではシズクが跳ねまわり、窓辺のコノハはまだ片目しか開いていない。
@kaede:smile 起きたかい、ユウ。寝ぼすけの巡環士候補さん。
@kaede:normal 朝ごはんの前に、ひとつ見てほしいものがある。
カエデ博士が、机の上の小枝を指さした。
碧樹の枝だ。葉の縁が、灰をかぶったように白く乾いている。
@kaede:think 今朝、見張り台の下で拾った。……夏の盛りに、だよ。
@kaede:normal 環測器を当ててごらん。
ユウが手首の環測器をかざすと、碧い針がゆっくりと沈んでいった。
>> sfx notice
@kaede:think ……やっぱりね。森を巡る力が、細くなってる。
@kaede:normal 碧環の流れが弱ると、まず木が黙る。次に、獣が荒れる。
@kaede:sad 最後に、人が困る。順番は、いつも同じさ。
@kaede:normal 東の獣道を抜けて、湿地の向こう。そこに森殿がある。
@kaede:normal 眠っている守護獣モリドラードが、この森の環核を抱いてるんだ。
@kaede:think あの子の様子を見てきておくれ。見て、記録する。それだけでいい。
* [任せてください]
    @kaede:smile いい返事だ。返事だけは、昔から満点だね。
* [務まるかな……]
    @kaede:smile 務まるかどうかは、森が決めるさ。
    @kaede:normal 巡環士ってのは、答えを持ってる人じゃない。
    @kaede:normal 問いを持ち帰ってくる人のことだよ。
-
@kaede:normal それと、南の旧街道には灰星局が野営を張ってる。
@kaede:think 下流の水害を止めるために、無理に装置を動かしてるそうだ。
@kaede:normal 悪い人たちじゃない。ただ、急いでる。
@kaede:think 急ぐ人は、足もとを見ないもんさ。
@kaede:normal 道中の野生の子らも気が立ってる。頭上の予告をよく見ること。
@kaede:smile 守りが崩れたら、とどめじゃなく、鎮める。……いいね？
@kaede:normal ほら、薬草膏を持っておいき。倒れた子を起こす目覚めの実もね。
>> sfx item_get
>> give potion 3
>> give revive 1
シズクが、博士の袖をくいくいと引いた。
@shizuku:smile キュイ？
@kaede:smile ああ、お前たちも一緒だよ。三匹そろって、ユウのお守りだ。
@kaede:think ……三年前、森殿の祭壇で、輪の形をした種を三つ拾ってね。
@kaede:normal それが割れて、この子たちが生まれた。ちょっとした里帰りさね。
コノハがゆっくり首をかしげた。後ろ頭の碧い結晶が、一瞬だけ瞬く。
カエデ博士は、その光を、少しのあいだ黙って見ていた。
@kaede:smile ……気をつけてお行き。記録帳は、書く人が帰ってきてこそだよ。
~ objective = "東の門から、苔むす獣道へ"
>> note 森殿の守護獣の様子を見にいく
-> END


// ============================================================
// カエデ博士(何度でも話せる)
// ============================================================
=== kaede ===
{ (took_journal or journal_read) and not kaede_heard_journal and not shrine_done:
    -> kaede_journal ->
}
{
- chapter_done:
    -> done
- shrine_done:
    // ふつうはハナゾノに入った時点で epilogue が走る。取りこぼした時の保険。
    -> epilogue
- device_stopped:
    -> camp
- met_ren:
    -> ren
- else:
    -> start
}

= start
@kaede:normal 森殿は東だよ。獣道の分かれ道を、湿地のほうへ。
-> tip

= ren
{ not kaede_heard_ren:
    ~ kaede_heard_ren = true
    ユウは、分かれ道で出会った少年のことを話した。
    @kaede:think ドローンを連れた、レンという子？ ……ああ、噂は聞いてる。
    @kaede:normal 十六で、灰星局の技術者が頭を下げに来る天才だとか。
    @kaede:think 賢い子ほど、世界をねじ伏せたくなる。……怖いからさ。
}
@kaede:normal 旧街道の中継器を見ておいで。森の力がどこへ吸われてるのか。
-> tip

= camp
{ not kaede_heard_camp:
    ~ kaede_heard_camp = true
    {
    - ashstar_choice == "listen":
        @kaede:think 灰星局の男の話を、最後まで聞いたのかい。
        @kaede:smile 敵の顔をした人の話を聞くのは、骨が折れる。いい骨の折り方だ。
    - ashstar_choice == "report":
        @kaede:think 森の記録を、本部へ託した……か。
        @kaede:normal 記録は、届くべき場所に届いてこそだ。よく考えたね。
    - ashstar_choice == "leave":
        @kaede:normal 黙って背を向けた、か。……言葉が出ない日もあるさ。
    - else:
        @kaede:normal 中継器が止まったそうだね。今朝から、大樹の葉ずれが違う。
    }
}
{ marsh_cleared:
    @kaede:normal 湿地を越えたなら、森殿はもうすぐだ。
- else:
    @kaede:normal 湿地の花粉は、シズクの水で流せる。コノハの蔓で回りこむ手もある。
}
-> tip

= tip
{cycle:
- @kaede:think 野生の子には、背中からそっと近づくといい。先に動けるからね。
- @kaede:normal 頭上の予告を見てごらん。次に何をする気か、ちゃんと教えてくれる。
- @kaede:normal 守りをブレイクしたら、鎮める好機だ。倒すより、森が喜ぶ。
- @kaede:smile 三匹の息が合えば、共鳴技が撃てる。技を出す瞬間の呼吸が大事さ。
}
-> END

= done
{cycle:
- @kaede:smile 碧樹の環核はつながった。残りは三つ。……急がなくていい。
- @kaede:think あの子たちの結晶のこと、記録帳に書いたかい？ 見たことだけを、ね。
- @kaede:normal 灰星局の本部長も、昔は森を歩く人だったんだけどね。
}
{
- ren_stance == "trust":
    @kaede:smile レンの坊やにも、よろしく言っておくれ。
- ren_stance == "oppose":
    @kaede:normal 喧嘩した相手ほど、次に会う時が楽しみなもんさ。
}
-> END


=== kaede_journal ===
~ kaede_heard_journal = true
ユウは、いばらの奥で見つけた古い記録帳を差しだした。
カエデ博士は表紙に触れたきり、しばらく動かなかった。
@kaede:think ……この字は、よく知ってる。昔、一緒に森を歩いた人のだ。
@kaede:sad 森殿へ行ったきり、帰らなかった。もう、ずいぶん前の話さ。
@kaede:smile それは、お前が持っておいで。あの人も、そのほうが喜ぶ。
->->


// ============================================================
// ハナゾノの人々(何度でも話せる)
// ============================================================

// 見張りのモク — 東の門。枯れていく大樹を毎朝見ている。
=== villager_a ===
{
- shrine_done:
    {stopping:
    - @villager_a:smile 見ろよ、ユウ。大樹のてっぺんに、新しい芽が出てる。
      @villager_a:normal 毎朝、落ち葉を数えるのが日課だったんだ。
      @villager_a:smile ……明日からは、芽を数えることにするよ。
    - @villager_a:smile 今朝の芽は、十一。昨日より三つ多い。
    }
- device_stopped:
    {stopping:
    - @villager_a:surprised 今朝、葉が一枚も落ちなかった。十七日ぶりだ。
      @villager_a:normal ……お前、何かしたろ。顔に書いてある。
      {
      - ashstar_choice == "listen":
          @villager_a:think 灰星局のやつと話した？ ……下流の町も、沈みかけてるのか。
          @villager_a:sad 見張りってのは、自分の森しか見えなくなるもんだな。
      - ashstar_choice == "report":
          @villager_a:think 本部に森の記録を？ 届くといいな。
          @villager_a:normal 遠くの偉い人は、落ち葉なんか数えないだろうから。
      - ashstar_choice == "leave":
          @villager_a:normal 灰星局のやつ、何か言ってたか？ ……いや、いい。
      }
    - @villager_a:normal 大樹の葉が落ちないってだけで、見張り台が広く感じる。
    }
- met_ren:
    @villager_a:think 旧街道のほうから、ずっと唸るような音がする。
    @villager_a:normal 灰星局の機械だろう。あれが鳴りだしてから、葉の落ち方が変わった。
- else:
    {stopping:
    - @villager_a:sad 毎朝、見張り台で落ち葉を数えてる。今朝は四十二枚。
      @villager_a:normal 夏の大樹が、秋みたいに葉を落とすんだ。……笑えないだろ。
    - @villager_a:normal 獣道の連中、気が立ってる。背中を取られるなよ。
    }
}
{ pacified_count >= 3 and device_stopped:
    @villager_a:smile 獣道の連中、お前を見ても牙をむかなくなったって。狩人が言ってた。
}
-> END


// 織り手のスズ — 碧樹の葉で染める。色が抜けていく。
=== villager_b ===
{
- shrine_done:
    {
    - not suzu_gift:
        ~ suzu_gift = true
        @villager_b:smile ユウ、ごらん。昨日染めた帯が、まだこの色だよ。
        碧樹の葉と同じ、深い碧。糸の一本一本が、濡れたように光っている。
        @villager_b:normal 染め場の薬草が余ってるんだ。旅に持っておいき。
        >> sfx item_get
        >> give herb 2
    - else:
        @villager_b:smile 祭りの帯、今年は間に合いそうだ。お前の分も織っとくよ。
    }
    {
    - ren_stance == "trust":
        @villager_b:normal ドローンの子と組んだんだって？ 二本撚りの糸は強いよ。
    - ren_stance == "oppose":
        @villager_b:think 糸はね、引っぱり合うと切れる。でも、ほどけば結び直せる。
    }
- device_stopped:
    @villager_b:surprised おや、今朝の染めがまだ色を残してる。四日目だよ。
    @villager_b:normal 森の元気ってのは、正直に布に出るもんさ。
- else:
    {stopping:
    - @villager_b:sad 見ておくれ、この布。碧樹の葉で染めた、祭りの帯さ。
      @villager_b:normal 染めても染めても、三日で色が抜ける。
      @villager_b:think 糸のせいじゃない。葉のほうに、もう色が残ってないのさ。
    - @villager_b:normal 色ってのはね、森の元気そのものなんだよ。
    }
}
-> END


// 子どものアオ — レンのドローンに夢中。
=== villager_c ===
{
- shrine_done:
    {
    - ren_stance == "trust":
        @villager_c:surprised レンと仲良くなったの！？ ずるい！
        @villager_c:smile 今度、ドローンさわらせてって頼んでよ。ね？
    - ren_stance == "oppose":
        @villager_c:sad レンとケンカしたの？ ……じゃあ、ぼくが仲直りの手紙書く。
    - else:
        @villager_c:smile 森殿の守護獣って、大きかった？ 家より大きい？
    }
- met_ren and not aoi_asked:
    -> ask_ren
- met_ren:
    @villager_c:normal レンのドローン、なんで羽ばたかないのに飛べるんだろ。
- else:
    {stopping:
    - @villager_c:surprised ユウ！ さっき、銀色の鳥が東に飛んでった！
      @villager_c:smile 羽ばたかないで、ブーンって。あれ絶対、機械だよ！
    - @villager_c:normal 銀色の鳥、また来ないかなあ。
    }
}
{
- device_stopped and pacified_count > defeated_count:
    @villager_c:think 鎮めるって、どうやるの？ ……ぎゅってするの？
- device_stopped and defeated_count > pacified_count:
    @villager_c:normal ユウ、つよいんだね。……森の子たち、ちょっとかわいそうだけど。
}
-> END

= ask_ren
~ aoi_asked = true
@villager_c:surprised ねえ、銀色の鳥の人に会ったんでしょ！ どんな人？
* [レンっていう子だよ]
    @villager_c:smile レン……！ かっこいい。ぼく、大きくなったらレンになる。
* [ちょっと怖かった]
    @villager_c:think こわいの？ ……でも、ドローンが好きな人に、悪い人はいないよ。
-
-> END


// 蜜蝋屋のハチ — 湿地の花粉で蜂が酔っている。
=== villager_d ===
{
- shrine_done:
    @villager_d:smile 巣箱がうるさいくらいだ。いい蝋ができたら、灯りを一本やろう。
- marsh_cleared:
    @villager_d:surprised 湿地の花粉が流れたって？ どうりで、蜂がまっすぐ帰ってきた。
    {
    - not hachi_gift:
        ~ hachi_gift = true
        @villager_d:smile 礼だ。わしの取っておきの薬草膏、持っていけ。
        >> sfx item_get
        >> give potion 2
    }
- else:
    {stopping:
    - @villager_d:sad うちの蜂が、みんな酔っぱらっとる。湿地の花粉だよ。
      @villager_d:normal ふらふら飛んで、巣に帰ってこん。これじゃ蝋が作れん。
    - @villager_d:think 今年の花粉は、妙に濃い。森が、無理に咲かされとるみたいだ。
    }
}
{ burned_log:
    @villager_d:smile 旧街道の倒木を焼いたろ。煙がここまで来て、蜂がおとなしくなった。
}
-> END


// ============================================================
// 立て札
// ============================================================
=== sign_village ===
『樹上集落ハナゾノ　東：苔むす獣道　南：旧街道』
{ not burned_log:
    旧街道の文字の下に、「倒木のため通行止め」と書き足されている。
}
-> END

=== sign_trail ===
『分かれ道　北：いばらの茂み　東：花粉の湿地　南：倒木の旧街道』
北の茂みは、いばらで閉ざされている。ヒノコの火なら、焼き払えそうだ。
-> END

=== sign_road ===
『灰星局 碧樹圏第三中継所　作業中につき立入禁止』
{
- device_stopped and ashstar_choice == "listen":
    札の裏に、小さく書き足してある。『森のみなさん、すまない』
- burned_log:
    西の倒木は焼け落ちて、ハナゾノへの近道が開いている。
- else:
    西の倒木の向こうは、ハナゾノだ。ヒノコの火なら、道が開くかもしれない。
}
-> END

=== sign_marsh ===
『花粉の湿地　この先、守護獣の森殿』
『花粉の季節は、口を布で覆うこと』
-> END


// ============================================================
// 苔むす獣道
// ============================================================
=== trail_enter ===
>> bgm forest
苔が音を吸いこむ。自分の足音さえ、どこか遠い。
木々のあいだを、野生のモンスターがゆっくり行き来している。
@konoha:normal ホゥ。
コノハが、茂みの一匹をじっと見つめた。向こうはまだ、こちらに気づいていない。
背後からそっと近づけば、先に動けそうだ。……背中を取られれば、その逆になる。
@hinoko:normal コン……。
ヒノコが身を低くして、しっぽの火を小さく絞った。
{ not met_ren:
    ~ objective = "獣道の分かれ道へ"
}
-> END


=== trail_ren ===
{ met_ren:
    -> END
}
>> bgm none
分かれ道の上に、銀色の何かが、羽音もなく浮かんでいた。
>> camera ren_trail
@unknown 動かないで。いま、いいところなんだ。
木の根に腰かけた少年が、膝の端末から目を離さずに言った。
銀色の機械——ドローンが、ユウの環測器のまわりをゆっくり一周する。
@ren:think 手首のそれ、環測器か。ずいぶん古い型だ。針式なんて初めて見た。
@ren:normal 僕はレン。こっちはミル。森の出力を測ってる。
@ren:normal 君は……巡環士候補。なるほど、記録する人か。
@ren:think 記録して、それで？ 記録帳が森を治したって話は、聞いたことがない。
* [記録は、始まりだよ]
    @ren:smile ……始まり、ね。じゃあ、終わりは誰が書くんだ？
* [君は何をしてるの？]
    @ren:normal 答え合わせ。この森が、どのくらい壊れてるかの。
-
@ren:normal ミル、数値を。
ドローンの腹で、赤い光が三度またたいた。
@ren:normal 碧樹圏の循環出力、平年の六割。この十日で、さらに一割落ちた。
@ren:think 落ち方がきれいすぎる。自然の衰えじゃない。どこかで吸われてる。
@ren:normal 南の旧街道に、灰星局の中継器がある。強制起動の、雑なやつだ。
@ren:think 下流の町のために、森から力を前借りしてる。理屈は正しい。手際が悪い。
@ren:normal 碧環は機械だ。壊れた機械は、祈っても直らない。
@ren:normal 守護獣も同じ。あれは装置の部品だよ。暴れる部品には、制御がいる。
>> sfx notice
@hinoko:angry コンッ！
ヒノコが毛を逆立てた。レンは、少しだけ眉を上げた。
@ren:normal 怒るなよ。君たちの悪口を言ったわけじゃない。
端末を閉じて、レンは立ち上がった。
@ren:normal 僕は森殿へ行く。守護獣の環核を、この目で測りたい。
@ren:smile 君は旧街道を見てくるといい。記録、楽しみにしてるよ。
>> walk ren_trail east_exit
>> hide ren_trail
>> camera player
ミルのかすかな駆動音だけが、しばらく苔の上に残っていた。
~ met_ren = true
~ objective = "南の旧街道で、灰星局の中継器を調べる"
>> note 分かれ道でレンと出会った
>> bgm forest
-> END


=== grove_journal ===
{ journal_read:
    木の洞は、もう空っぽだ。苔に、記録帳の形のくぼみだけが残っている。
    -> END
}
いばらの奥、古い木の洞に、革表紙の記録帳が押しこまれていた。
表紙はふやけ、名前の欄はかすれて読めない。細く、几帳面な字だ。
『碧樹の環核、今年も祭壇にて安定。守護獣、良好。』
『環核は器を選ぶ、と先代は言った。器とは何か、私はまだ知らない。』
『碧環が本当に弱るとき、環核はみずから歩きだす——と古い巡り歌にある。』
『詩人の大げさだろう。だが、今朝の祭壇の苔には、小さな足跡があった。』
最後のページだけ、字が少し乱れていた。
『次に来る者へ。数字だけを見るな。森の息を聞け。』
コノハが、そのページをじっと見つめている。
ユウは記録帳をそっと閉じ、鞄にしまった。
~ journal_read = true
>> sfx item_get
>> note いばらの奥で古い記録帳を見つけた
-> END


// ============================================================
// 倒木の旧街道 — 灰星局の中継所
// ============================================================
=== road_ashstar ===
{ device_stopped:
    -> revisit
}
{ ashstar_tries > 0:
    -> retry
}
>> bgm ashstar
>> camera ashstar_device
旧街道の真ん中に、鉄の柱が突き立っていた。
柱の先で碧い光が脈打つたび、道ばたの草が目に見えて色を失っていく。
>> sfx notice
ユウの環測器の針が、狂ったように震えた。
>> camera player
@ashstar:surprised ……子ども？ ここは立入禁止だ。札が見えなかったか。
工具を握った作業着の男が振り向いた。目の下に、濃い隈がある。
@ashstar:normal 灰星局、碧樹圏第三中継所。見てのとおり、復旧作業中だ。
* [森が枯れてます]
    @ashstar:sad 知ってる。数値なら、君よりずっと先に見てる。
* [何をしてるんですか]
    @ashstar:normal 中継器を強制起動して、碧環の流れを下流へ押しだしてる。
-
@ashstar:sad 川下のカワジリって町が、先月から三度沈んだ。
@ashstar:normal 流れが詰まって、水だけが行き場をなくしてるんだ。
@ashstar:normal この装置で押せば、あと半月はもつ。半月あれば、堤防が間に合う。
@ashstar:sad ……その半月ぶん、この森が痩せる。分かってるさ。
@ashstar:normal 止めろと言うなら、本部に言ってくれ。俺は、止めるなと言われてる。
>> shake
装置が甲高く鳴いた。茂みから、目の色を変えたモンスターたちが這い出てくる。
@ashstar:surprised まずい、出力が跳ねた！ 近くの子らまで引っぱられてる……！
@ashstar:angry 下がってろ！ すぐ落ち着く、落ち着くはずなんだ……！
@shizuku:angry キュイッ！
シズクが、ユウの前に飛びだした。
~ objective = "強制起動装置を止める"
-> fight

= retry
>> bgm ashstar
>> camera ashstar_device
装置はまだ唸っている。引き寄せられたモンスターたちが、こちらに向き直った。
@ashstar:sad ……また来たのか。頼む、もう下がっててくれ。
@hinoko:angry コン！
-> fight

= fight
~ ashstar_tries = ashstar_tries + 1
~ battle_result = ""
>> battle ashstar
{
- battle_result == "lose":
    >> shake
    装置の脈動に押し返され、ユウたちは茂みまで転がった。
    @ashstar:sad ……だから言ったろ。子どもの来る場所じゃない。
    >> fade
    >> heal
    茂みの陰で、三匹の傷を手当てした。装置の唸りは、まだ続いている。
    ~ objective = "態勢を立て直し、強制起動装置を止める"
    -> END
}
>> sfx break
>> shake
装置の光が、ぷつりと途切れた。
>> bgm none
張りつめていた空気がほどけ、モンスターたちは我に返ったように森へ散っていく。
>> wait 600
道ばたの草が、ほんの少し、色を取り戻した気がした。
@ashstar:sad ……止まった、か。
男は、動かなくなった柱に額を押しあてた。
@ashstar:sad 半月……。あと半月、もたせるはずだったんだ。
@konoha:sad ホゥ……。
* [話を聞かせて]
    ~ ashstar_choice = "listen"
    ユウは、男の隣に腰をおろした。
    @ashstar:surprised ……聞いて、どうする。
    長い沈黙のあと、男はぽつりと話しはじめた。
    @ashstar:sad カワジリには、妹がいる。先月、赤ん坊が生まれたばかりでな。
    @ashstar:normal 屋根の上で夜を越した、って手紙が来た。それで志願した。
    @ashstar:sad 森を痩せさせてるのは分かってた。分かってて、目をつむった。
    @ashstar:normal ……聞いてもらったら、少し頭が冷えた。ありがとう。
    @ashstar:normal しばらくここに残るよ。装置の後始末と……森に、謝らないとな。
    >> note 灰星局員の話を聞いた
* [本部に伝えてほしい]
    ~ ashstar_choice = "report"
    ユウは記録帳を開き、道中で測った森の数値を書き写して、一枚破りとった。
    @ashstar:surprised これは……森の出力か。獣道から、ここまで。
    @ashstar:think 本部は、下流の水位しか見てない。こっちの数字は、誰も見てない。
    @ashstar:normal 分かった。俺が持っていく。本部長に、直接だ。
    @ashstar:sad ……子どもに宿題を出されるとはな。
    >> walk ashstar_worker north_exit
    >> hide ashstar_worker
    >> note 森の記録を灰星局本部へ託した
* [黙って立ち去る]
    ~ ashstar_choice = "leave"
    かける言葉が、見つからなかった。ユウは背を向けた。
    @ashstar:sad ……ああ。それでいい。俺だって、俺に何も言えない。
    しばらくして振り返ると、男は黙々と野営を畳んでいた。
    >> walk ashstar_worker north_exit
    >> hide ashstar_worker
    >> note 中継所を後にした
-
~ device_stopped = true
>> bgm road
@hinoko:normal コン。
ヒノコが、止まった柱の根もとに芽吹いた草を、鼻先でつついた。
~ objective = "花粉の湿地を越えて、森殿へ"
-> END

= revisit
{cycle:
- 止まった中継器が、風に吹かれて冷えていく。根もとの草は、もう青い。
- 鉄の柱に、蔦が一本、試すように巻きつきはじめている。
}
-> END


// 中継所に残った灰星局員(「話を聞く」を選んだ時だけいる)
=== ashstar_worker ===
{ not device_stopped:
    @ashstar:normal ここは立入禁止だ。……悪いけど、戻ってくれ。
    -> END
}
{
- shrine_done:
    @ashstar:surprised 森殿のほうから、風が変わった。……君か？
    @ashstar:normal 下流の水が、ほんの少し引いたらしい。環核がつながったせいかな。
    @ashstar:smile 報告書には、ありのまま書くよ。森は生きてる、ってな。
- not worker_gift:
    ~ worker_gift = true
    @ashstar:normal やあ。後始末は、思ったより時間がかかるな。
    @ashstar:think 装置の記録を見直してた。止めてから、森の出力が少しずつ戻ってる。
    @ashstar:sad 数字で見ると、自分が何を削ってたのか、よく分かるよ。
    @ashstar:normal これ、局の支給品だ。森殿へ行くなら、持っていけ。
    >> sfx item_get
    >> give potion 2
- else:
    {cycle:
    - @ashstar:normal 妹に手紙を書いた。何を書いたかは、内緒だ。
    - @ashstar:think 強制起動に頼らない方法……本当に、ないのかな。
    }
}
-> END


// ============================================================
// 花粉の湿地
// ============================================================
=== marsh_enter ===
>> bgm marsh
湿地は、金色の霧に沈んでいた。
ひと息吸うだけで、喉の奥が甘くしびれる。花粉だ。
@shizuku:surprised くしゅっ！
シズクが盛大にくしゃみをして、自分で驚いて水たまりに転がりこんだ。
蓮の葉が、飛び石のように東へ続いている。その先を、花粉の壁が塞いでいた。
{ not marsh_cleared:
    シズクが、ヒゲの花粉を水で払っている。……水なら、壁も流せるかもしれない。
    コノハは、壁の脇の古木を見上げていた。蔓の足場があれば、回りこめそうだ。
}
{ met_ren:
    蓮の葉の上に、使い捨ての濾過筒がひとつ落ちている。……レンのものだろう。
}
{ not shrine_done:
    ~ objective = "花粉の壁を越えて、森殿へ"
}
-> END


// ============================================================
// 守護獣の森殿 — 環核試練
// ============================================================
=== shrine_enter ===
{ shrine_done:
    -> after
}
{ guardian_tries > 0:
    -> retry
}
>> bgm shrine
苔むした石段の先に、森殿はあった。
柱という柱に根が絡み、天井の割れ目から、細い光が祭壇に落ちている。
>> camera moridorado
祭壇の上で、巨きな獣が眠っていた。
樹皮のような鱗。角には若葉。胸の中央で、ひび割れた碧い石が弱々しく明滅している。
@konoha:surprised ホゥ……！
>> camera ren_shrine
その足もとに、レンが膝をついていた。
両手に抱えているのは、鈍色の輪。環核にはめるための、枷のような器具だ。
@ren:normal 来たのか。ちょうどいい。証人がいたほうが、あとで話が早い。
@ren:normal 抑制器だ。環核の出力を、外から一定に保つ。
@ren:think 守護獣が不安定なら、安定させればいい。部品の調律と同じだ。
* [それは枷だよ]
    @ren:normal 言い方の問題だ。堤防だって、川から見れば枷だろう。
* [眠ってるのに？]
    @ren:normal 起きてたら、はめさせてもらえない。
-
>> sfx notice
カチリ、と輪がひびの縁にかかった。
>> bgm none
>> shake
@moridorado:angry グ……ルォォォォ……！
>> sfx break
>> shake
守護獣の目が開いた。ひびから碧い光があふれ、祭壇の苔が一瞬で白く枯れる。
@ren:surprised 出力が逆流して——ミル、抑えろ！
ミルが弾き飛ばされ、石畳を転がった。それでもレンは、輪から手を離さない。
@ren:angry 離したら、全部こぼれる！ いま制御しないと、森ごと……！
* [レン、力を貸して]
    ~ ren_stance = "trust"
    ユウは、苦しむ守護獣から目をそらさずに、レンの隣へ駆けこんだ。
    @ren:surprised ……っ。
    @ren:think 分かった。抑制器を外す。三つ数える間、あいつの気を引いてくれ。
    @ren:normal ミルの予測を回す。攻撃の予告は、僕が読む。
    カチン、と輪が外れた。守護獣の咆哮が、痛みから怒りへ変わる。
* [それを外して！]
    ~ ren_stance = "oppose"
    @ren:angry 外したら、止める手段がなくなる！
    @hinoko:angry コンッ！
    ヒノコの火が、輪の留め金を焼き切った。抑制器が、乾いた音を立てて落ちる。
    @ren:angry ……っ、何をする！ 三か月かけて作ったんだぞ！
    守護獣の咆哮が、痛みから怒りへ変わる。もう、言い争う時間はない。
-
>> bgm guardian
~ objective = "守護獣モリドラードを鎮める"
-> trial

= retry
>> bgm guardian
>> camera moridorado
守護獣は、まだ祭壇の前で荒い息をついている。胸のひびが、痛そうに脈打つ。
{
- ren_stance == "trust":
    @ren:normal 予告の癖は掴んだ。守りが崩れた瞬間を、逃すなよ。
- else:
    @ren:think ……まだやる気か。いいさ。君のやり方を、見せてもらう。
}
-> trial

= trial
~ guardian_tries = guardian_tries + 1
~ battle_result = ""
>> camera player
三匹が、ユウの前に並んだ。
>> battle guardian
{
- battle_result == "lose":
    >> shake
    守護獣の尾が石畳をなぎ払い、三匹はまとめて吹き飛ばされた。
    @ren:angry 下がれ！ 一度、立て直すんだ！
    >> fade
    >> heal
    石段の陰で、三匹の傷を手当てした。奥から、苦しげな唸りが聞こえる。
    ~ objective = "態勢を立て直し、守護獣を鎮める"
    -> END
- battle_result != "pacified":
    守護獣は膝を折った。けれど、胸のひびは、まだ荒く明滅している。
    @ren:think 倒れたのに、数値が落ち着かない……？ 力じゃ、届かないのか。
    倒すのではない。鎮めなければ、環核はつながらない。
    ~ objective = "守りを崩し、守護獣を鎮める"
    -> END
}
>> sfx pacify
守護獣の咆哮が、ふっと途切れた。
巨体がゆっくりと沈み、角の若葉が、静かに床へ触れる。
>> wait 600
>> sfx resonance
そのとき、ヒノコの額が光った。
続いてシズクの胸が、コノハの後ろ頭が。三つの小さな碧い輪が、同じ速さで瞬く。
守護獣の胸のひびが、その瞬きに合わせて、脈を打った。
一つ、二つ。……ひびの奥で、途切れていた光の筋がつながっていく。
>> sfx grow
>> bgm shrine
森殿の床から、若い芽がいっせいに顔を出した。
@moridorado:normal ……ルゥ……。
守護獣は、三匹を長いこと見つめていた。懐かしいものを見るような目だった。
@hinoko:surprised コン……？
やがて守護獣は目を閉じ、穏やかな寝息を立てはじめた。胸の石は、もう震えていない。
>> camera ren_shrine
@ren:surprised ……今の、何だ。
ミルを拾い上げたレンが、端末の画面を見つめたまま動かない。
@ren:think 波形が、重なって……いや。計測誤差だ。そうでなきゃおかしい。
ユウの視線に気づいて、レンは端末を伏せた。
{
- ren_stance == "trust":
    @ren:normal ……助かった。借りにしておく。利子はつけないでくれ。
    @ren:sad 僕の町の堤防は、祈りじゃ直らなかった。だから、数字を信じてる。
    @ren:think でも今日のは、数字じゃ説明できない。それが少し、悔しい。
- else:
    @ren:normal 結果は結果だ。今日は、君のやり方で鎮まった。それは認める。
    @ren:sad でも、僕の町の堤防は、祈りじゃ直らなかった。
    @ren:angry 次に何かが壊れた時、君はまた、運よく間に合うのか？
}
@ren:normal 今日の数値は持ち帰る。……またな、巡環士候補。
>> walk ren_shrine ren_exit
>> hide ren_shrine
>> camera player
~ shrine_done = true
>> note 守護獣モリドラードを鎮め環核がつながった
~ objective = "ハナゾノへ戻り、カエデに報告する"
-> END

= after
祭壇の上で、守護獣が眠っている。胸の環核が、呼吸するように光っていた。
-> END


// ============================================================
// 終章 — 帰郷、そして灰星局本部
// ============================================================
=== epilogue ===
{ chapter_done:
    -> END
}
>> fade
>> warp hanazono lab
>> bgm village
その夜。研究庵の窓から、大樹の葉ずれが聞こえていた。
昨日までとは違う、湿り気のある、やわらかな音だ。
@kaede:smile おかえり、ユウ。……顔を見れば分かる。よくやったね。
@kaede:normal さあ、聞かせておくれ。記録帳の、今日のページを。
ユウは、旅のことを順に話した。
{
- ashstar_choice == "listen":
    @kaede:think 灰星局の男の話を、最後まで聞いたんだね。
    @kaede:smile 答えの出ない話に付き合うのも、巡環士の仕事さ。
- ashstar_choice == "report":
    @kaede:normal 記録を本部へ託した、か。記録は、届いてこそだ。
    @kaede:think ……ただね。読んだ人がどう動くかまでは、書いた人には選べない。
- ashstar_choice == "leave":
    @kaede:normal 黙って背を向けた、か。……言葉が出ない日もある。
    @kaede:think あの男の顔は、いつかまた思い出す。その時に考えればいい。
- else:
    @kaede:think 旧街道の中継器は、まだ唸っているそうだね。
    @kaede:normal 環核がつながっても、吸いだす口が開いたままじゃ、いずれ痩せる。
}
{
- ren_stance == "trust":
    @kaede:smile レンと、並んで立ったんだね。
    @kaede:normal 意見の違う相手と組むのは、同じ意見の相手と組むより、ずっと強い。
- ren_stance == "oppose":
    @kaede:think レンの抑制器を、壊したのかい。
    @kaede:normal 間違っちゃいない。……でも、あの子の三か月も本物だったろうね。
}
{
- pacified_count >= 5:
    @kaede:smile 道中の子らも、ずいぶん鎮めてきたね。毛並みに森の匂いがついてる。
- pacified_count >= 1:
    @kaede:normal 道中で鎮めた子らのことも、書いておおき。数は少なくてもいい。
- else:
    @kaede:normal 戦うしかない場面もある。……次は、鎮める手も試してごらん。
}
ユウは最後に、森殿で三匹の結晶が光ったことを話した。
カエデ博士は、湯のみを置いた。
@kaede:think ……そうかい。
長い沈黙のあいだ、博士は窓の外の大樹を見ていた。
@kaede:normal 環核もこの子たちの結晶も、同じ森で生まれた。響き合っても、ふしぎはない。
@kaede:smile ……年寄りの推測さ。記録帳には、見たことだけを書いておおき。
{ (took_journal or journal_read) and not kaede_heard_journal:
    -> kaede_journal ->
}
{ took_journal or journal_read:
    @kaede:think あの記録帳のことは……いつか、ちゃんと話すよ。今夜じゃないけどね。
}
@kaede:smile 碧樹の環核は、つながった。セイリュウの環核は、あと三つ。
@kaede:normal 旅支度は明日でいい。今夜は、よくお休み。
@shizuku:smile キュイ。
三匹は寝台の上で、ひとかたまりになって眠った。三つの結晶が、同じ速さで灯っていた。
>> bgm none
>> fade
——同じ頃、灰星局 本部。
窓を打つ雨の音が、広い執務室にこもっていた。
壁の地図には、下流の町々に、赤い印が増え続けている。
>> sfx door
{
- ashstar_choice == "report":
    @ashstar:normal 碧樹圏第三中継所より、戻りました。本部長に、直接お渡ししたいものが。
    局員は、雨に湿った一枚の紙を差しだした。子どもの字で、森の数値が並んでいる。
    @gendou:think ……森の出力の記録か。道順に、細かく測ってある。
    @gendou:normal 字は拙いが、数字は正確だ。……誰が書いた。
    @ashstar:normal 巡環士候補の子どもです。中継器を止めたのも、その子です。
- ashstar_choice == "listen":
    @ashstar:normal 報告します。碧樹圏第三中継所、強制起動装置が停止しました。
    @ashstar:normal 現地の職員は残留を希望。報告書に、一行だけ添え書きが。
    @ashstar:think 森にも息がある。……とだけ。
- ashstar_choice == "leave":
    @ashstar:normal 報告します。碧樹圏第三中継所、強制起動装置が停止しました。
    @ashstar:normal 職員は撤収済み。停止の経緯は……本人が、話そうとしません。
- else:
    @ashstar:normal 報告します。碧樹圏の中継器は、予定どおり稼働中です。
}
@ashstar:normal それと観測班から。森殿の守護獣が鎮静、碧樹圏の循環は持ち直しています。
@gendou:normal ……そうか。
本部長ゲンドウは、窓の外の雨を見たまま、しばらく答えなかった。
@gendou:think 森が息を吹き返した。喜ばしいことだ。
@gendou:sad だが、カワジリの水位は、今夜も上がる。
@gendou:normal 森を守った者は正しい。……だが、正しさは堤防にはならん。
机の端の写真立てを、ゲンドウは指先でそっと起こした。
小さな子どもと、若い女が笑っている。写真の縁は、水に濡れた跡で波打っていた。
@gendou:sad ……今年も、雨が早いな。
@ashstar:think それと、本部長。抑制器の件です。
@ashstar:normal 設計者の少年から、森殿の測定値が。説明のつかない波形がある、と。
@gendou:think ……あの子が、説明がつかないと言ったのか。
ゲンドウは、写真立てを静かに伏せた。
@gendou:normal 解析班に回せ。
{
- ashstar_choice == "report":
    @gendou:normal それと、第三中継所の再起動は凍結する。……この数字を見た以上はな。
    @ashstar:surprised 凍結、ですか。では、カワジリは……。
    @gendou:normal 別の手を探す。森も町も、見捨てはせん。
- ashstar_choice == "listen":
    @gendou:normal 第三中継所は、現地の判断に任せる。再起動は延期だ。
    @ashstar:surprised よろしいのですか。
    @gendou:normal 息があると書いた者を、私は叱れん。
- ashstar_choice == "leave":
    @gendou:normal 第三中継所を修理し、再起動しろ。一日でも早くだ。
    @ashstar:sad ……森は、どうなります。
    @gendou:normal 分かっている。
- else:
    @gendou:normal 中継器の出力を上げろ。一日でも早く、下流へ流れを通す。
    @ashstar:sad ……森は、どうなります。
    @gendou:normal 分かっている。
}
@gendou:sad どちらも救えぬなら、せめて、選んだ責めは私が負う。
局員が去ったあとも、ゲンドウは長いこと、雨の音を聞いていた。
>> fade
~ objective = "次の環核の手がかりを探す"
~ chapter_done = true
>> note 第一章・碧樹圏の環核をつないだ
>> chapter_end
-> END


// ============================================================
// 野外での敗北(ゲームが泉へ戻して回復したあとに呼ぶ)
// ============================================================
=== defeat ===
>> sfx heal
泉の水音で、目が覚めた。
{cycle:
- @kaede:normal 気がついたかい。見張りのモクが、担いで運んでくれたんだよ。
  @kaede:think 負けも記録のうちさ。何に負けたか、書いておおき。
- ヒノコが、ユウの頬をぺろりとなめた。三匹とも、泉の水で傷はふさがっている。
  @hinoko:normal コン。
- @kaede:smile また泉の世話になったね。ここの水は、何度でも優しいよ。
}
{cycle:
- 野生の子には、背後から近づこう。背中を取られると、先手を許してしまう。
- 頭上の予告を見て、守るか攻めるかを決めよう。
- 守りをブレイクすれば、鎮める好機が生まれる。
}
-> END
