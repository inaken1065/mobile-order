# 信頼性設計: mobile-order の Google Cloud デプロイ

## Sources

- `[Q2]` releases と current のリンク、`[Q4]` マウントの起動条件。`nfr-design-questions.md` の人間の回答
- `[memory:M1]` `reliability-requirements.md`(NFR3.1〜3.8、NFR4.1〜4.3)、`performance-requirements.md`(NFR5.5、NFR5.6)
- `[memory:M2]` `requirements.md` の FR2.3〜FR2.5、FR5.3、FR5.4

## 方針

数値の可用性(SLO)は設けず(`[Q5]`、NFR 要件)、「異常終了後の自動再起動」と「デプロイ失敗時の自動ロールバック」の 2 つで復旧する。バックアップは取らない。

## 1. プロセスの自動再起動(NFR3.1、NFR3.2)

systemd のユニットで、異常終了後の再起動を設定する。

この節のユニット定義(`mobile-order.service`)を、**唯一の正**とする。`security-design.md` と `performance-design.md` の指定は、すべてここに反映してある。

```ini
[Unit]
Description=mobile-order API
After=local-fs.target
RequiresMountsFor=/mnt/data
AssertPathIsMountPoint=/mnt/data
StartLimitIntervalSec=0

[Service]
User=mobile-order
Environment=HOST=127.0.0.1 PORT=3000 DB_PATH=/mnt/data/app.db
Environment=NODE_OPTIONS=--max-old-space-size=192
ExecStartPre=/usr/local/bin/node -e "if (+process.versions.node.split('.')[0] < 24) process.exit(78); try { require('node:sqlite') } catch { process.exit(78) }"
ExecStart=/usr/local/bin/node /opt/mobile-order/current/server.mjs
Restart=always
RestartSec=2
RestartPreventExitStatus=78
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/mnt/data

[Install]
WantedBy=multi-user.target
```

- **Node の配置**: 起動スクリプト(LC9)が、固定した版の公式の配布物を SHA-256 で検証してから `/opt/node-v<版>/` に展開し、`/usr/local/bin/node` からシンボリックリンクを張る。ユニットは `/usr/local/bin/node` だけを参照する。版の更新は、このリンクの張り替えで行う。
- **Caddy との起動順**: `caddy.service` に drop-in(`/etc/systemd/system/caddy.service.d/order.conf`)を置き、`After=mobile-order.service` と `Wants=mobile-order.service` を指定する。起動順は「ディスクのマウント、`mobile-order.service`、`caddy.service`」。`Wants=` なので、アプリの起動に失敗しても Caddy は起動し、画面の静的配信は続く(`/api` は 502)。
- **Node の版の確認が失敗したとき**: `ExecStartPre` は、Node の版が 24 未満か `node:sqlite` が読めないときに終了コード 78 で失敗する。`RestartPreventExitStatus=78` により、再起動を止める(再試行しても直らないため、2 秒おきの失敗でジャーナルを埋めない)。`systemctl is-failed mobile-order` で検知し、手順書で Node の導入を直す。
- **未マウント時の失敗(`AssertPathIsMountPoint=`)**: `Assert` が失敗するとユニットの起動は失敗になり、`systemctl is-failed` で検知できる(`ConditionPathIsMountPoint=` のようにスキップして成功扱いにならない)。
- `RestartSec=2` と `StartLimitIntervalSec=0` で、`kill -9` のあと数秒で再起動する(要件は 30 秒以内)。再起動が連続しても、起動の制限で止まらない。
- VM の再起動では `WantedBy=multi-user.target` で自動起動する。Caddy も同じ。起動順は、ディスクのマウント、Fastify、Caddy。120 秒以内の応答(NFR3.2)は、再起動の試験で確認する。

## 2. データディスクが未マウントのとき(NFR3.8)

- `/etc/fstab` に `/dev/disk/by-id/google-<ディスク名>` を `/mnt/data` に、`nofail` 付きで書く。`nofail` により、ディスクがなくても VM の起動は止まらず、SSH で入れる。
- ユニットに `RequiresMountsFor=/mnt/data` と `AssertPathIsMountPoint=/mnt/data` を併用する。`/mnt/data` がマウントポイントでなければ、`Assert` の失敗でユニットの起動が失敗になる(`ConditionPathIsMountPoint=` のようにスキップして成功扱いにはならない)。
- 失敗は `systemctl is-failed mobile-order` と、`mountpoint -q /mnt/data`(未マウントなら終了コード 非 0)で検知できる。ログの優先度には頼らない。ブートディスク上に DB は作られない(`/mnt/data` の下にしか書けず、`ProtectSystem=strict` と `ReadWritePaths=/mnt/data` で他の場所へは書けない)。
- この失敗はデプロイのスモークテストを不合格にする。ロールバック(`current` を戻す)では直らないため、これは NFR3.3 の**意図的な例外**として扱い、自動ロールバックを行わない(3 節)。手順書でマウントを直す(NFR3.4)。

## 3. デプロイとロールバック(NFR3.3、NFR3.4、NFR4.3)

配置は `/opt/mobile-order/releases/<id>/` と、`current` のシンボリックリンクで行う(`[Q2]`)。`deploy.sh` の流れ:

1. 成果物(`server.mjs`、`schema.sql`、`web/`)を一時ディレクトリ(`releases/.tmp-<id>/`)に展開し、展開が完了してから `mv` で `releases/<新 id>/` にする(中断した展開が `releases/<id>` に不完全な形で残らない)。起動時と展開の前に、`.tmp-*` が残っていれば削除する。
2. 直前の版を `prev` として記録する(`readlink current`)。
3. `ln -sfn` で `current` を新しい版に向け、`systemctl restart mobile-order` を実行する。
4. スモークテストを、VM 上の `localhost` に対して 60 秒以内に実行する(NFR5.5)。`GET /`(Caddy 経由)と `GET /api/menu`(200 と `{ items }` の JSON)の両方。
5. 合格したら、`prev` より古いリリースを削除する(最新と直前の 2 つ、つまり直前の 1 世代を残す)。
6. 不合格またはデプロイ手順が非 0 のときは、`current` を `prev` に戻して再起動し、同じスモークテストを実行する。**ロールバックの開始から 120 秒以内に合格すること**が合格条件(NFR3.3)。
7. ロールバックにも失敗したら、ジョブを失敗として終了し、手動の復旧手順(手順書)で戻す(NFR3.4)。

**端の場合の動作(決定)**

| 場合 | 動作 |
|---|---|
| 初回デプロイ(`prev` がない) | 戻す先がないため、ロールバックしない。スモークテストが不合格なら、ジョブを失敗として終了し、手動の復旧手順で扱う。`current` は新しい版を向いたままにする(アプリは起動していない状態) |
| 同じ ID の再デプロイ(`prev` と新しい版が同じ) | `releases/<id>` が既にあれば(`mv` で置くため、あるなら完全な版である)、展開をやり直さない。リンクの張り直しと再起動だけを行う。この場合は戻す先が同じ版になるため、ロールバックはせず、不合格ならジョブを失敗として終了する |
| 失敗した版のディレクトリ | ロールバックの完了後に、失敗した版の `releases/<id>/` を削除する(次の成功を待たない)。**削除してよいのは、`current` でも `prev` でもない場合だけ**で、`current` または `prev` が向いているディレクトリは消さない(初回デプロイや同じ ID の再デプロイでも、リンクを切らない)。残すのは、現在動いている版と、直前の 1 世代だけ。ただし原因調査のために、失敗した版の `server.mjs` のチェックサムと、スモークテストの出力をジョブのログに残す |

**NFR3.3 の例外(明記)**: データディスクの未マウント(`AssertPathIsMountPoint=` の失敗)が原因のときは、`current` を戻しても直らないため、自動ロールバックを行わない。これは NFR3.3「デプロイが失敗したら直前の成功版に自動で戻る」の**意図的な例外**とする。`deploy.sh` は、スモークテストが不合格のとき、`mountpoint -q /mnt/data` を直接実行して原因がマウントの失敗かどうかを判定し(ログの優先度には頼らない)、ジョブを失敗として終了して、手順書のマウントの確認(2 節)に誘導する。ロールバックの 120 秒の基準は、この例外には適用しない。

- 画面の静的ファイルは `current/web` から Caddy が配信するため、`current` を切り替えるだけで画面も戻る。Caddy の再起動は要らない。
- DB は `/mnt/data` にあり、リリースのディレクトリには入らない。ロールバックの対象外(FR2.5)。
- 同じ成果物を 2 回デプロイしても、2 回目は同じ結果になる(`releases/<id>` が同じなら上書きせずリンクを張り直すだけ)。

## 4. データの扱い(NFR3.5、NFR3.6)

- バックアップは取らない。データが失われたら、DB ファイルを消してから起動し直せば、シードで初期のメニューが入る(`DB_PATH` のファイルが空のときだけシードされる既存の動作)。この手順を手順書に書く。
- 再デプロイでも VM の作り直しでも、データディスクは上書きしない。試験: 注文を 1 件作り、(a) 再デプロイ、(b) VM を作り直してデータディスクを付け直す、のどちらでも注文が残る。

## 5. 再現性(NFR4.1〜NFR4.3)

- 起動スクリプトは冪等にする。Node.js が既に固定の版で入っていれば何もしない。Caddy、swap、fstab、ユニットも、再実行して壊れない。
- 2 回目の `terraform plan -detailed-exitcode` が 0 を返す。データディスクは別リソースで `prevent_destroy`(NFR4.4)。

## 受け入れたリスク

- 数値の可用性がなく、デプロイ中の数秒〜数十秒の停止は許容する。
- バックアップがなく、ディスクの障害でデータは失われる。単一のゾーンで、ゾーンの障害で止まる。

## Assumptions & Open Questions

- `[assumption]` A1: Caddy が `current` のシンボリックリンクを、リクエストごとに解決して静的ファイルを返す(切り替え後の再起動が要らない)。ウォーキングスケルトンで確認する。
- 未確定: `deploy.sh` を実行する権限(`sudo` の範囲)と、成果物を VM に渡す方法(`gcloud compute scp` か標準入力のストリーム)は、インフラ設計と CI の設計で決める。
